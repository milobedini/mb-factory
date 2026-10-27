import { describe, expect, it } from 'vitest';

import type { CandidateIssue } from './ready';
import { readyList, unblockedBy } from './ready';

const platform = {
  name: 'Platform',
  url: 'https://linear.app/tastebook/project/platform',
  sortOrder: -5811,
  statusType: 'backlog'
};
const recipes = { name: 'Real recipes', url: null, sortOrder: -5353, statusType: 'started' };

const issue = (identifier: string, overrides: Partial<CandidateIssue> = {}): CandidateIssue => ({
  id: `id-${identifier}`,
  identifier,
  title: `Issue ${identifier}`,
  url: `https://linear.app/tastebook/issue/${identifier}`,
  priority: 0,
  estimate: null,
  assignee: null,
  delegated: false,
  project: platform,
  milestone: null,
  blockers: [],
  ...overrides
});

const identifiers = (issues: { identifier: string }[]): string[] => issues.map(({ identifier }) => identifier);

describe('readyList', () => {
  it('offers unblocked, unassigned issues, and keeps blocked ones back until their blockers finish', () => {
    const list = readyList([
      issue('TAS-23'),
      issue('TAS-29', {
        blockers: [
          { identifier: 'TAS-23', finished: false },
          { identifier: 'TAS-28', finished: true }
        ]
      }),
      issue('TAS-30', { blockers: [{ identifier: 'TAS-28', finished: true }] })
    ]);
    expect(identifiers(list.ready)).toEqual(['TAS-23', 'TAS-30']);
    expect(list.yours).toEqual([]);
  });

  it('lists issues assigned to a person as theirs, never as ready, with what they wait on', () => {
    const list = readyList([
      issue('TAS-24', { assignee: 'Milo Bedini' }),
      issue('TAS-25', { assignee: 'Milo Bedini', blockers: [{ identifier: 'TAS-24', finished: false }] })
    ]);
    expect(list.ready).toEqual([]);
    expect(list.yours.map(({ identifier, waitingOn }) => [identifier, waitingOn])).toEqual([
      ['TAS-24', []],
      ['TAS-25', ['TAS-24']]
    ]);
  });

  it('says where each issue sits: its project, linked when Linear gives the address, and its milestone', () => {
    const [first, second] = readyList([
      issue('TAS-27'),
      issue('TAS-40', { project: recipes, milestone: 'Structured recipes' })
    ]).ready;
    expect(first).toMatchObject({ project: 'Platform', projectUrl: platform.url, milestone: null });
    expect(second).toMatchObject({ project: 'Real recipes', projectUrl: null, milestone: 'Structured recipes' });
  });

  it('leaves out delegated issues and those in finished projects', () => {
    const list = readyList([
      issue('TAS-23', { delegated: true }),
      issue('TAS-40', { project: { ...recipes, statusType: 'completed' } }),
      issue('TAS-41', { project: { ...recipes, statusType: 'canceled' } })
    ]);
    expect(list).toEqual({ ready: [], yours: [] });
  });

  it('orders by the team’s project order, then priority with none last, then oldest first', () => {
    const list = readyList([
      issue('TAS-50', { project: recipes, priority: 1 }),
      issue('TAS-27'),
      issue('TAS-26', { priority: 4 }),
      issue('TAS-25', { priority: 2 }),
      issue('TAS-9')
    ]);
    expect(identifiers(list.ready)).toEqual(['TAS-25', 'TAS-26', 'TAS-9', 'TAS-27', 'TAS-50']);
  });

  it('shows the size, unsized until triage sets one', () => {
    const [sized, unsized] = readyList([issue('TAS-23', { estimate: 2 }), issue('TAS-26')]).ready;
    expect([sized?.size, unsized?.size]).toEqual(['S', 'unsized']);
  });
});

describe('unblockedBy', () => {
  it('names the ready issues a finished issue was blocking, not those still waiting on another', () => {
    const list = readyList([
      issue('TAS-25', { blockers: [{ identifier: 'TAS-24', finished: true }] }),
      issue('TAS-26', {
        blockers: [
          { identifier: 'TAS-24', finished: true },
          { identifier: 'TAS-28', finished: true }
        ]
      }),
      issue('TAS-29', {
        blockers: [
          { identifier: 'TAS-24', finished: true },
          { identifier: 'TAS-23', finished: false }
        ]
      }),
      issue('TAS-30'),
      issue('TAS-31', { blockers: [{ identifier: 'TAS-24', finished: true }], assignee: 'Milo Bedini' })
    ]);
    expect(identifiers(unblockedBy(list, 'TAS-24'))).toEqual(['TAS-25', 'TAS-26']);
    expect(unblockedBy(list, 'TAS-99')).toEqual([]);
  });
});
