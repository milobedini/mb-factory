import { z } from 'zod';

import type { MergeQueueState } from './card';
import type { FactoryConfig } from './config';
import { personForGitHub, personName } from './config';

// A repository's merge queue (docs/merge-queue.md), as the console records it: each time the queue takes a PR or drops
// it without merging, an event the card reads back for its "In the merge queue" or "Left the merge queue" line.

export const MERGE_QUEUE_EVENT = 'merge_queue';

const recordSchema = z.object({
  repository: z.string().min(1),
  prNumber: z.int().positive(),
  kind: z.enum(['queued', 'dropped']),
  at: z.iso.datetime(),
  // Who added it, by name; null when the factory did.
  by: z.string().nullable(),
  base: z.string().min(1),
  reason: z.string().nullable()
});

export type MergeQueueRecord = z.infer<typeof recordSchema>;

export const readMergeQueueRecord = (payload: unknown): MergeQueueRecord | undefined =>
  recordSchema.safeParse(payload).data;

// Who added a PR to the queue, as the card names them: the factory's App (any bot) is null, a person their name from
// the project's people, else their GitHub login.
export const queuedBy = (
  project: Pick<FactoryConfig, 'people'>,
  sender: { id: number; login: string } | null
): string | null => {
  if (!sender || sender.login.endsWith('[bot]')) {
    return null;
  }
  const person = personForGitHub(project, sender.id);
  return person ? personName(person) : sender.login;
};

// The PRs in front of `prNumber` in the queue's entries, front first; null when it isn't among them, as when GitHub's
// list is from before it joined.
export const prsAhead = (entries: { position: number; prNumber: number }[], prNumber: number): number[] | null => {
  const own = entries.find((entry) => entry.prNumber === prNumber);
  return own
    ? entries
        .filter(({ position }) => position < own.position)
        .toSorted((a, b) => a.position - b.position)
        .map((entry) => entry.prNumber)
    : null;
};

// The card's view of the latest record: a queued PR's place comes from GitHub, read as the card is drawn.
export const mergeQueueState = (record: MergeQueueRecord, ahead: number[] | null): MergeQueueState =>
  record.kind === 'queued'
    ? { kind: 'queued', at: new Date(record.at), by: record.by, base: record.base, ahead }
    : { kind: 'dropped', at: new Date(record.at), reason: record.reason };
