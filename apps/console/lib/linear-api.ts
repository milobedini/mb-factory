import { decryptSecret, encryptSecret } from '@mb-factory/core';
import { eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { linearInstallations } from '@/db/schema';

import { requireEnv } from './env';
import type { LinearTokenResponse } from './linear-oauth';
import { normaliseScopes } from './linear-oauth';

const TOKEN_URL = 'https://api.linear.app/oauth/token';
const GRAPHQL_URL = 'https://api.linear.app/graphql';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

const refreshAccessToken = async (refreshToken: string): Promise<LinearTokenResponse> => {
  const credentials = Buffer.from(`${requireEnv('LINEAR_CLIENT_ID')}:${requireEnv('LINEAR_CLIENT_SECRET')}`).toString(
    'base64'
  );
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${credentials}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
  });
  if (!response.ok) {
    throw new Error(`Linear token refresh failed with ${response.status}`);
  }
  return (await response.json()) as LinearTokenResponse;
};

export const getLinearAccessToken = async (organizationId: string): Promise<string> => {
  const key = requireEnv('TOKEN_ENCRYPTION_KEY');
  const [installation] = await getDb()
    .select()
    .from(linearInstallations)
    .where(eq(linearInstallations.organizationId, organizationId))
    .limit(1);

  if (!installation) {
    throw new Error(`No Linear installation for organisation ${organizationId}`);
  }
  if (installation.accessTokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) {
    return decryptSecret(installation.accessToken, key);
  }

  const token = await refreshAccessToken(decryptSecret(installation.refreshToken, key));
  await getDb()
    .update(linearInstallations)
    .set({
      accessToken: encryptSecret(token.access_token, key),
      refreshToken: encryptSecret(token.refresh_token, key),
      accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes: normaliseScopes(token.scope),
      updatedAt: new Date()
    })
    .where(eq(linearInstallations.organizationId, organizationId));
  return token.access_token;
};

export const linearGraphql = async <T>(
  organizationId: string,
  query: string,
  variables: Record<string, unknown>
): Promise<T> => {
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await getLinearAccessToken(organizationId)}`
    },
    body: JSON.stringify({ query, variables })
  });
  const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (!response.ok || body.errors?.length || !body.data) {
    throw new Error(
      `Linear GraphQL error: ${body.errors?.map(({ message }) => message).join('; ') ?? response.status}`
    );
  }
  return body.data;
};

export type AgentActivityContent =
  | { type: 'thought'; body: string }
  | { type: 'elicitation'; body: string }
  | { type: 'response'; body: string }
  | { type: 'error'; body: string }
  | { type: 'action'; action: string; parameter: string; result?: string };

export const createAgentActivity = async (
  organizationId: string,
  agentSessionId: string,
  content: AgentActivityContent
): Promise<void> => {
  await linearGraphql<{ agentActivityCreate: { success: boolean } }>(
    organizationId,
    'mutation AgentActivityCreate($input: AgentActivityCreateInput!) { agentActivityCreate(input: $input) { success } }',
    { input: { agentSessionId, content } }
  );
};
