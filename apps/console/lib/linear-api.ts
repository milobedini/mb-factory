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

// `select` turns an elicitation into Linear's one-tap options; label and value are the same, so a tap reads the same
// whichever of the two Linear sends back.
export const createAgentActivity = async (
  organizationId: string,
  agentSessionId: string,
  content: AgentActivityContent,
  select?: string[]
): Promise<void> => {
  const signal = select
    ? { signal: 'select', signalMetadata: { options: select.map((option) => ({ label: option, value: option })) } }
    : {};
  await linearGraphql<{ agentActivityCreate: { success: boolean } }>(
    organizationId,
    'mutation AgentActivityCreate($input: AgentActivityCreateInput!) { agentActivityCreate(input: $input) { success } }',
    { input: { agentSessionId, content, ...signal } }
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

export type CreatedIssue = { id: string; identifier: string; url: string; title: string };

// Filed without a delegate: the work item has to exist before Linear tells anyone about the agent.
export const createIssue = async (
  organizationId: string,
  {
    teamKey,
    title,
    description,
    assigneeId
  }: { teamKey: string; title: string; description: string; assigneeId: string | null }
): Promise<CreatedIssue> => {
  const { teams } = await linearGraphql<{ teams: { nodes: { id: string }[] } }>(
    organizationId,
    'query TeamByKey($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id } } }',
    { key: teamKey }
  );
  const [team] = teams.nodes;
  if (!team) {
    throw new Error(`Linear has no team with the key ${teamKey}`);
  }
  const { issueCreate } = await linearGraphql<{ issueCreate: { success: boolean; issue: CreatedIssue | null } }>(
    organizationId,
    'mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url title } } }',
    { input: { teamId: team.id, title, description, ...(assigneeId ? { assigneeId } : {}) } }
  );
  if (!issueCreate.issue) {
    throw new Error('Linear created no issue');
  }
  return issueCreate.issue;
};

// The active member with this email, to own an issue someone asked for outside Linear.
export const findUserIdByEmail = async (organizationId: string, email: string): Promise<string | null> => {
  const { users } = await linearGraphql<{ users: { nodes: { id: string }[] } }>(
    organizationId,
    'query UserByEmail($email: String!) { users(filter: { email: { eqIgnoreCase: $email }, active: { eq: true } }) { nodes { id } } }',
    { email }
  );
  return users.nodes[0]?.id ?? null;
};

// A session the app opens itself, for work that didn't start with a delegation or a mention in Linear.
export const createSessionOnIssue = async (organizationId: string, issueId: string): Promise<string> => {
  const { agentSessionCreateOnIssue } = await linearGraphql<{
    agentSessionCreateOnIssue: { agentSession: { id: string } };
  }>(
    organizationId,
    'mutation SessionOnIssue($input: AgentSessionCreateOnIssue!) { agentSessionCreateOnIssue(input: $input) { agentSession { id } } }',
    { input: { issueId } }
  );
  return agentSessionCreateOnIssue.agentSession.id;
};

// With an assignee, the issue becomes theirs too, as delegating it in Linear makes it.
export const delegateIssue = async (
  organizationId: string,
  issueId: string,
  delegateId: string,
  assigneeId: string | null = null
): Promise<void> => {
  await linearGraphql<{ issueUpdate: { success: boolean } }>(
    organizationId,
    'mutation IssueDelegate($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }',
    { id: issueId, input: { delegateId, ...(assigneeId ? { assigneeId } : {}) } }
  );
};

type TeamForFiling = {
  teams: {
    nodes: {
      id: string;
      triageEnabled: boolean;
      states: { nodes: { id: string }[] };
    }[];
  };
  issueLabels: { nodes: { id: string; name: string; team: { id: string } | null }[] };
};

// The team's labels with these names, or the workspace's; any missing is created on the team.
const labelIdsFor = async (
  organizationId: string,
  teamId: string,
  names: string[],
  found: TeamForFiling['issueLabels']['nodes']
): Promise<string[]> =>
  Promise.all(
    names.map(async (name) => {
      const usable = found.filter(
        (label) => label.name.toLowerCase() === name.toLowerCase() && (!label.team || label.team.id === teamId)
      );
      const existing = usable.find(({ team }) => team?.id === teamId) ?? usable[0];
      if (existing) {
        return existing.id;
      }
      const { issueLabelCreate } = await linearGraphql<{ issueLabelCreate: { issueLabel: { id: string } } }>(
        organizationId,
        'mutation LabelCreate($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { issueLabel { id } } }',
        { input: { name, teamId } }
      );
      return issueLabelCreate.issueLabel.id;
    })
  );

export type TriageIssue = {
  teamKey: string;
  title: string;
  description: string;
  priority: number;
  estimate: number | null;
  labels: string[];
};

// Filed in the team's Triage inbox, undelegated and unassigned: a person accepts or declines it before any work.
export const fileTriageIssue = async (
  organizationId: string,
  { teamKey, title, description, priority, estimate, labels }: TriageIssue
): Promise<CreatedIssue> => {
  const { teams, issueLabels } = await linearGraphql<TeamForFiling>(
    organizationId,
    'query TeamForFiling($key: String!, $labels: IssueLabelFilter) { teams(filter: { key: { eq: $key } }) { nodes { id triageEnabled states(filter: { type: { eq: "triage" } }) { nodes { id } } } } issueLabels(filter: $labels) { nodes { id name team { id } } } }',
    // Label names match without regard to case, as Linear compares them when creating one.
    { key: teamKey, labels: { or: labels.map((name) => ({ name: { eqIgnoreCase: name } })) } }
  );
  const [team] = teams.nodes;
  if (!team) {
    throw new Error(`Linear has no team with the key ${teamKey}`);
  }
  const triageStateId = team.triageEnabled ? team.states.nodes[0]?.id : undefined;
  if (!triageStateId) {
    throw new Error(`The ${teamKey} team has no Triage status`);
  }
  const labelIds = await labelIdsFor(organizationId, team.id, labels, issueLabels.nodes);
  const { issueCreate } = await linearGraphql<{ issueCreate: { success: boolean; issue: CreatedIssue | null } }>(
    organizationId,
    'mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url title } } }',
    {
      input: {
        teamId: team.id,
        stateId: triageStateId,
        title,
        description,
        priority,
        labelIds,
        ...(estimate === null ? {} : { estimate })
      }
    }
  );
  if (!issueCreate.issue) {
    throw new Error('Linear created no issue');
  }
  return issueCreate.issue;
};

type ParentForParts = {
  issue: {
    id: string;
    identifier: string;
    team: { id: string };
    project: { id: string } | null;
    children: { nodes: { id: string }[] };
  } | null;
  issueLabels: TeamForFiling['issueLabels'];
};

export type SubIssue = { title: string; description: string; estimate: number | null };

// The later parts of a split issue, as its sub-issues in its project, each blocked by the part before (the first by
// the issue itself), undelegated so each is delegated when it's ready. Nothing is filed when the issue already has
// sub-issues, so approving the same spec twice files them once.
export const fileSubIssues = async (
  organizationId: string,
  parentId: string,
  parts: SubIssue[]
): Promise<CreatedIssue[]> => {
  const { issue: parent, issueLabels } = await linearGraphql<ParentForParts>(
    organizationId,
    'query ParentForParts($id: String!) { issue(id: $id) { id identifier team { id } project { id } children(first: 1) { nodes { id } } } issueLabels(filter: { name: { eqIgnoreCase: "factory" } }) { nodes { id name team { id } } } }',
    { id: parentId }
  );
  if (!parent) {
    throw new Error('Linear has no such parent issue');
  }
  if (parent.children.nodes.length > 0) {
    return [];
  }
  const labelIds = await labelIdsFor(organizationId, parent.team.id, ['factory'], issueLabels.nodes);
  // One after another: each part's blocker is the one filed before it.
  return parts.reduce<Promise<CreatedIssue[]>>(async (filing, { title, description, estimate }) => {
    const filed = await filing;
    const { issueCreate } = await linearGraphql<{ issueCreate: { issue: CreatedIssue | null } }>(
      organizationId,
      'mutation SubIssueCreate($input: IssueCreateInput!) { issueCreate(input: $input) { issue { id identifier url title } } }',
      {
        input: {
          teamId: parent.team.id,
          parentId: parent.id,
          title,
          description,
          labelIds,
          ...(parent.project ? { projectId: parent.project.id } : {}),
          ...(estimate === null ? {} : { estimate })
        }
      }
    );
    if (!issueCreate.issue) {
      throw new Error('Linear created no sub-issue');
    }
    await linearGraphql(
      organizationId,
      'mutation PartBlocked($input: IssueRelationCreateInput!) { issueRelationCreate(input: $input) { success } }',
      { input: { issueId: filed.at(-1)?.id ?? parent.id, relatedIssueId: issueCreate.issue.id, type: 'blocks' } }
    );
    return [...filed, issueCreate.issue];
  }, Promise.resolve([]));
};

const BLOCKED_LABEL = 'Blocked';
const BLOCKED_COLOUR = '#eb5757';

type IssueForLabel = {
  issue: { team: { id: string }; labels: { nodes: { id: string; name: string }[] } } | null;
  issueLabels: { nodes: { id: string; name: string; team: { id: string } | null }[] };
};

// The red Blocked label on an issue while its work waits on a person; the label is created on the team the first time.
export const setBlockedLabel = async (organizationId: string, issueId: string, blocked: boolean): Promise<void> => {
  const { issue, issueLabels } = await linearGraphql<IssueForLabel>(
    organizationId,
    'query IssueForLabel($id: String!, $name: String!) { issue(id: $id) { team { id } labels { nodes { id name } } } issueLabels(filter: { name: { eqIgnoreCase: $name } }) { nodes { id name team { id } } } }',
    { id: issueId, name: BLOCKED_LABEL }
  );
  if (!issue) {
    return;
  }
  const onIssue = issue.labels.nodes.find(({ name }) => name.toLowerCase() === BLOCKED_LABEL.toLowerCase());
  if (!blocked) {
    if (onIssue) {
      await linearGraphql(
        organizationId,
        'mutation LabelOff($id: String!, $labelId: String!) { issueRemoveLabel(id: $id, labelId: $labelId) { success } }',
        { id: issueId, labelId: onIssue.id }
      );
    }
    return;
  }
  if (onIssue) {
    return;
  }
  const usable = issueLabels.nodes.filter(({ team }) => !team || team.id === issue.team.id);
  const existing = usable.find(({ team }) => team?.id === issue.team.id) ?? usable[0];
  const labelId =
    existing?.id ??
    (
      await linearGraphql<{ issueLabelCreate: { issueLabel: { id: string } } }>(
        organizationId,
        'mutation LabelCreate($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { issueLabel { id } } }',
        { input: { name: BLOCKED_LABEL, color: BLOCKED_COLOUR, teamId: issue.team.id } }
      )
    ).issueLabelCreate.issueLabel.id;
  await linearGraphql(
    organizationId,
    'mutation LabelOn($id: String!, $labelId: String!) { issueAddLabel(id: $id, labelId: $labelId) { success } }',
    { id: issueId, labelId }
  );
};

// The email of the person an issue is assigned to, or null when nobody is.
export const issueAssigneeEmail = async (organizationId: string, issueId: string): Promise<string | null> => {
  const { issue } = await linearGraphql<{ issue: { assignee: { email: string } | null } | null }>(
    organizationId,
    'query IssueAssignee($id: String!) { issue(id: $id) { assignee { email } } }',
    { id: issueId }
  );
  return issue?.assignee?.email ?? null;
};

// The issue's workflow state type (`triage`, `backlog`, `unstarted`, `started`, `completed`, `canceled`), or null when
// Linear can't find it.
export const issueStateType = async (organizationId: string, issueId: string): Promise<string | null> => {
  const { issue } = await linearGraphql<{ issue: { state: { type: string } } | null }>(
    organizationId,
    'query IssueStateType($id: String!) { issue(id: $id) { state { type } } }',
    { id: issueId }
  );
  return issue?.state.type ?? null;
};

export type IssueToStart = {
  id: string;
  identifier: string;
  url: string;
  title: string;
  stateType: string;
};

// An issue filed from Slack, read again before it's started, since the message offering it may be days old.
export const issueToStart = async (organizationId: string, issueId: string): Promise<IssueToStart | null> => {
  const { issue } = await linearGraphql<{
    issue: {
      id: string;
      identifier: string;
      url: string;
      title: string;
      state: { type: string };
    } | null;
  }>(organizationId, 'query IssueToStart($id: String!) { issue(id: $id) { id identifier url title state { type } } }', {
    id: issueId
  });
  return (
    issue && {
      id: issue.id,
      identifier: issue.identifier,
      url: issue.url,
      title: issue.title,
      stateType: issue.state.type
    }
  );
};
