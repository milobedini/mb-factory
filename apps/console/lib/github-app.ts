import { createSign } from 'node:crypto';

import { requireEnv } from './env';

// The factory's own GitHub App (`mb-factory-bot`), for what only the App may do: merging an express PR without an
// approval, which the repo's Review ruleset lets the App bypass. Its key is the console's `FACTORY_APP_PRIVATE_KEY`
// and its client ID `FACTORY_APP_CLIENT_ID`. Each token is limited to one repository and the two permissions a merge
// needs, and lasts an hour.

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

// An installation token for one repository, kept while it has time left.
export const appToken = async (repository: string): Promise<string> => {
  const kept = tokens.get(repository);
  if (kept && kept.expiresAt - MARGIN_MS > Date.now()) {
    return kept.token;
  }
  const [, name] = repository.split('/');
  const { id } = await asApp<{ id: number }>('GET', `/repos/${repository}/installation`, 'app installation');
  const created = await asApp<{ token: string; expires_at: string }>(
    'POST',
    `/app/installations/${id}/access_tokens`,
    'app token',
    { repositories: [name], permissions: { contents: 'write', pull_requests: 'write' } }
  );
  tokens.set(repository, { token: created.token, expiresAt: Date.parse(created.expires_at) });
  return created.token;
};
