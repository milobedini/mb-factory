import { describe, expect, it } from 'vitest';

import type { DependencyUpdateStatus } from './dependency-updates';
import {
  dependencyMentions,
  dependencyUpdateCard,
  dependencyUpdateFor,
  onlyDependabotCommits,
  readDependencyUpdate,
  updatesText
} from './dependency-updates';

const message = { channel: 'C0CBSE2Q6FQ', ts: '1794335863.308059' };
const openedAt = new Date('2026-11-09T06:30:00Z');

const pythonGroup = {
  repository: 'Milo-Bedini/tastebook',
  number: 169,
  branch: 'dependabot/uv/backend/python-minor-and-patch-ff3d890429',
  title: 'Bump the python-minor-and-patch group across 1 directory with 3 updates',
  url: 'https://github.com/Milo-Bedini/tastebook/pull/169',
  body: [
    'Bumps the python-minor-and-patch group with 3 updates in the /backend directory.',
    '',
    'Updates `pytest` from 9.1.1 to 9.2.0',
    'Updates `pytest-env` from 1.8.1 to 1.8.4',
    'Updates `ruff` from 0.17.2 to 0.17.3'
  ].join('\n')
};

const options = { timeZone: 'Europe/London', emojiPrefix: 'tb' };

describe('dependencyUpdateFor', () => {
  it('names a group by its ecosystem and count, with the updates it lists', () => {
    const update = dependencyUpdateFor(pythonGroup, message, openedAt);
    expect(update).toMatchObject({
      prNumber: 169,
      title: '3 Python updates',
      total: 3,
      security: false,
      group: 'python-minor-and-patch',
      channel: 'C0CBSE2Q6FQ',
      ts: '1794335863.308059',
      openedAt: '2026-11-09T06:30:00.000Z'
    });
    expect(update.updates).toHaveLength(3);
    expect(readDependencyUpdate(update)).toEqual(update);
  });

  it('counts a big group from its title when the description lists only some', () => {
    const npm = {
      ...pythonGroup,
      number: 206,
      branch: 'dependabot/npm_and_yarn/npm-minor-and-patch-a4f7b60c84',
      title: 'Bump the npm-minor-and-patch group with 13 updates'
    };
    expect(dependencyUpdateFor(npm, message, openedAt)).toMatchObject({ title: '13 npm updates', total: 13 });
  });

  it('calls a security update one, and a single bump one update', () => {
    const security = {
      ...pythonGroup,
      number: 141,
      title: '[Security] Bump oauthlib from 4.0.0 to 4.0.1 in /backend',
      body: null
    };
    expect(dependencyUpdateFor(security, message, openedAt)).toMatchObject({
      title: 'Python security update',
      security: true,
      total: 1,
      updates: [{ name: 'oauthlib', from: '4.0.0', to: '4.0.1' }]
    });
    const single = { ...security, title: 'Bump oauthlib from 4.0.0 to 4.0.1 in /backend' };
    expect(dependencyUpdateFor(single, message, openedAt).title).toBe('1 Python update');
  });
});

describe('dependencyMentions', () => {
  it('mentions everyone in the project’s people with Slack', () => {
    const people = [
      { linear: 'a@x', git: 'A <a@x>', slack: 'U1' },
      { linear: 'b@x', git: 'B <b@x>' }
    ];
    expect(dependencyMentions({ people })).toBe('<@U1>');
    expect(dependencyMentions({ people: [] })).toBeUndefined();
  });
});

describe('updatesText', () => {
  it('lists at most four updates, then how many more', () => {
    const updates = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name, from: '1.0.0', to: '1.1.0' }));
    expect(updatesText({ updates, total: 13 })).toBe(
      'a 1.0.0 → 1.1.0 · b 1.0.0 → 1.1.0 · c 1.0.0 → 1.1.0 · d 1.0.0 → 1.1.0 · and 9 more'
    );
    expect(updatesText({ updates: updates.slice(0, 2), total: 2 })).toBe('a 1.0.0 → 1.1.0 · b 1.0.0 → 1.1.0');
    expect(updatesText({ updates: [], total: 3 })).toBeUndefined();
  });
});

describe('dependencyUpdateCard', () => {
  const update = dependencyUpdateFor(pythonGroup, message, openedAt);
  const card = (status: DependencyUpdateStatus) => dependencyUpdateCard(update, status, options);
  const lineOf = (status: DependencyUpdateStatus) =>
    JSON.stringify(card(status).attachments[0]?.blocks.find((block) => block.type === 'section'));
  const hasOpenPr = (status: DependencyUpdateStatus) =>
    JSON.stringify(card(status).attachments[0]?.blocks).includes('Open PR #169');

  it('heads the card with the PR and what it is, and lists the updates and the group', () => {
    const built = card({ kind: 'checking', checks: null });
    expect(JSON.stringify(built.blocks)).toContain(
      '*<https://github.com/Milo-Bedini/tastebook/pull/169|PR #169> 3 Python updates*'
    );
    const blocks = JSON.stringify(built.attachments[0]?.blocks);
    expect(blocks).toContain('pytest 9.1.1 → 9.2.0 · pytest-env 1.8.1 → 1.8.4 · ruff 0.17.2 → 0.17.3');
    expect(blocks).toContain('Dependabot · python-minor-and-patch');
  });

  it('says the checks are running and that it queues itself once they pass', () => {
    const checks = {
      state: 'pending' as const,
      total: 8,
      passed: 5,
      running: ['End-to-end'],
      waiting: [],
      failed: [],
      finishedAt: null
    };
    expect(lineOf({ kind: 'checking', checks })).toContain('*Checks running:* 5 of 8 passed. End-to-end is running.');
    expect(lineOf({ kind: 'checking', checks })).toContain(
      'It goes into the merge queue by itself once they all pass.'
    );
    expect(hasOpenPr({ kind: 'checking', checks })).toBe(true);
  });

  it('says it is in the merge queue, and its place', () => {
    const queue = { kind: 'queued' as const, at: new Date('2026-11-10T09:04:00Z'), by: null, base: 'main', ahead: [] };
    expect(lineOf({ kind: 'queued', queue })).toContain(
      '*In the merge queue:* added PR #169 by itself at 09:04, with every check passing.\\n1st in line.'
    );
    expect(lineOf({ kind: 'queued', queue: { ...queue, ahead: [220] } })).toContain('2nd in line, behind #220.');
  });

  it('gives the reasons it waits', () => {
    const line = lineOf({ kind: 'waiting', reasons: ['changes a risky path: .github/workflows/ci.yml'] });
    expect(line).toContain('*Waits for you:* changes a risky path: .github/workflows/ci.yml.');
    expect(card({ kind: 'waiting', reasons: ['x'] }).attachments[0]?.color).toBe('#ecb22e');
  });

  it('points at the issue filed when its checks fail, and stops offering the PR', () => {
    const status = { kind: 'handed' as const, issue: { identifier: 'TAS-231', url: 'https://linear.app/t/TAS-231' } };
    expect(lineOf(status)).toContain('I filed <https://linear.app/t/TAS-231|TAS-231> to fix it, keeping the updates.');
    expect(hasOpenPr(status)).toBe(false);
  });

  it('says it merged itself, watching until the watch ends, then the commit', () => {
    const at = new Date('2026-11-10T09:12:00Z');
    const sha = '4f2a9c1e0d2b3a4c5d6e7f8091a2b3c4d5e6f708';
    expect(lineOf({ kind: 'merged', at, sha, watchingUntil: new Date('2026-11-10T09:42:00Z') })).toContain(
      '*Merged by itself* at 09:12 · watching production until 09:42.'
    );
    expect(lineOf({ kind: 'merged', at, sha, watchingUntil: null })).toContain(
      '*Merged by itself* at 09:12 · 4f2a9c1 on main.'
    );
    expect(hasOpenPr({ kind: 'merged', at, sha, watchingUntil: null })).toBe(false);
  });

  it('says it closed without merging', () => {
    expect(lineOf({ kind: 'closed', at: new Date('2026-11-10T09:12:00Z') })).toContain(
      '*Closed* at 09:12 without merging.'
    );
  });
});

describe('onlyDependabotCommits', () => {
  const dependabot = { author: 'dependabot[bot]', committer: 'web-flow', verified: true };

  it('trusts commits Dependabot authored and GitHub committed and signed', () => {
    expect(onlyDependabotCommits([dependabot, dependabot])).toBe(true);
  });

  it('refuses a person’s commit, an unsigned one, one faking Dependabot as author, or none', () => {
    expect(onlyDependabotCommits([dependabot, { author: 'milobedini', committer: 'milobedini', verified: true }])).toBe(
      false
    );
    expect(onlyDependabotCommits([{ ...dependabot, verified: false }])).toBe(false);
    expect(onlyDependabotCommits([{ ...dependabot, committer: 'milobedini' }])).toBe(false);
    expect(onlyDependabotCommits([])).toBe(false);
  });
});
