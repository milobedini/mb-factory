import type { FactoryConfig, MergeQueueRecord, MergeQueueState } from '@mb-factory/core';
import { MERGE_QUEUE_EVENT, mergeQueueState, prsAhead, readMergeQueueRecord, usesMergeQueue } from '@mb-factory/core';
import { and, desc, eq, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { events } from '@/db/schema';

import { recordEvent } from './events';
import { mergeQueueEntries } from './github-api';
import { log } from './log';

// A repository's merge queue (docs/merge-queue.md) as the cards show it: each time the queue takes a PR or drops it
// without merging is recorded as an event, so it needs no table, and the card reads the latest back.

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const recordMergeQueue = (record: Omit<MergeQueueRecord, 'at'>): Promise<boolean> =>
  recordEvent({
    source: 'github',
    deliveryId: undefined,
    type: MERGE_QUEUE_EVENT,
    payload: { ...record, at: new Date().toISOString() }
  });

const latestRecord = async (repository: string, prNumber: number): Promise<MergeQueueRecord | undefined> => {
  const [row] = await getDb()
    .select({ payload: events.payload })
    .from(events)
    .where(
      and(
        eq(events.type, MERGE_QUEUE_EVENT),
        sql`${events.payload}->>'repository' = ${repository}`,
        sql`(${events.payload}->>'prNumber')::int = ${prNumber}`
      )
    )
    .orderBy(desc(events.receivedAt))
    .limit(1);
  return row ? readMergeQueueRecord(row.payload) : undefined;
};

// Where a PR waiting at the merge gate stands in its repository's queue; null when the repository has none, the PR was
// never queued, or GitHub's queue no longer holds it (a dequeue the console missed: the card offers the merge again).
// A queued PR's place is read from GitHub, and left out when GitHub can't be read.
export const mergeQueueStateFor = async (
  project: FactoryConfig,
  workItem: { repository: string; prNumber: number | null; stage: string; issueIdentifier: string }
): Promise<MergeQueueState | null> => {
  const { repository, prNumber } = workItem;
  if (workItem.stage !== 'awaiting_merge' || !prNumber || !usesMergeQueue(project, repository)) {
    return null;
  }
  const record = await latestRecord(repository, prNumber);
  if (!record) {
    return null;
  }
  if (record.kind === 'dropped') {
    return mergeQueueState(record, null);
  }
  try {
    const ahead = prsAhead(await mergeQueueEntries(repository, record.base), prNumber);
    return ahead ? mergeQueueState(record, ahead) : null;
  } catch (error) {
    log('warn', 'merge queue read failed', { issue: workItem.issueIdentifier, error: errorMessage(error) });
    return mergeQueueState(record, null);
  }
};
