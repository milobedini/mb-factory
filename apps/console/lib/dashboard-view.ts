import type {
  Dashboard,
  DashboardAnswer,
  DashboardRange,
  DashboardRun,
  DashboardWorkItem,
  ExpressComparison,
  Fix,
  SentryIssue
} from '@mb-factory/core';
import {
  dashboardMetrics,
  EXPRESS_BASELINE,
  expressAgainstBaseline,
  MERGE_WATCH_EVENT,
  REVERT_EVENT
} from '@mb-factory/core';
import { and, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { connection } from 'next/server';

import { getDb } from '@/db/client';
import { events, prFixes, questions, runs, stageChanges, workItems } from '@/db/schema';

import { log } from './log';
import { allProjects, consoleTimeZone } from './projects';
import { releaseQueueOnActivity } from './router';
import { sentryIssuesFirstSeen } from './sentry-api';
import type { ConsoleUser } from './session';
import { requireConsoleUser } from './session';

const DAY_MS = 24 * 60 * 60 * 1000;

export type DashboardView = {
  user: ConsoleUser;
  days: DashboardRange;
  dashboard: Dashboard;
  express: ExpressComparison;
};

type PrTimes = Pick<DashboardWorkItem, 'prOpenedAt' | 'mergedAt' | 'closedAt'>;

const NO_PR: PrTimes = { prOpenedAt: null, mergedAt: null, closedAt: null };

// When each work item's PR was opened, and merged or closed, from its webhooks: the first opening and the last close.
const loadPrTimes = async (items: (typeof workItems.$inferSelect)[]): Promise<Map<string, PrTimes>> => {
  const numbers = [...new Set(items.flatMap(({ prNumber }) => (prNumber === null ? [] : [prNumber])))];
  if (numbers.length === 0) {
    return new Map();
  }
  const number = sql<number>`(${events.payload}->'pull_request'->>'number')::integer`;
  const repository = sql<string>`${events.payload}->'repository'->>'full_name'`;
  const rows = await getDb()
    .select({
      action: events.action,
      repository,
      number,
      merged: sql<boolean>`coalesce((${events.payload}->'pull_request'->>'merged')::boolean, false)`,
      at: events.receivedAt
    })
    .from(events)
    .where(
      and(
        eq(events.source, 'github'),
        eq(events.type, 'pull_request'),
        inArray(events.action, ['opened', 'closed']),
        inArray(number, numbers)
      )
    )
    .orderBy(events.receivedAt);
  return new Map(
    items.map((item) => {
      const own = rows.filter((row) => row.repository === item.repository && row.number === item.prNumber);
      const opened = own.find(({ action }) => action === 'opened');
      const closed = own.findLast(({ action }) => action === 'closed');
      return [
        item.id,
        {
          prOpenedAt: opened?.at ?? null,
          mergedAt: closed?.merged ? closed.at : null,
          closedAt: closed && !closed.merged ? closed.at : null
        }
      ];
    })
  );
};

const toDashboardRun = (run: typeof runs.$inferSelect): DashboardRun => ({
  id: run.id,
  parentRunId: run.parentRunId,
  workItemId: run.workItemId,
  agent: run.agent,
  model: run.model,
  trigger: run.trigger,
  status: run.status,
  outcome: run.outcome,
  report: run.report,
  costUsd: run.costUsd,
  inputTokens: run.inputTokens,
  outputTokens: run.outputTokens,
  cacheReadInputTokens: run.cacheReadInputTokens,
  cacheCreationInputTokens: run.cacheCreationInputTokens,
  createdAt: run.createdAt,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt
});

// The work items the factory merged itself (a watch was started) and those reverted from a watch.
const loadWatched = async (ids: string[]): Promise<{ autoMerged: Set<string>; reverted: Set<string> }> => {
  const workItemId = sql<string>`${events.payload}->>'workItemId'`;
  const rows = await getDb()
    .select({ type: events.type, workItemId })
    .from(events)
    .where(and(inArray(events.type, [MERGE_WATCH_EVENT, REVERT_EVENT]), inArray(workItemId, ids)));
  const of = (type: string): Set<string> =>
    new Set(rows.filter((row) => row.type === type).map((row) => row.workItemId));
  return { autoMerged: of(MERGE_WATCH_EVENT), reverted: of(REVERT_EVENT) };
};

const loadFixes = async (): Promise<Fix[]> => {
  const rows = await getDb().select().from(prFixes).where(gte(prFixes.mergedAt, EXPRESS_BASELINE.from));
  return rows.map((row) => ({
    repository: row.repository,
    prNumber: row.prNumber,
    issue: row.issueIdentifier,
    mergedAt: row.mergedAt,
    byPrNumber: row.byPrNumber,
    byIssue: row.byIssueIdentifier,
    byMergedAt: row.byMergedAt,
    kind: row.kind
  }));
};

// Each project's Sentry issues first seen since the baseline began; null for one that couldn't be read.
const loadSentry = async (now: Date): Promise<Map<string, SentryIssue[] | null>> =>
  new Map(
    await Promise.all(
      allProjects().flatMap(({ name, sentry }) =>
        sentry
          ? [
              sentryIssuesFirstSeen(sentry, EXPRESS_BASELINE.from, now).then(
                (issues): [string, SentryIssue[] | null] => [name, issues],
                (error: unknown): [string, SentryIssue[] | null] => {
                  log('warn', 'dashboard sentry read failed', {
                    project: name,
                    error: error instanceof Error ? error.message : String(error)
                  });
                  return [name, null];
                }
              )
            ]
          : []
      )
    )
  );

// The dashboard's data for the last `days` days. Work items count if they changed in the range or ran in it; a PR's
// cost takes all its runs, even those before the range. Checks the session first.
export const loadDashboardView = async (days: DashboardRange): Promise<DashboardView> => {
  const user = await requireConsoleUser();
  // As on the other pages: release held work before the reads, and only on a real request.
  await connection();
  await releaseQueueOnActivity('dashboard page');
  const db = getDb();
  const now = new Date();
  const from = new Date(now.getTime() - days * DAY_MS);
  // Express against the baseline needs the baseline's PRs whatever the range.
  const itemsFrom = new Date(Math.min(from.getTime(), EXPRESS_BASELINE.from.getTime()));
  const ranInRange = db
    .selectDistinct({ id: runs.workItemId })
    .from(runs)
    .where(and(gte(runs.createdAt, from), isNotNull(runs.workItemId)));
  const [items, jobRuns] = await Promise.all([
    db
      .select()
      .from(workItems)
      .where(or(gte(workItems.updatedAt, itemsFrom), inArray(workItems.id, ranInRange))),
    db
      .select()
      .from(runs)
      .where(and(isNull(runs.workItemId), gte(runs.createdAt, from)))
  ]);
  const ids = items.map(({ id }) => id);
  const [itemRuns, changes, asked, prTimes, answered, watched, fixes, sentry] =
    ids.length === 0
      ? [
          [],
          [],
          [],
          new Map<string, PrTimes>(),
          [],
          { autoMerged: new Set<string>(), reverted: new Set<string>() },
          [],
          new Map<string, SentryIssue[] | null>()
        ]
      : await Promise.all([
          db.select().from(runs).where(inArray(runs.workItemId, ids)),
          db
            .select({ workItemId: stageChanges.workItemId, stage: stageChanges.stage, at: stageChanges.at })
            .from(stageChanges)
            .where(inArray(stageChanges.workItemId, ids)),
          db
            .select({ workItemId: runs.workItemId, askedAt: questions.askedAt, answeredAt: questions.answeredAt })
            .from(questions)
            .innerJoin(runs, eq(questions.runId, runs.id))
            .where(and(inArray(runs.workItemId, ids), isNotNull(questions.askedAt))),
          loadPrTimes(items),
          db
            .select({
              workItemId: runs.workItemId,
              runId: questions.runId,
              source: questions.answerSource,
              answeredAt: questions.answeredAt
            })
            .from(questions)
            .innerJoin(runs, eq(questions.runId, runs.id))
            .where(and(inArray(runs.workItemId, ids), isNotNull(questions.answeredAt))),
          loadWatched(ids),
          loadFixes(),
          loadSentry(now)
        ]);
  const dashboardItems: DashboardWorkItem[] = items.map((item) => ({
    id: item.id,
    project: item.project,
    repository: item.repository,
    prNumber: item.prNumber,
    identifier: item.issueIdentifier,
    title: item.title,
    url: item.issueUrl,
    origin: item.origin,
    estimate: item.estimate,
    humanPushes: item.humanPushes,
    track: item.track,
    createdAt: item.createdAt,
    ...(prTimes.get(item.id) ?? NO_PR)
  }));
  const dashboardRuns = [...itemRuns, ...jobRuns].map(toDashboardRun);
  const askedQuestions = asked.flatMap(({ workItemId, askedAt, answeredAt }) =>
    workItemId && askedAt ? [{ workItemId, askedAt, answeredAt }] : []
  );
  const answers = answered.flatMap(({ workItemId, runId, source, answeredAt }): DashboardAnswer[] =>
    workItemId && source && answeredAt ? [{ workItemId, runId, source, answeredAt }] : []
  );
  return {
    user,
    days,
    express: expressAgainstBaseline({
      now,
      days,
      workItems: dashboardItems,
      stageChanges: changes,
      runs: dashboardRuns,
      questions: askedQuestions,
      answers,
      ...watched,
      fixes,
      sentry
    }),
    dashboard: dashboardMetrics({
      now,
      days,
      timeZone: consoleTimeZone(),
      workItems: dashboardItems,
      stageChanges: changes,
      runs: dashboardRuns,
      questions: askedQuestions
    })
  };
};
