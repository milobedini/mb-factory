import { createSign } from 'node:crypto';

import { requireEnv } from './env';
import { log } from './log';

// The factory's own GitHub App (`mb-factory-bot`), for what only the App may do: merging an express PR without an
// approval, which the repo's Review ruleset lets the App bypass, and merging the base branch into a PR that changes a
// workflow file, which takes the Workflows permission the console's own token lacks. Its key is the console's
// `FACTORY_APP_PRIVATE_KEY` and its client ID `FACTORY_APP_CLIENT_ID`. Each token is limited to one repository and the
// permissions those merges need, and lasts an hour.

const API_URL = 'https://api.github.com';
// A token is used only while it has this long left, so a merge never starts on one about to lapse.
const MARGIN_MS = 5 * 60 * 1000;

const base64Url = (text: string | Buffer): string => Buffer.from(text).toString('base64url');

// Vercel's form keeps a pasted key's line breaks; one set from a single line has them as `\n`.
const privateKey = (): string => requireEnv('FACTORY_APP_PRIVATE_KEY').replace(/\\n/g, '\n');

// The App's own JWT, signed with its key, valid for nine minutes from a minute ago (GitHub allows ten, and clocks drift).
const appJwt = (): string => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: requireEnv('FACTORY_APP_CLIENT_ID') })
  );
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey(), 'base64url');
  return `${header}.${payload}.${signature}`;
};

const asApp = async <T>(method: 'GET' | 'POST', path: string, action: string, body?: unknown): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${appJwt()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`GitHub ${action} failed with ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return response.json() as Promise<T>;
};

const tokens = new Map<string, { token: string; expiresAt: number }>();

// An installation token for one repository, kept while it has time left. `workflows` adds write access to workflow
// files, asked for only by the merges that may need it, so an installation without it fails those alone.
export const appToken = async (repository: string, { workflows = false } = {}): Promise<string> => {
  const key = `${repository}${workflows ? ' workflows' : ''}`;
  const kept = tokens.get(key);
  if (kept && kept.expiresAt - MARGIN_MS > Date.now()) {
    return kept.token;
  }
  const [, name] = repository.split('/');
  const { id } = await asApp<{ id: number }>('GET', `/repos/${repository}/installation`, 'app installation');
  const permissions = { contents: 'write', pull_requests: 'write', ...(workflows ? { workflows: 'write' } : {}) };
  const created = await asApp<{ token: string; expires_at: string }>(
    'POST',
    `/app/installations/${id}/access_tokens`,
    'app token',
    { repositories: [name], permissions }
  );
  tokens.set(key, { token: created.token, expiresAt: Date.parse(created.expires_at) });
  return created.token;
};

// After the App couldn't give a read token for a repository (not installed there, or missing a read permission), the
// console's own token reads it for this long before the App is asked again.
const READ_RETRY_MS = 10 * 60 * 1000;
const READ_PERMISSIONS = { contents: 'read', pull_requests: 'read', checks: 'read', actions: 'read', statuses: 'read' };
const readTokens = new Map<string, { token: string | null; expiresAt: number }>();

// A read-only installation token for one repository, or null when there isn't one to be had. The App's requests count
// against its own rate limit, not the person whose token the console otherwise reads with (5 Nov: a busy hour of
// check webhooks spent all 5,000 of theirs).
export const appReadToken = async (repository: string): Promise<string | null> => {
  const kept = readTokens.get(repository);
  if (kept && kept.expiresAt - MARGIN_MS > Date.now()) {
    return kept.token;
  }
  try {
    const [, name] = repository.split('/');
    const { id } = await asApp<{ id: number }>('GET', `/repos/${repository}/installation`, 'app installation');
    const created = await asApp<{ token: string; expires_at: string }>(
      'POST',
      `/app/installations/${id}/access_tokens`,
      'app read token',
      { repositories: [name], permissions: READ_PERMISSIONS }
    );
    readTokens.set(repository, { token: created.token, expiresAt: Date.parse(created.expires_at) });
    return created.token;
  } catch (error) {
    log('warn', 'app read token unavailable', {
      repository,
      error: error instanceof Error ? error.message : String(error)
    });
    readTokens.set(repository, { token: null, expiresAt: Date.now() + MARGIN_MS + READ_RETRY_MS });
    return null;
  }
};

// GitHub's own revert of a merged PR, opened as the App: a branch with the revert commit and a PR for it.
export const openRevertPull = async (
  repository: string,
  pullRequestId: string,
  body: string
): Promise<{ number: number; url: string; head: string }> => {
  const response = await fetch(`${API_URL}/graphql`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await appToken(repository)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `mutation ($id: ID!, $body: String!) {
        revertPullRequest(input: { pullRequestId: $id, body: $body }) { revertPullRequest { number url headRefOid } }
      }`,
      variables: { id: pullRequestId, body }
    })
  });
  const result = (await response.json().catch(() => ({}))) as {
    data?: {
      revertPullRequest?: { revertPullRequest?: { number: number; url: string; headRefOid: string } | null } | null;
    };
    errors?: { message: string }[];
  };
  const pull = result.data?.revertPullRequest?.revertPullRequest;
  if (!response.ok || !pull) {
    throw new Error(
      `GitHub revert failed with ${response.status}: ${result.errors?.map(({ message }) => message).join('; ') ?? 'no PR'}`
    );
  }
  return { number: pull.number, url: pull.url, head: pull.headRefOid };
};
