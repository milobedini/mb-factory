import { describe, expect, it } from 'vitest';

import { transition } from './stages';

const context = { reviewRounds: 0, maxReviewRounds: 2 };

describe('transition', () => {
  it.each([
    [true, 'spec'],
    [false, 'building']
  ] as const)('routes triaged work with needsSpec=%s to %s', (needsSpec, expected) => {
    expect(transition('researching', { type: 'triaged', needsSpec }, context)).toEqual({ ok: true, stage: expected });
  });

  it('waits for a human after the spec is written', () => {
    expect(transition('spec', { type: 'spec_written' }, context)).toEqual({ ok: true, stage: 'spec_review' });
  });

  it('sends requested spec changes back to the spec stage', () => {
    expect(transition('spec_review', { type: 'spec_changes_requested' }, context)).toEqual({ ok: true, stage: 'spec' });
  });

  it('sends a revision back to building while review rounds remain', () => {
    expect(transition('in_review', { type: 'reviewed', verdict: 'revision_needed' }, context)).toEqual({
      ok: true,
      stage: 'building'
    });
  });

  it('hands a revision to a human once the review round cap is reached', () => {
    expect(
      transition('in_review', { type: 'reviewed', verdict: 'revision_needed' }, { reviewRounds: 2, maxReviewRounds: 2 })
    ).toEqual({ ok: true, stage: 'awaiting_merge' });
  });

  it('hands work needing a human decision straight to the merge gate', () => {
    expect(transition('in_review', { type: 'reviewed', verdict: 'human_decision_needed' }, context)).toEqual({
      ok: true,
      stage: 'awaiting_merge'
    });
  });

  it('completes on merge and cancels when the PR closes unmerged', () => {
    expect(transition('awaiting_merge', { type: 'merged' }, context)).toEqual({ ok: true, stage: 'done' });
    expect(transition('awaiting_merge', { type: 'closed_unmerged' }, context)).toEqual({ ok: true, stage: 'canceled' });
  });

  it('cancels from any active stage', () => {
    expect(transition('building', { type: 'canceled' }, context)).toEqual({ ok: true, stage: 'canceled' });
  });

  it('rejects an event that does not belong to the current stage', () => {
    expect(transition('spec_review', { type: 'pr_opened' }, context)).toEqual({
      ok: false,
      error: 'Event pr_opened is not valid in stage spec_review'
    });
  });

  it('never leaves a terminal stage', () => {
    expect(transition('done', { type: 'canceled' }, context)).toEqual({
      ok: false,
      error: 'Event canceled is not valid in stage done'
    });
  });
});
