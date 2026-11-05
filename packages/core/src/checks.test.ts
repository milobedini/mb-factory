import { describe, expect, it } from 'vitest';

import type { HeadCheck } from './checks';
import {
  checkRunState,
  checksLine,
  checksPassedText,
  checksToWaitFor,
  commitStatusState,
  summariseChecks
} from './checks';

const check = (name: string, state: HeadCheck['state'], finishedAt: string | null = null): HeadCheck => ({
  name,
  state,
  url: `https://github.com/o/r/runs/${name.toLowerCase()}`,
  finishedAt: finishedAt ? new Date(finishedAt) : null
});

const options = { timeZone: 'Europe/London', emojiPrefix: 'tb' };

describe('checkRunState', () => {
  it.each([
    [{ status: 'queued', conclusion: null }, 'running'],
    [{ status: 'in_progress', conclusion: null }, 'running'],
    [{ status: 'completed', conclusion: 'success' }, 'passed'],
    [{ status: 'completed', conclusion: 'skipped' }, 'passed'],
    [{ status: 'completed', conclusion: 'neutral' }, 'passed'],
    [{ status: 'completed', conclusion: 'failure' }, 'failed'],
    [{ status: 'completed', conclusion: 'cancelled' }, 'failed'],
    [{ status: 'completed', conclusion: 'timed_out' }, 'failed']
  ] as const)('reads %o as %s', (run, state) => {
    expect(checkRunState(run)).toBe(state);
  });
});

describe('commitStatusState', () => {
  it.each([
    ['success', 'passed'],
    ['pending', 'running'],
    ['failure', 'failed'],
    ['error', 'failed']
  ] as const)('reads %s as %s', (state, expected) => {
    expect(commitStatusState(state)).toBe(expected);
  });
});

describe('checksToWaitFor', () => {
  it('drops the checks of runs filed on the default branch, keeping the rest and commit statuses', () => {
    const previous = [
      { name: 'Frontend', suiteId: 1 },
      { name: 'Preview checks', suiteId: 2 },
      { name: 'stage / stage', suiteId: 3 },
      { name: 'stage / visual', suiteId: 3 },
      { name: 'Back up production', suiteId: 4 },
      { name: 'Vercel', suiteId: null }
    ];
    expect(checksToWaitFor(previous, [3, 4])).toEqual(['Frontend', 'Preview checks', 'Vercel']);
  });

  it('keeps every check when no run came from a default-branch event', () => {
    expect(checksToWaitFor([{ name: 'Frontend', suiteId: 1 }], [])).toEqual(['Frontend']);
  });
});

describe('summariseChecks', () => {
  it('is none with no checks on the head or before it', () => {
    expect(summariseChecks([], []).state).toBe('none');
  });

  it('waits on a check that ran on the commit before and has not started on the head', () => {
    const summary = summariseChecks(
      [check('Backend', 'passed', '2026-11-03T12:58:00Z'), check('Frontend', 'running')],
      ['Backend', 'Frontend', 'Preview checks', 'Preview checks']
    );
    expect(summary).toMatchObject({
      state: 'pending',
      total: 3,
      passed: 1,
      running: ['Frontend'],
      waiting: ['Preview checks'],
      finishedAt: null
    });
  });

  it('fails on any failed check, whatever else is running', () => {
    const summary = summariseChecks([check('End-to-end', 'failed'), check('Frontend', 'running')], []);
    expect(summary.state).toBe('failing');
    expect(summary.failed).toEqual([{ name: 'End-to-end', url: 'https://github.com/o/r/runs/end-to-end' }]);
  });

  it('passes once every check on the head and before it passed, at the last one to finish', () => {
    const summary = summariseChecks(
      [check('Backend', 'passed', '2026-11-03T12:58:00Z'), check('Preview checks', 'passed', '2026-11-03T13:01:00Z')],
      ['Backend', 'Preview checks']
    );
    expect(summary).toMatchObject({ state: 'passing', total: 2, passed: 2 });
    expect(summary.finishedAt).toEqual(new Date('2026-11-03T13:01:00Z'));
  });

  it('keeps only the newest check of each name', () => {
    const summary = summariseChecks([check('End-to-end', 'passed'), check('End-to-end', 'failed')], []);
    expect(summary).toMatchObject({ state: 'passing', total: 1, passed: 1 });
  });
});

describe('checksLine', () => {
  it('says nothing when the head has no checks', () => {
    expect(checksLine(summariseChecks([], []), options)).toBeUndefined();
  });

  it('names what is running and what has not started', () => {
    const summary = summariseChecks(
      [
        check('API contract', 'passed'),
        check('Backend', 'passed'),
        check('Label', 'passed'),
        check('Vercel', 'passed'),
        check('Frontend', 'running'),
        check('End-to-end', 'running')
      ],
      ['Preview checks']
    );
    expect(checksLine(summary, options)).toBe(
      ':tb-running: *Checks running:* 4 of 7 passed. Frontend and End-to-end are running; Preview checks hasn’t started.'
    );
  });

  it('says when they passed', () => {
    const summary = summariseChecks([check('Backend', 'passed', '2026-11-03T13:01:00Z')], []);
    expect(checksLine(summary, options)).toBe(':tb-done: *Checks passed:* 1 of 1 at 13:01.');
  });

  it.each([
    ['not https', 'javascript:alert(1)'],
    ['closing the link early', 'https://example.com/x|Click here> <https://evil.example'],
    ['holding a space', 'https://example.com/a b']
  ])('names a failing check without its link when the link is %s', (_label, url) => {
    const summary = summariseChecks([{ name: 'Vercel', state: 'failed', url, finishedAt: null }], []);
    expect(checksLine(summary, options)).toBe(':tb-blocked: *Checks failing:* Vercel.');
  });

  it('links each failing check', () => {
    const summary = summariseChecks([check('End-to-end', 'failed'), check('Frontend', 'failed')], []);
    expect(checksLine(summary, options)).toBe(
      ':tb-blocked: *Checks failing:* <https://github.com/o/r/runs/end-to-end|End-to-end> and <https://github.com/o/r/runs/frontend|Frontend>.'
    );
  });
});

describe('checksPassedText', () => {
  it('counts the checks and points at the card', () => {
    const summary = summariseChecks([check('Backend', 'passed'), check('Frontend', 'passed')], []);
    expect(checksPassedText(122, summary)).toBe(
      'Checks passed on PR #122 (2 of 2) after bringing it up to date. Approve and merge is on the card.'
    );
  });
});
