import { requireEnv } from './env';

const AUTHORIZE_URL = 'https://linear.app/oauth/authorize';
const TOKEN_URL = 'https://api.linear.app/oauth/token';
const REVOKE_URL = 'https://api.linear.app/oauth/revoke';
const GRAPHQL_URL = 'https://api.linear.app/graphql';

export const LINEAR_SCOPES = ['read', 'write', 'app:assignable', 'app:mentionable'];
export const STATE_COOKIE = 'linear_oauth_state';

export type LinearTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string | string[];
  refresh_token: string;
};

export type LinearInstallationIdentity = {
  appUserId: string;
  organizationId: string;
  organizationName: string;
};

export const callbackUrl = (): string => `${requireEnv('CONSOLE_URL')}/api/linear/oauth/callback`;

export const buildAuthorizeUrl = (state: string): string => {
  const params = new URLSearchParams({
    client_id: requireEnv('LINEAR_CLIENT_ID'),
    redirect_uri: callbackUrl(),
    response_type: 'code',
    scope: LINEAR_SCOPES.join(','),
    state,
    actor: 'app',
    prompt: 'consent'
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
};

export const exchangeCode = async (code: string): Promise<LinearTokenResponse> => {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl(),
      client_id: requireEnv('LINEAR_CLIENT_ID'),
      client_secret: requireEnv('LINEAR_CLIENT_SECRET')
    })
  });
  if (!response.ok) {
    throw new Error(`Linear token exchange failed with ${response.status}`);
  }
  return (await response.json()) as LinearTokenResponse;
};

export const revokeToken = async (token: string): Promise<void> => {
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token, token_type_hint: 'access_token' })
  });
};

export const fetchInstallationIdentity = async (accessToken: string): Promise<LinearInstallationIdentity> => {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query: '{ viewer { id } organization { id name } }' })
  });
  if (!response.ok) {
    throw new Error(`Linear identity query failed with ${response.status}`);
  }
  const { data } = (await response.json()) as {
    data: { viewer: { id: string }; organization: { id: string; name: string } };
  };
  return { appUserId: data.viewer.id, organizationId: data.organization.id, organizationName: data.organization.name };
};

export const normaliseScopes = (scope: string | string[]): string[] =>
  Array.isArray(scope) ? scope : scope.split(/[\s,]+/).filter(Boolean);
