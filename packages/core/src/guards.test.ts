import { describe, expect, it } from 'vitest';

import { guardFingerprint, guardIssue, readGuards } from './guards';

const guard = {
  title: 'Lint rule against  unscoped recipe queries',
  problem: 'A view read recipes without filtering by household.',
  guard: 'A custom ruff rule, or a test over every view, that fails on `Recipe.objects` outside `services.py`.'
};

describe('readGuards', () => {
  it('reads the guards a report lists and drops malformed ones', () => {
    expect(readGuards({ guards: [guard, { title: 'No problem given' }, 'text'] })).toEqual([
      { ...guard, title: 'Lint rule against  unscoped recipe queries' }
    ]);
  });

  it('reads nothing from a report without guards, and keeps five at most', () => {
    expect(readGuards({ outcome: 'done' })).toEqual([]);
    expect(readGuards(null)).toEqual([]);
    expect(readGuards({ guards: Array.from({ length: 8 }, () => guard) })).toHaveLength(5);
  });
});

describe('guardIssue', () => {
  const context = {
    issueIdentifier: 'TAS-30',
    issueUrl: 'https://linear.app/tastebook/issue/TAS-30',
    prUrl: 'https://github.com/milobedini/tastebook/pull/40',
    runUrl: 'https://github.com/milobedini/tastebook/actions/runs/1'
  };

  it('files the guard at low priority, unsized, linking where it came from', () => {
    const issue = guardIssue(guard, context);
    expect(issue.title).toBe('Guard: Lint rule against unscoped recipe queries');
    expect(issue.priority).toBe(4);
    expect(issue.estimate).toBeNull();
    expect(issue.description).toContain('Raised while working on [TAS-30](https://linear.app/tastebook/issue/TAS-30)');
    expect(issue.description).toContain('[its PR](https://github.com/milobedini/tastebook/pull/40)');
    expect(issue.description).toContain('Fingerprint: `guard:tas-30:lint-rule-against-unscoped-recipe-queries`');
  });

  it('escapes the agent’s text so it can’t render links or images', () => {
    const issue = guardIssue({ ...guard, problem: 'See ![x](https://example.com/x.png)' }, context);
    expect(issue.description).toContain('See !\\[x\\](https://example.com/x.png)');
  });

  it('clips a long title and says when the guard came back', () => {
    const issue = guardIssue(
      { ...guard, title: 'x'.repeat(120) },
      {
        ...context,
        previous: { identifier: 'TAS-31', url: 'https://linear.app/tastebook/issue/TAS-31', stateType: 'completed' }
      }
    );
    expect(issue.title).toHaveLength(80);
    expect(issue.description).toContain(
      'It came back after [TAS-31](https://linear.app/tastebook/issue/TAS-31) was done.'
    );
  });
});

describe('guardFingerprint', () => {
  it('keeps only a slug of the title, so backticks can’t break out of the code span', () => {
    expect(guardFingerprint('TAS-30', { ...guard, title: 'Lint `x` ![y](z)' })).toBe('guard:tas-30:lint-x-y-z');
  });

  it('ignores case and spacing in the title', () => {
    expect(guardFingerprint('TAS-30', { ...guard, title: 'LINT rule against unscoped  recipe queries ' })).toBe(
      guardFingerprint('TAS-30', guard)
    );
  });
});
