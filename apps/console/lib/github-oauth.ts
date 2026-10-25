import { createHash, randomBytes } from 'node:crypto';

import { requireEnv } from './env';

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';

export const OAUTH_COOKIE = 'github_oauth';
export const OAUTH_COOKIE_PATH = '/api/auth/github';

export const callbackUrl = (): string => `${requireEnv('CONSOLE_URL')}/api/auth/github/callback`;

export type OAuthStart = { state: string; verifier: string; url: string };

// No scopes: the console only needs to know who you are.
export const startAuthorization = (): OAuthStart => {
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({
    client_id: requireEnv('GITHUB_OAUTH_CLIENT_ID'),
    redirect_uri: callbackUrl(),
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    allow_signup: 'false'
  });
  return { state, verifier, url: `${AUTHORIZE_URL}?${params.toString()}` };
};

export const exchangeCode = async (code: string, verifier: string): Promise<string> => {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: requireEnv('GITHUB_OAUTH_CLIENT_ID'),
      client_secret: requireEnv('GITHUB_OAUTH_CLIENT_SECRET'),
      code,
      redirect_uri: callbackUrl(),
      code_verifier: verifier
    })
  });
  const body = (await response.json()) as { access_token?: string; error?: string };
  if (!response.ok || !body.access_token) {
    throw new Error(`GitHub token exchange failed: ${body.error ?? response.status}`);
  }
  return body.access_token;
};

export const fetchGitHubUser = async (accessToken: string): Promise<{ id: number; login: string }> => {
  const response = await fetch('https://api.github.com/user', {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) {
    throw new Error(`GitHub user lookup failed with ${response.status}`);
  }
  const { id, login } = (await response.json()) as { id: number; login: string };
  return { id, login };
};

// The console keeps no GitHub token: once it knows who signed in, it gives the token back.
export const revokeToken = async (accessToken: string): Promise<void> => {
  const clientId = requireEnv('GITHUB_OAUTH_CLIENT_ID');
  const credentials = Buffer.from(`${clientId}:${requireEnv('GITHUB_OAUTH_CLIENT_SECRET')}`).toString('base64');
  await fetch(`https://api.github.com/applications/${clientId}/token`, {
    method: 'DELETE',
    headers: { Accept: 'application/vnd.github+json', Authorization: `Basic ${credentials}` },
    body: JSON.stringify({ access_token: accessToken })
  });
};
