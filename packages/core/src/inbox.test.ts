import { describe, expect, it } from 'vitest';

import type { InboxQuestion, InboxRun } from './inbox';
import { checksState, inboxEntry } from './inbox';

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 26, 9, minute));

const run = (overrides: Partial<InboxRun> = {}): InboxRun => ({
  agent: 'spec',
  status: 'finished',
  outcome: 'done',
  createdAt: at(0),
  finishedAt: at(5),
  ...overrides
});

const question = (overrides: Partial<InboxQuestion> = {}): InboxQuestion => ({
  answeredAt: null,
  closedAt: null,
  askedAt: at(6),
  createdAt: at(5),
  ...overrides
});

const item = (stage: Parameters<typeof inboxEntry>[0]['stage']) => ({ stage, updatedAt: at(30) });

describe('inboxEntry', () => {
  it('waits on open questions from when the first was asked, counting the answered ones', () => {
    const round = [question({ answeredAt: at(7), askedAt: at(6) }), question({ askedAt: at(7) }), question()];
    expect(inboxEntry(item('spec'), [run({ outcome: 'needs_input' })], round)).toEqual({
      kind: 'questions',
      since: at(6),
      open: 2,
      answered: 1
    });
  });

  it('waits at the gates from when the run before finished', () => {
    expect(inboxEntry(item('spec_review'), [run()], [])).toEqual({ kind: 'spec_review', since: at(5), agent: 'spec' });
    expect(inboxEntry(item('design_review'), [run({ agent: 'design' })], [])).toEqual({
      kind: 'design_review',
      since: at(5),
      agent: 'design'
    });
    expect(inboxEntry(item('awaiting_merge'), [run({ agent: 'review', finishedAt: at(9) })], [])).toEqual({
      kind: 'awaiting_merge',
      since: at(9),
      agent: 'review'
    });
  });

  it('waits on a run that failed or was blocked, until a later run replaces it', () => {
    expect(inboxEntry(item('building'), [run({ agent: 'implement', outcome: 'failed' })], [])?.kind).toBe('run_ended');
    expect(inboxEntry(item('building'), [run({ outcome: 'blocked' })], [])?.kind).toBe('run_ended');
    expect(
      inboxEntry(item('building'), [run({ outcome: 'failed' }), run({ agent: 'implement', status: 'running' })], [])
    ).toBeUndefined();
  });

  it('waits for a reply after a run that asked in its own words or handed the work back', () => {
    expect(inboxEntry(item('spec'), [run({ outcome: 'needs_input' })], [])?.kind).toBe('reply_needed');
    expect(inboxEntry(item('researching'), [run({ agent: 'triage', outcome: 'done' })], [])?.kind).toBe('reply_needed');
  });

  it('waits on nothing while the factory works, once settled, or after a stop or a decline', () => {
    expect(inboxEntry(item('spec_review'), [run(), run({ status: 'queued', finishedAt: null })], [])).toBeUndefined();
    expect(inboxEntry(item('done'), [run()], [question()])).toBeUndefined();
    expect(inboxEntry(item('canceled'), [run({ outcome: 'failed' })], [])).toBeUndefined();
    expect(inboxEntry(item('building'), [run({ outcome: 'stopped' })], [])).toBeUndefined();
    expect(inboxEntry(item('researching'), [run({ agent: 'triage', outcome: 'declined' })], [])).toBeUndefined();
  });

  it('ignores a round that was answered or closed', () => {
    const round = [question({ answeredAt: at(7) }), question({ closedAt: at(8) })];
    expect(inboxEntry(item('spec'), [run({ outcome: 'needs_input' })], round)?.kind).toBe('reply_needed');
  });

  it('falls back to when the work item last changed', () => {
    expect(inboxEntry(item('awaiting_merge'), [], [])).toEqual({ kind: 'awaiting_merge', since: at(30), agent: null });
  });
});

describe('checksState', () => {
  it('fails on any failure, waits on anything unfinished, and passes otherwise', () => {
    expect(checksState([])).toBe('none');
    expect(
      checksState([
        { status: 'completed', conclusion: 'success' },
        { status: 'completed', conclusion: 'failure' },
        { status: 'in_progress', conclusion: null }
      ])
    ).toBe('failing');
    expect(
      checksState([
        { status: 'completed', conclusion: 'success' },
        { status: 'queued', conclusion: null }
      ])
    ).toBe('pending');
    expect(
      checksState([
        { status: 'completed', conclusion: 'success' },
        { status: 'completed', conclusion: 'skipped' }
      ])
    ).toBe('passing');
  });
});
