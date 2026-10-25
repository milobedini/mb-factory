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

export const getLinearAccessToken = async (
  organizationId: string,
  { minValidityMs = REFRESH_MARGIN_MS }: { minValidityMs?: number } = {}
): Promise<string> => {
  const key = requireEnv('TOKEN_ENCRYPTION_KEY');
  const [installation] = await getDb()
    .select()
    .from(linearInstallations)
    .where(eq(linearInstallations.organizationId, organizationId))
    .limit(1);

  if (!installation) {
    throw new Error(`No Linear installation for organisation ${organizationId}`);
  }
  if (installation.accessTokenExpiresAt.getTime() - Date.now() > minValidityMs) {
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

// The factory's own Linear user, which its status moves and activities come from.
export const findAppUserId = async (organizationId: string): Promise<string> => {
  const [installation] = await getDb()
    .select({ appUserId: linearInstallations.appUserId })
    .from(linearInstallations)
    .where(eq(linearInstallations.organizationId, organizationId))
    .limit(1);
  if (!installation) {
    throw new Error(`No Linear installation for organisation ${organizationId}`);
  }
  return installation.appUserId;
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

type IssueStates = {
  issue: { state: { id: string; type: string }; team: { states: { nodes: { id: string; name: string }[] } } };
};

export type IssueMove = { moved: true } | { moved: false; reason: string };

// Statuses are named in factory.yaml; IDs differ per workspace, so they're resolved on each move.
export const moveIssueToStatus = async (
  organizationId: string,
  issueId: string,
  statusName: string,
  shouldMove: (currentStateType: string) => boolean
): Promise<IssueMove> => {
  const { issue } = await linearGraphql<IssueStates>(
    organizationId,
    'query IssueStates($id: String!) { issue(id: $id) { state { id type } team { states { nodes { id name } } } } }',
    { id: issueId }
  );
  const target = issue.team.states.nodes.find(({ name }) => name === statusName);
  if (!target) {
    return { moved: false, reason: `the team has no status named ${statusName}` };
  }
  if (target.id === issue.state.id) {
    return { moved: false, reason: 'already there' };
  }
  if (!shouldMove(issue.state.type)) {
    return { moved: false, reason: `the issue is ${issue.state.type}` };
  }
  await linearGraphql<{ issueUpdate: { success: boolean } }>(
    organizationId,
    'mutation IssueMove($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }',
    { id: issueId, stateId: target.id }
  );
  return { moved: true };
};

const CLOSING_ACTIVITY_TYPES = ['response', 'error', 'elicitation'];

// Whether the session got a final message (or a question) since the given time, from the agent or anyone else.
export const hasClosingActivity = async (
  organizationId: string,
  agentSessionId: string,
  since: Date
): Promise<boolean> => {
  const { agentSession } = await linearGraphql<{ agentSession: { activities: { nodes: { id: string }[] } } }>(
    organizationId,
    'query SessionClosing($id: String!, $since: DateTimeOrDuration!, $types: [String!]) { agentSession(id: $id) { activities(first: 1, filter: { createdAt: { gte: $since }, type: { in: $types } }) { nodes { id } } } }',
    { id: agentSessionId, since: since.toISOString(), types: CLOSING_ACTIVITY_TYPES }
  );
  return agentSession.activities.nodes.length > 0;
};
