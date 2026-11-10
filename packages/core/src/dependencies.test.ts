import { describe, expect, it } from 'vitest';

import {
  dependencyIssue,
  dependencyMajors,
  dependencyTakenText,
  isMajorBump,
  readBump,
  readGroupedBumps
} from './dependencies';

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

// As Dependabot wrote #204's description, with a major added to the second directory.
const groupedBody = [
  'Bumps the actions group with 2 updates in the / directory: [astral-sh/setup-uv](https://github.com/astral-sh/setup-uv) and [pnpm/action-setup](https://github.com/pnpm/action-setup).',
  'Bumps the actions group with 2 updates in the /.github/actions/factory-setup directory.',
  '',
  'Updates `astral-sh/setup-uv` from 10.3.2 to 10.3.3',
  '- [Release notes](https://github.com/astral-sh/setup-uv/releases)',
  '',
  'Updates `pnpm/action-setup` from 6.1.0 to 6.1.1',
  '',
  'Updates `pnpm/action-setup` from 6.1.0 to 7.0.0',
  '',
  'Updates `astral-sh/setup-uv` from 10.3.2 to 10.3.3'
].join('\n');

describe('readGroupedBumps', () => {
  it('reads each update a grouped PR lists, once per version change', () => {
    expect(readGroupedBumps(groupedBody)).toEqual([
      { name: 'astral-sh/setup-uv', from: '10.3.2', to: '10.3.3' },
      { name: 'pnpm/action-setup', from: '6.1.0', to: '6.1.1' },
      { name: 'pnpm/action-setup', from: '6.1.0', to: '7.0.0' }
    ]);
  });

  it('reads a description with Windows line endings', () => {
    expect(readGroupedBumps(groupedBody.replaceAll('\n', '\r\n'))).toHaveLength(3);
  });

  it('reads nothing from a description without update lines', () => {
    expect(readGroupedBumps('Bumps vite from 7.1.0 to 8.0.0.')).toEqual([]);
    expect(readGroupedBumps('')).toEqual([]);
  });
});

describe('dependencyMajors', () => {
  it('finds a major in the title, or among a grouped PR’s updates', () => {
    expect(dependencyMajors({ title: 'Bump vite from 7.1.0 to 8.0.0', body: null })).toEqual([
      { name: 'vite', from: '7.1.0', to: '8.0.0' }
    ]);
    expect(
      dependencyMajors({ title: 'Bump the actions group across 2 directories with 2 updates', body: groupedBody })
    ).toEqual([{ name: 'pnpm/action-setup', from: '6.1.0', to: '7.0.0' }]);
  });

  it('finds none in a group of minors and patches, or a single minor', () => {
    const minorsOnly = groupedBody.replace('to 7.0.0', 'to 6.1.1');
    expect(dependencyMajors({ title: 'Bump the actions group with 2 updates', body: minorsOnly })).toEqual([]);
    expect(dependencyMajors({ title: 'Bump vite from 7.1.0 to 7.2.0', body: groupedBody })).toEqual([]);
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
    const issue = dependencyIssue(pr, { kind: 'major', bumps: [{ name: 'vite', from: '7.1.0', to: '8.0.0' }] });
    expect(issue.title).toBe('Upgrade vite to 8.0.0');
    expect(issue.description).toContain('Dependabot opened [#16](https://github.com/milobedini/tastebook/pull/16)');
    expect(issue.description).toContain('migration guide');
    expect(issue.description).toContain('`dependabot/npm_and_yarn/vite-8.0.0`');
  });

  it('lists every major a grouped PR carries', () => {
    const issue = dependencyIssue(pr, {
      kind: 'major',
      bumps: [
        { name: 'vite', from: '7.1.0', to: '8.0.0' },
        { name: 'vitest', from: '4.0.0', to: '5.0.0' }
      ]
    });
    expect(issue.title).toBe('Upgrade vite to 8.0.0 and 1 more');
    expect(issue.description).toContain('these major versions among its updates: `vite` from 7.1.0 to 8.0.0, `vitest`');
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
    expect(
      dependencyTakenText(pr, { kind: 'major', bumps: [{ name: 'vite', from: '7.1.0', to: '8.0.0' }] }, issue)
    ).toBe(
      'Dependabot’s <https://github.com/milobedini/tastebook/pull/16|PR #16> is a major upgrade of vite (7.1.0 → 8.0.0), so I filed <https://linear.app/x/TAS-20|TAS-20> and started on it.'
    );
    const two = [
      { name: 'vite', from: '7.1.0', to: '8.0.0' },
      { name: 'vitest', from: '4.0.0', to: '5.0.0' }
    ] as const;
    expect(dependencyTakenText(pr, { kind: 'major', bumps: [...two] }, issue)).toContain(
      'includes major upgrades of vite (7.1.0 → 8.0.0), vitest (4.0.0 → 5.0.0)'
    );
    expect(dependencyTakenText(pr, { kind: 'ci_failed', workflow: 'CI', runUrl: null }, issue)).toContain(
      'failed CI (CI)'
    );
  });
});
