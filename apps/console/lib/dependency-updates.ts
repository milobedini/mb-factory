import type {
  DependencyPr,
  DependencyUpdate,
  DependencyUpdateStatus,
  FactoryConfig,
  SlackMessage
} from '@mb-factory/core';
import {
  DEPENDENCY_UPDATE_EVENT,
  dependencyMentions,
  dependencyUpdateCard,
  dependencyUpdateFor,
  escapeSlack,
  mentioning,
  mergeRoute,
  onlyDependabotCommits,
  readDependencyUpdate,
  usesMergeQueue
} from '@mb-factory/core';
import { and, desc, eq, gt, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { events, workItems } from '@/db/schema';

import { recordEvent } from './events';
import type { GitHubRefusal } from './github-api';
import {
  compareFiles,
  defaultBranch,
  enqueuePull,
  headChecks,
  mergePull,
  pullCommits,
  pullForMerge
} from './github-api';
import { appToken } from './github-app';
import { log } from './log';
import { mergeQueueStateFor, recordMergeQueue } from './merge-queue';
import { allProjects, repositoryOf } from './projects';
import { postSlackMessage, updateSlackMessage } from './slack-api';

// Dependabot's routine updates merge themselves (core `dependency-updates.ts`): the card is posted when Dependabot opens
// the PR, redrawn as its checks report, and the App adds it to the merge queue once they pass and the merge rules leave
// it to the factory. Majors and failing updates are taken on as work items instead (router `takeOnDependencyPr`).

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const projectFor = (repository: string): FactoryConfig | undefined =>
  allProjects().find((project) => repositoryOf(project) === repository);

const cardOptions = (project: FactoryConfig) => ({
  timeZone: project.timeZone,
  emojiPrefix: project.slack?.emojiPrefix ?? 'mbf'
});

const draw = async (project: FactoryConfig, update: DependencyUpdate, status: DependencyUpdateStatus) => {
  const card = dependencyUpdateCard(update, status, cardOptions(project));
  await updateSlackMessage({ channel: update.channel, ts: update.ts, ...card });
};

export const replyToDependencyUpdate = (update: DependencyUpdate, message: string | SlackMessage) =>
  postSlackMessage({
    channel: update.channel,
    threadTs: update.ts,
    ...(typeof message === 'string' ? { text: message } : message)
  });

// The routine update recorded for a PR, if Dependabot's PR got a card.
export const findDependencyUpdate = async (
  repository: string,
  prNumber: number
): Promise<DependencyUpdate | undefined> => {
  const [row] = await getDb()
    .select({ payload: events.payload })
    .from(events)
    .where(
      and(
        eq(events.type, DEPENDENCY_UPDATE_EVENT),
        sql`${events.payload}->>'repository' = ${repository}`,
        sql`(${events.payload}->>'prNumber')::int = ${prNumber}`
      )
    )
    .orderBy(desc(events.receivedAt))
    .limit(1);
  return row ? readDependencyUpdate(row.payload) : undefined;
};

const OPEN_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

// The routine updates opened in the last fortnight whose PRs may still be open, for a check event to find its card.
// Dependabot reopens what's left after that.
export const openDependencyUpdates = async (repository: string): Promise<DependencyUpdate[]> => {
  const rows = await getDb()
    .select({ payload: events.payload })
    .from(events)
    .where(
      and(
        eq(events.type, DEPENDENCY_UPDATE_EVENT),
        sql`${events.payload}->>'repository' = ${repository}`,
        gt(events.receivedAt, new Date(Date.now() - OPEN_LOOKBACK_MS))
      )
    );
  return rows.flatMap(({ payload }) => readDependencyUpdate(payload) ?? []);
};

// Dependabot opened a patch or minor update: its card goes in the project's channel. Said once per PR.
export const openDependencyUpdate = async (pr: DependencyPr): Promise<void> => {
  const project = projectFor(pr.repository);
  const channel = project?.slack?.channelId;
  if (!project || !channel || (await findDependencyUpdate(pr.repository, pr.number))) {
    return;
  }
  const draft = dependencyUpdateFor(pr, { channel, ts: 'unposted' }, new Date());
  const card = dependencyUpdateCard(draft, { kind: 'checking', checks: null }, cardOptions(project));
  const ts = await postSlackMessage({ channel, ...card });
  await recordEvent({
    source: 'github',
    deliveryId: `dependency-update:${pr.repository}#${pr.number}`,
    type: DEPENDENCY_UPDATE_EVENT,
    payload: { ...draft, ts }
  });
  log('info', 'dependency update opened', { pr: pr.number, title: draft.title, updates: draft.total });
};

// The factory took the PR on as a work item (its checks failed): that item's card and thread follow it from there.
export const takenOn = async (repository: string, prNumber: number): Promise<boolean> =>
  (
    await getDb()
      .select({ id: workItems.id })
      .from(workItems)
      .where(and(eq(workItems.repository, repository), eq(workItems.prNumber, prNumber)))
      .limit(1)
  ).length > 0;

const land = (project: FactoryConfig, token: string, repository: string, prNumber: number, sha: string) =>
  usesMergeQueue(project, repository)
    ? enqueuePull(token, repository, prNumber, sha)
    : mergePull(token, repository, prNumber, sha);

// Held for the person: the card says why, and they're mentioned once per head.
const waitFor = async (project: FactoryConfig, update: DependencyUpdate, reasons: string[], head: string) => {
  await draw(project, update, { kind: 'waiting', reasons });
  const first = await recordEvent({
    source: 'github',
    deliveryId: `dependency-wait:${update.repository}#${update.prNumber}:${head}`,
    type: 'dependency_wait',
    payload: { repository: update.repository, prNumber: update.prNumber, head, reasons }
  });
  if (first) {
    log('info', 'dependency update waits', { pr: update.prNumber, reasons: reasons.join('; ') });
    const text = `PR #${update.prNumber} won’t merge by itself: ${reasons.map(escapeSlack).join('; ')}. Merge it on GitHub, or close it to skip these versions.`;
    await replyToDependencyUpdate(update, mentioning(text, dependencyMentions(project)));
  }
};

// A check reported on the PR: the card shows where they stand, and once every one passes the factory merges it, if the
// merge rules leave it to the factory. Failing checks are left to the router, which hands the PR to the factory.
export const checkDependencyUpdate = async (update: DependencyUpdate): Promise<void> => {
  const project = projectFor(update.repository);
  if (!project || (await takenOn(update.repository, update.prNumber))) {
    return;
  }
  const { repository, prNumber } = update;
  const pull = await pullForMerge(repository, prNumber);
  if (pull.state !== 'open' || pull.merged) {
    return;
  }
  const queue = await mergeQueueStateFor(project, {
    repository,
    prNumber,
    stage: 'awaiting_merge',
    issueIdentifier: `PR #${prNumber}`
  });
  if (queue?.kind === 'queued') {
    await draw(project, update, { kind: 'queued', queue });
    return;
  }
  const checks = await headChecks(repository, pull.head);
  if (checks.state !== 'passing') {
    await draw(project, update, { kind: 'checking', checks });
    return;
  }
  const rules = project.express?.merge;
  const mainBranch = await defaultBranch(repository);
  const route = rules?.auto
    ? mergeRoute(rules, { files: await compareFiles(repository, pull.base, pull.head) })
    : { route: 'person' as const, reasons: ['the project doesn’t let the factory merge'] };
  const fromDependabot = onlyDependabotCommits(await pullCommits(repository, prNumber));
  const reasons = [
    ...(fromDependabot ? [] : ['it has commits Dependabot didn’t make']),
    ...(route.route === 'person' ? route.reasons : []),
    ...(pull.base !== mainBranch ? [`it targets ${pull.base}, not ${mainBranch}`] : []),
    ...(queue?.kind === 'dropped' ? [`it left the merge queue (${queue.reason ?? 'no reason given'})`] : []),
    ...(pull.mergeable === false ? ['it conflicts with its base'] : []),
    ...(pull.behind && !usesMergeQueue(project, repository) ? ['it’s behind its base'] : [])
  ];
  if (reasons.length > 0) {
    await waitFor(project, update, reasons, pull.head);
    return;
  }
  const first = await recordEvent({
    source: 'github',
    deliveryId: `dependency-merge:${repository}#${prNumber}:${pull.head}`,
    type: 'dependency_merge',
    payload: { repository, prNumber, sha: pull.head }
  });
  if (!first) {
    return;
  }
  const landed = await appToken(repository).then(
    (token) => land(project, token, repository, prNumber, pull.head),
    (error: unknown): GitHubRefusal => ({ ok: false, message: errorMessage(error) })
  );
  if (!landed.ok) {
    log('warn', 'dependency update refused', { pr: prNumber, error: landed.message });
    await waitFor(project, update, [`GitHub refused it: “${landed.message}”`], pull.head);
    return;
  }
  log('info', 'dependency update landed by itself', { pr: prNumber, sha: pull.head });
  if (usesMergeQueue(project, repository)) {
    await recordMergeQueue({ repository, prNumber, kind: 'queued', by: null, base: pull.base, reason: null });
    const queued = await mergeQueueStateFor(project, {
      repository,
      prNumber,
      stage: 'awaiting_merge',
      issueIdentifier: `PR #${prNumber}`
    });
    if (queued?.kind === 'queued') {
      await draw(project, update, { kind: 'queued', queue: queued });
    }
  }
};

// The queue dropped it without merging: it waits for the person.
export const dependencyUpdateDropped = async (update: DependencyUpdate, reason: string | null, head: string) => {
  const project = projectFor(update.repository);
  if (project) {
    await waitFor(project, update, [`it left the merge queue (${reason ?? 'no reason given'})`], head);
  }
};

// Its checks failed and the factory took it on: the card points at the issue.
export const dependencyUpdateHanded = async (
  update: DependencyUpdate,
  issue: { identifier: string; url: string }
): Promise<void> => {
  const project = projectFor(update.repository);
  if (project) {
    await draw(project, update, { kind: 'handed', issue });
  }
};

// Merged or closed: the card settles; a merge the App made is watched until `watchingUntil`.
export const dependencyUpdateClosed = async (
  update: DependencyUpdate,
  closed: { merged: boolean; at: Date; sha: string | null; watchingUntil: Date | null }
): Promise<void> => {
  const project = projectFor(update.repository);
  if (!project) {
    return;
  }
  const { at } = closed;
  await draw(
    project,
    update,
    closed.merged
      ? { kind: 'merged', at, sha: closed.sha, watchingUntil: closed.watchingUntil }
      : { kind: 'closed', at }
  );
};
