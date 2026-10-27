import { createHash, randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret } from '@mb-factory/core';
import { eq, inArray } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { githubConnections } from '@/db/schema';

import { requireEnv } from './env';

// Connecting GitHub through the factory's GitHub App (its user authorisation), so a tap in Slack can approve and merge
// a PR as the person who tapped. The token reaches only the repos the app is installed on, with the app's permissions,
// and lasts 8 hours; the refresh token rotates on each use and lasts 6 months.

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';

export const CONNECT_COOKIE = 'github_connect';
export const CONNECT_COOKIE_PATH = '/api/github/connect';

// Refreshed this long before it runs out, so a merge never starts with a token about to expire.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export const connectStartUrl = (): string => `${requireEnv('CONSOLE_URL')}/api/github/connect/start`;

const connectCallbackUrl = (): string => `${requireEnv('CONSOLE_URL')}/api/github/connect/callback`;

export type ConnectStart = { state: string; verifier: string; url: string };

export const startConnect = (): ConnectStart => {
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({
    client_id: requireEnv('FACTORY_APP_CLIENT_ID'),
    redirect_uri: connectCallbackUrl(),
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    allow_signup: 'false'
  });
  return { state, verifier, url: `${AUTHORIZE_URL}?${params.toString()}` };
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
};

export type UserToken = {
  accessToken: string;
  accessTokenExpiresAt: Date | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
};

const secondsFrom = (now: number, seconds: number | undefined): Date | null =>
  seconds === undefined ? null : new Date(now + seconds * 1000);

const requestToken = async (params: Record<string, string>): Promise<UserToken> => {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('FACTORY_APP_CLIENT_ID'),
      client_secret: requireEnv('FACTORY_APP_CLIENT_SECRET'),
      ...params
    })
  });
  // GitHub answers a bad code or refresh token with 200 and an `error`.
  const body = (await response.json()) as TokenResponse;
  if (!response.ok || !body.access_token) {
    throw new Error(`GitHub token request failed: ${body.error ?? response.status}`);
  }
  const now = Date.now();
  return {
    accessToken: body.access_token,
    accessTokenExpiresAt: secondsFrom(now, body.expires_in),
    refreshToken: body.refresh_token ?? null,
    refreshTokenExpiresAt: secondsFrom(now, body.refresh_token_expires_in)
  };
};

export const exchangeConnectCode = (code: string, verifier: string): Promise<UserToken> =>
  requestToken({ code, redirect_uri: connectCallbackUrl(), code_verifier: verifier });

const sealed = (token: UserToken, key: string) => ({
  accessToken: encryptSecret(token.accessToken, key),
  accessTokenExpiresAt: token.accessTokenExpiresAt,
  refreshToken: token.refreshToken ? encryptSecret(token.refreshToken, key) : null,
  refreshTokenExpiresAt: token.refreshTokenExpiresAt,
  updatedAt: new Date()
});

export const saveConnection = async (user: { id: number; login: string }, token: UserToken): Promise<void> => {
  const values = sealed(token, requireEnv('TOKEN_ENCRYPTION_KEY'));
  await getDb()
    .insert(githubConnections)
    .values({ githubUserId: user.id, login: user.login, ...values })
    .onConflictDoUpdate({ target: githubConnections.githubUserId, set: { login: user.login, ...values } });
};

export type Connection = { kind: 'connected'; token: string; login: string } | { kind: 'none' } | { kind: 'expired' };

// A usable token for the person, refreshed when it's about to run out. One that can't be refreshed is gone: the person
// connects again.
export const userGitHubToken = async (githubUserId: number): Promise<Connection> => {
  const key = requireEnv('TOKEN_ENCRYPTION_KEY');
  const [row] = await getDb()
    .select()
    .from(githubConnections)
    .where(eq(githubConnections.githubUserId, githubUserId))
    .limit(1);
  if (!row) {
    return { kind: 'none' };
  }
  const now = Date.now();
  if (!row.accessTokenExpiresAt || row.accessTokenExpiresAt.getTime() - now > REFRESH_MARGIN_MS) {
    return { kind: 'connected', token: decryptSecret(row.accessToken, key), login: row.login };
  }
  if (!row.refreshToken || (row.refreshTokenExpiresAt && row.refreshTokenExpiresAt.getTime() <= now)) {
    return { kind: 'expired' };
  }
  try {
    const token = await requestToken({
      grant_type: 'refresh_token',
      refresh_token: decryptSecret(row.refreshToken, key)
    });
    await getDb()
      .update(githubConnections)
      .set(sealed(token, key))
      .where(eq(githubConnections.githubUserId, githubUserId));
    return { kind: 'connected', token: token.accessToken, login: row.login };
  } catch {
    return { kind: 'expired' };
  }
};

// Which of these people have a connection that can still be used or refreshed, for their Home tabs.
export const connectedGitHubIds = async (githubUserIds: number[]): Promise<number[]> => {
  if (githubUserIds.length === 0) {
    return [];
  }
  const rows = await getDb()
    .select({ id: githubConnections.githubUserId, refreshTokenExpiresAt: githubConnections.refreshTokenExpiresAt })
    .from(githubConnections)
    .where(inArray(githubConnections.githubUserId, githubUserIds));
  const now = Date.now();
  return rows
    .filter(({ refreshTokenExpiresAt }) => !refreshTokenExpiresAt || refreshTokenExpiresAt.getTime() > now)
    .map(({ id }) => id);
};

export const findConnection = async (githubUserId: number): Promise<{ login: string; since: Date } | undefined> => {
  const [row] = await getDb()
    .select({ login: githubConnections.login, since: githubConnections.createdAt })
    .from(githubConnections)
    .where(eq(githubConnections.githubUserId, githubUserId))
    .limit(1);
  return row;
};

// Forgets the tokens and withdraws the app's authorisation on GitHub, so nothing can act as the person any more.
export const disconnect = async (githubUserId: number): Promise<void> => {
  const key = requireEnv('TOKEN_ENCRYPTION_KEY');
  const [row] = await getDb()
    .delete(githubConnections)
    .where(eq(githubConnections.githubUserId, githubUserId))
    .returning({ accessToken: githubConnections.accessToken });
  if (!row) {
    return;
  }
  const clientId = requireEnv('FACTORY_APP_CLIENT_ID');
  const credentials = Buffer.from(`${clientId}:${requireEnv('FACTORY_APP_CLIENT_SECRET')}`).toString('base64');
  const response = await fetch(`https://api.github.com/applications/${clientId}/grant`, {
    method: 'DELETE',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Basic ${credentials}` },
    body: JSON.stringify({ access_token: decryptSecret(row.accessToken, key) })
  });
  // 404 or 422: the token had already run out or been revoked, which is what disconnecting wanted.
  if (!response.ok && response.status !== 404 && response.status !== 422) {
    throw new Error(`GitHub grant revoke failed with ${response.status}`);
  }
};
