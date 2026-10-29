import type { ChecksState, InboxEntry, ReadyList } from '@mb-factory/core';
import { inboxEntry, OPEN_RUN_STATUSES, readCanvas, slackMessageUrl, specUrl, TERMINAL_STAGES } from '@mb-factory/core';
import { and, asc, inArray, isNull, notInArray } from 'drizzle-orm';
import { connection } from 'next/server';

import { getDb } from '@/db/client';
import { questions, runs, workItems } from '@/db/schema';

import { branchChecks, pullMergeState } from './github-api';
import { log } from './log';
import { allProjects } from './projects';
import { recentReadyList } from './ready';
import { releaseQueueOnActivity } from './router';
import type { ConsoleUser } from './session';
import { requireConsoleUser } from './session';
import { slackWorkspaceUrl } from './slack-api';

type WorkItem = typeof workItems.$inferSelect;

export type InboxItem = {
  workItem: WorkItem;
  entry: InboxEntry;
  // Where to act on it: the spec file, the PR's review page, or the run's log.
  actionUrl: string | null;
  threadUrl: string | null;
  // CI on the PR, for work waiting to be merged; null when GitHub couldn't say.
  checks: ChecksState | null;
  // Whether a PR waiting to be merged conflicts with its base branch, and which branch that is.
  conflictsWith: string | null;
  summary: string | null;
};

// What each project could start next; `list` is null when Linear couldn't be read.
export type ProjectReady = { project: string; list: ReadyList | null };

export type InboxView = { user: ConsoleUser; now: Date; items: InboxItem[]; working: boolean; ready: ProjectReady[] };

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const actionUrlFor = (
  workItem: WorkItem,
  entry: InboxEntry,
  latest: { actionsRunUrl: string | null; report: unknown } | undefined
): string | null => {
  const prUrl = workItem.prNumber ? `https://github.com/${workItem.repository}/pull/${workItem.prNumber}` : null;
  if (entry.kind === 'spec_review') {
    return specUrl(workItem);
  }
  // Design Review waits on the design run that drew the canvas.
  if (entry.kind === 'design_review') {
    return readCanvas(latest?.report);
  }
  if (entry.kind === 'awaiting_merge') {
    return prUrl ? `${prUrl}/files` : null;
  }
  return entry.kind === 'run_ended' ? (latest?.actionsRunUrl ?? null) : null;
};

// One look, without waiting for GitHub to finish working it out: the page refreshes anyway.
const conflictFor = async (workItem: WorkItem): Promise<string | null> => {
  if (!workItem.prNumber) {
    return null;
  }
  try {
    const { mergeable, base } = await pullMergeState(workItem.repository, workItem.prNumber, []);
    return mergeable === false ? base : null;
  } catch (error) {
    log('warn', 'inbox merge state failed', { issue: workItem.issueIdentifier, error: errorMessage(error) });
    return null;
  }
};

const checksFor = async (workItem: WorkItem): Promise<ChecksState | null> => {
  if (!workItem.branch) {
    return null;
  }
  try {
    return await branchChecks(workItem.repository, workItem.branch);
  } catch (error) {
    log('warn', 'inbox checks failed', { issue: workItem.issueIdentifier, error: errorMessage(error) });
    return null;
  }
};

// The Inbox's data: every unsettled work item that's waiting on a person, oldest first. Checks the session first.
export const loadInboxView = async (): Promise<InboxView> => {
  const user = await requireConsoleUser();
  // Before the reads, so the page shows what this released, and only on a real request: in a prerender (including
  // the one a prefetch runs, which has the cookies) the database driver's fetches are cut off.
  await connection();
  await releaseQueueOnActivity('inbox page');
  const db = getDb();
  const now = new Date();
  const [items, working, workspaceUrl, ready] = await Promise.all([
    db
      .select()
      .from(workItems)
      .where(and(notInArray(workItems.stage, TERMINAL_STAGES), isNull(workItems.undelegatedAt))),
    db.select({ id: runs.id }).from(runs).where(inArray(runs.status, OPEN_RUN_STATUSES)).limit(1),
    slackWorkspaceUrl().catch((error: unknown) => {
      log('warn', 'slack workspace url failed', { error: errorMessage(error) });
      return null;
    }),
    Promise.all(
      allProjects().map(async (project) => ({
        project: project.alias,
        list: await recentReadyList(project, now).catch((error: unknown) => {
          log('warn', 'ready list failed', { project: project.name, error: errorMessage(error) });
          return null;
        })
      }))
    )
  ]);
  const ids = items.map(({ id }) => id);
  const itemRuns =
    ids.length === 0
      ? []
      : await db.select().from(runs).where(inArray(runs.workItemId, ids)).orderBy(asc(runs.createdAt));
  const asked =
    itemRuns.length === 0
      ? []
      : await db
          .select()
          .from(questions)
          .where(
            inArray(
              questions.runId,
              itemRuns.map(({ id }) => id)
            )
          );

  const waiting = items.flatMap((workItem) => {
    const own = itemRuns.filter(({ workItemId }) => workItemId === workItem.id);
    // The latest round is the latest run's that asked anything.
    const askingRun = own.findLast(({ id }) => asked.some(({ runId }) => runId === id));
    const round = askingRun ? asked.filter(({ runId }) => runId === askingRun.id) : [];
    const entry = inboxEntry(workItem, own, round);
    const latest = own.at(-1);
    return entry ? [{ workItem, entry, latest }] : [];
  });

  const withChecks = await Promise.all(
    waiting.map(async ({ workItem, entry, latest }) => ({
      workItem,
      entry,
      actionUrl: actionUrlFor(workItem, entry, latest),
      threadUrl:
        workspaceUrl && workItem.slackChannelId && workItem.slackThreadTs
          ? slackMessageUrl(workspaceUrl, workItem.slackChannelId, workItem.slackThreadTs)
          : null,
      checks: entry.kind === 'awaiting_merge' ? await checksFor(workItem) : null,
      conflictsWith: entry.kind === 'awaiting_merge' ? await conflictFor(workItem) : null,
      summary: latest?.summary ?? null
    }))
  );

  return {
    user,
    now: new Date(),
    items: withChecks.toSorted((a, b) => a.entry.since.getTime() - b.entry.since.getTime()),
    working: working.length > 0,
    ready
  };
};
