import { describe, expect, it } from 'vitest';

import { mergeQueueState, prsAhead, queuedBy, readMergeQueueRecord } from './merge-queue';

const people = {
  people: [
    {
      linear: 'milobedini64@gmail.com',
      git: 'Milo Bedini <89992629+milobedini@users.noreply.github.com>',
      github: 89992629
    }
  ]
} as Parameters<typeof queuedBy>[0];

describe('queuedBy', () => {
  it('names a person from the project’s people, else by login', () => {
    expect(queuedBy(people, { id: 89992629, login: 'milobedini' })).toBe('Milo Bedini');
    expect(queuedBy(people, { id: 1, login: 'someone' })).toBe('someone');
  });

  it('is null for the factory’s App or an unknown sender', () => {
    expect(queuedBy(people, { id: 2, login: 'mb-factory-bot[bot]' })).toBeNull();
    expect(queuedBy(people, null)).toBeNull();
  });
});

describe('prsAhead', () => {
  const entries = [
    { position: 2, prNumber: 208 },
    { position: 1, prNumber: 207 },
    { position: 3, prNumber: 209 }
  ];

  it('lists the PRs in front, front first', () => {
    expect(prsAhead(entries, 209)).toEqual([207, 208]);
    expect(prsAhead(entries, 207)).toEqual([]);
  });

  it('is null for a PR not in the queue', () => {
    expect(prsAhead(entries, 300)).toBeNull();
  });
});

describe('mergeQueueState', () => {
  const record = {
    repository: 'Milo-Bedini/tastebook',
    prNumber: 208,
    kind: 'queued',
    at: '2026-11-10T15:52:31.000Z',
    by: 'Milo Bedini',
    base: 'main',
    reason: null
  };

  it('reads a stored record back, and refuses one that isn’t', () => {
    expect(readMergeQueueRecord(record)).toEqual(record);
    expect(readMergeQueueRecord({ ...record, kind: 'merged' })).toBeUndefined();
  });

  it('turns a queued record into the card’s state with the PRs ahead, and a dropped one with its reason', () => {
    const queued = readMergeQueueRecord(record);
    const dropped = readMergeQueueRecord({ ...record, kind: 'dropped', reason: 'CI_FAILURE' });
    if (!queued || !dropped) {
      throw new Error('unread');
    }
    expect(mergeQueueState(queued, [207])).toEqual({
      kind: 'queued',
      at: new Date('2026-11-10T15:52:31.000Z'),
      by: 'Milo Bedini',
      base: 'main',
      ahead: [207]
    });
    expect(mergeQueueState(dropped, null)).toEqual({
      kind: 'dropped',
      at: new Date('2026-11-10T15:52:31.000Z'),
      reason: 'CI_FAILURE'
    });
  });
});
