import type { ChecksState, InboxEntry } from '@mb-factory/core';
import { inboxEntry, OPEN_RUN_STATUSES, slackMessageUrl, specUrl, TERMINAL_STAGES } from '@mb-factory/core';
import { asc, inArray, notInArray } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { questions, runs, workItems } from '@/db/schema';

import { branchChecks } from './github-api';
import { log } from './log';
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
  summary: string | null;
};

export type InboxView = { user: ConsoleUser; now: Date; items: InboxItem[]; working: boolean };

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const actionUrlFor = (workItem: WorkItem, entry: InboxEntry, actionsRunUrl: string | null): string | null => {
  const prUrl = workItem.prNumber ? `https://github.com/${workItem.repository}/pull/${workItem.prNumber}` : null;
  if (entry.kind === 'spec_review') {
    return specUrl(workItem);
  }
  if (entry.kind === 'awaiting_merge') {
    return prUrl ? `${prUrl}/files` : null;
  }
  return entry.kind === 'run_ended' ? actionsRunUrl : null;
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
  const db = getDb();
  const [items, working, workspaceUrl] = await Promise.all([
    db.select().from(workItems).where(notInArray(workItems.stage, TERMINAL_STAGES)),
    db.select({ id: runs.id }).from(runs).where(inArray(runs.status, OPEN_RUN_STATUSES)).limit(1),
    slackWorkspaceUrl().catch((error: unknown) => {
      log('warn', 'slack workspace url failed', { error: errorMessage(error) });
      return null;
    })
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
      actionUrl: actionUrlFor(workItem, entry, latest?.actionsRunUrl ?? null),
      threadUrl:
        workspaceUrl && workItem.slackChannelId && workItem.slackThreadTs
          ? slackMessageUrl(workspaceUrl, workItem.slackChannelId, workItem.slackThreadTs)
          : null,
      checks: entry.kind === 'awaiting_merge' ? await checksFor(workItem) : null,
      summary: latest?.summary ?? null
    }))
  );

  return {
    user,
    now: new Date(),
    items: withChecks.toSorted((a, b) => a.entry.since.getTime() - b.entry.since.getTime()),
    working: working.length > 0
  };
};
