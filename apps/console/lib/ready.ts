import type { CandidateIssue, FactoryConfig, ReadyIssue, ReadyList, SlackMessage } from '@mb-factory/core';
import { readyList, slackReadyMessage } from '@mb-factory/core';

import { requireEnv } from './env';
import { linearGraphql } from './linear-api';
import { log } from './log';
import { postSlackMessage } from './slack-api';

type Relation = {
  type: string;
  issue: { identifier: string; state: { type: string } };
  relatedIssue: { identifier: string };
};

type CandidateNode = {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority: number;
  estimate: number | null;
  assignee: { name: string } | null;
  delegate: { id: string } | null;
  project: { name: string; url: string; sortOrder: number; status: { type: string } } | null;
  projectMilestone: { name: string } | null;
  relations: { nodes: Relation[] };
  inverseRelations: { nodes: Relation[] };
};

// Issues nobody has started, in any of the team's projects. A hundred is far more than a team keeps unstarted in its
// projects, and keeps the query inside Linear's complexity limit; a fuller page is logged rather than paged through.
const CANDIDATES_QUERY = `query ReadyCandidates($key: String!) {
  issues(first: 100, filter: { team: { key: { eq: $key } }, project: { null: false }, state: { type: { in: ["backlog", "unstarted"] } } }) {
    nodes {
      id identifier title url priority estimate
      assignee { name }
      delegate { id }
      project { name url sortOrder status { type } }
      projectMilestone { name }
      relations(first: 10) { nodes { type issue { identifier state { type } } relatedIssue { identifier } } }
      inverseRelations(first: 10) { nodes { type issue { identifier state { type } } relatedIssue { identifier } } }
    }
    pageInfo { hasNextPage }
  }
}`;

const FINISHED_STATES = ['completed', 'canceled'];

// A `blocks` relation reads "issue blocks relatedIssue", and Linear lists it under the blocker's `relations` and the
// blocked issue's `inverseRelations`. Both lists are read, so the direction never depends on which one carries it.
const blockersOf = (node: CandidateNode): CandidateIssue['blockers'] =>
  [...node.relations.nodes, ...node.inverseRelations.nodes]
    .filter(({ type, relatedIssue }) => type === 'blocks' && relatedIssue.identifier === node.identifier)
    .map(({ issue }) => ({ identifier: issue.identifier, finished: FINISHED_STATES.includes(issue.state.type) }))
    .filter((blocker, index, all) => all.findIndex(({ identifier }) => identifier === blocker.identifier) === index);

const toCandidate = (node: CandidateNode): CandidateIssue[] =>
  node.project
    ? [
        {
          id: node.id,
          identifier: node.identifier,
          title: node.title,
          url: node.url,
          priority: node.priority,
          estimate: node.estimate,
          assignee: node.assignee?.name ?? null,
          delegated: node.delegate !== null,
          project: {
            name: node.project.name,
            url: node.project.url,
            sortOrder: node.project.sortOrder,
            statusType: node.project.status.type
          },
          milestone: node.projectMilestone?.name ?? null,
          blockers: blockersOf(node)
        }
      ]
    : [];

export const loadReadyList = async (project: FactoryConfig): Promise<ReadyList> => {
  const { issues } = await linearGraphql<{ issues: { nodes: CandidateNode[]; pageInfo: { hasNextPage: boolean } } }>(
    requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID'),
    CANDIDATES_QUERY,
    { key: project.linear.teamKey }
  );
  if (issues.pageInfo.hasNextPage) {
    log('warn', 'ready list cut short', { project: project.name, read: issues.nodes.length });
  }
  return readyList(issues.nodes.flatMap(toCandidate));
};

const CACHE_MS = 60_000;
const cached = new Map<string, { at: number; list: ReadyList }>();

// For the Inbox, which refreshes every 10 s while anything's on it: Linear is read once a minute at most per instance.
export const recentReadyList = async (project: FactoryConfig, now: Date): Promise<ReadyList> => {
  const hit = cached.get(project.name);
  if (hit && now.getTime() - hit.at < CACHE_MS) {
    return hit.list;
  }
  const list = await loadReadyList(project);
  cached.set(project.name, { at: now.getTime(), list });
  return list;
};

// Ready issues with a Delegate button each.
export const readyMessage = (project: FactoryConfig, heading: string, issues: ReadyIssue[]): SlackMessage =>
  slackReadyMessage(heading, issues, {
    alias: project.alias,
    consoleUrl: requireEnv('CONSOLE_URL'),
    emojiPrefix: project.slack?.emojiPrefix ?? 'mbf'
  });

// A message in the project's channel listing ready issues: top-level, or in the thread of the mention that asked for it.
export const postReadyMessage = async (
  project: FactoryConfig,
  heading: string,
  issues: ReadyIssue[],
  threadTs?: string
): Promise<void> => {
  if (!project.slack || issues.length === 0) {
    return;
  }
  await postSlackMessage({ channel: project.slack.channelId, threadTs, ...readyMessage(project, heading, issues) });
};
