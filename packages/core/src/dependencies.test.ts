import { describe, expect, it } from 'vitest';

import { dependencyIssue, dependencyTakenText, isMajorBump, readBump } from './dependencies';

const pr = {
  repository: 'milobedini/tastebook',
  number: 16,
  branch: 'dependabot/npm_and_yarn/vite-8.0.0',
  title: 'Bump vite from 7.1.0 to 8.0.0',
  url: 'https://github.com/milobedini/tastebook/pull/16'
};

describe('readBump', () => {
  it('reads a single-package PR title, with or without a directory or the security tag', () => {
    expect(readBump('Bump vite from 7.1.0 to 8.0.0')).toEqual({ name: 'vite', from: '7.1.0', to: '8.0.0' });
    expect(readBump('Bump django from 6.1.0 to 7.0.0 in /backend')).toEqual({
      name: 'django',
      from: '6.1.0',
      to: '7.0.0'
    });
    expect(readBump('[Security] Bump @types/node from v24.1.0 to v25.0.0')).toEqual({
      name: '@types/node',
      from: '24.1.0',
      to: '25.0.0'
    });
  });

  it('names no package for a grouped PR', () => {
    expect(readBump('Bump the npm-minor-and-patch group across 1 directory with 5 updates')).toBeUndefined();
    expect(readBump('Update the README')).toBeUndefined();
  });
});

describe('isMajorBump', () => {
  it('counts a new major, and a new minor under 1.0', () => {
    expect(isMajorBump({ name: 'vite', from: '7.1.0', to: '8.0.0' })).toBe(true);
    expect(isMajorBump({ name: 'x', from: '0.3.2', to: '0.4.0' })).toBe(true);
  });

  it('leaves minors, patches and versions it cannot read alone', () => {
    expect(isMajorBump({ name: 'vite', from: '7.1.0', to: '7.2.0' })).toBe(false);
    expect(isMajorBump({ name: 'x', from: '0.3.2', to: '0.3.3' })).toBe(false);
    expect(isMajorBump({ name: 'x', from: 'abc', to: 'def' })).toBe(false);
  });
});

describe('dependencyIssue', () => {
  it('asks for the upgrade work on a major', () => {
    const issue = dependencyIssue(pr, { kind: 'major', bump: { name: 'vite', from: '7.1.0', to: '8.0.0' } });
    expect(issue.title).toBe('Upgrade vite to 8.0.0');
    expect(issue.description).toContain('Dependabot opened [#16](https://github.com/milobedini/tastebook/pull/16)');
    expect(issue.description).toContain('migration guide');
    expect(issue.description).toContain('`dependabot/npm_and_yarn/vite-8.0.0`');
  });

  it('asks for a fix that keeps the update when CI fails', () => {
    const issue = dependencyIssue(pr, { kind: 'ci_failed', workflow: 'CI', runUrl: 'https://github.com/r/1' });
    expect(issue.title).toBe('Fix the failing dependency update: Bump vite from 7.1.0 to 8.0.0');
    expect(issue.description).toContain("CI's CI workflow failed ([run](https://github.com/r/1))");
    expect(issue.description).toContain('keeping the update');
  });
});

describe('dependencyTakenText', () => {
  it('says why the factory took the PR on', () => {
    const issue = { identifier: 'TAS-20', url: 'https://linear.app/x/TAS-20' };
    expect(dependencyTakenText(pr, { kind: 'major', bump: { name: 'vite', from: '7.1.0', to: '8.0.0' } }, issue)).toBe(
      'Dependabot’s <https://github.com/milobedini/tastebook/pull/16|PR #16> is a major upgrade of vite (7.1.0 → 8.0.0), so I filed <https://linear.app/x/TAS-20|TAS-20> and started on it.'
    );
    expect(dependencyTakenText(pr, { kind: 'ci_failed', workflow: 'CI', runUrl: null }, issue)).toContain(
      'failed CI (CI)'
    );
  });
});
