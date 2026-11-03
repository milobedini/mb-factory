import { describe, expect, it } from 'vitest';

import { readWorkarounds, workaroundFingerprint, workaroundIssue, workaroundsText } from './workarounds';

const bundle = {
  title: 'dino:bundle’s react-router stub has no NavLink',
  patch: 'Added a NavLink export to frontend/dino-bundle/stubs/react-router.ts before running pnpm dino:bundle.'
};

const context = {
  issueIdentifier: 'TAS-114',
  issueUrl: 'https://linear.app/tastebook/issue/TAS-114',
  prUrl: 'https://github.com/milobedini/tastebook/pull/118',
  runUrl: null
};

describe('readWorkarounds', () => {
  it('reads the workarounds a report lists, drops malformed ones and keeps three at most', () => {
    const report = { workarounds: [bundle, { title: 'No patch' }, bundle, bundle, bundle] };
    expect(readWorkarounds(report)).toHaveLength(3);
    expect(readWorkarounds({ workarounds: [{ title: 'No patch' }] })).toEqual([]);
    expect(readWorkarounds({ summary: 'none' })).toEqual([]);
  });
});

describe('workaroundFingerprint', () => {
  it('is the same for the same breakage whichever issue met it', () => {
    expect(workaroundFingerprint(bundle)).toBe(workaroundFingerprint({ ...bundle, patch: 'Something else' }));
    expect(workaroundFingerprint(bundle)).toBe('workaround:dino-bundle-s-react-router-stub-has-no-navlink');
  });
});

describe('workaroundIssue', () => {
  it('files the fix with what was patched and where it came from', () => {
    const issue = workaroundIssue(bundle, context);
    expect(issue.title).toBe('Fix: dino:bundle’s react-router stub has no NavLink');
    expect(issue.description).toContain('## The workaround');
    expect(issue.description).toContain(
      'Worked around while working on [TAS-114](https://linear.app/tastebook/issue/TAS-114) in [its PR](https://github.com/milobedini/tastebook/pull/118), and left unfixed as out of its scope.'
    );
    expect(issue.description).toContain('Fingerprint: `workaround:dino-bundle-s-react-router-stub-has-no-navlink`');
  });

  it('clips a long title and says when it came back', () => {
    const issue = workaroundIssue(
      { ...bundle, title: 'x'.repeat(120) },
      { ...context, previous: { identifier: 'TAS-119', url: 'https://linear.app/t/TAS-119', stateType: 'completed' } }
    );
    expect(issue.title).toHaveLength(80);
    expect(issue.description).toContain('It came back after [TAS-119](https://linear.app/t/TAS-119) was done.');
  });
});

describe('workaroundsText', () => {
  it('links each fix in Slack or Markdown', () => {
    const issues = [{ identifier: 'TAS-150', url: 'https://linear.app/t/TAS-150', title: 'Fix: the stub' }];
    expect(workaroundsText(issues)).toBe(
      'This run patched the project locally to get its work done; the fix is tracked in <https://linear.app/t/TAS-150|TAS-150> Fix: the stub.'
    );
    expect(workaroundsText(issues, 'markdown')).toContain('[TAS-150](https://linear.app/t/TAS-150)');
  });
});
