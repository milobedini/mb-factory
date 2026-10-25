import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseFactoryConfig } from './config';
import {
  decideIssueUpdate,
  parseGitHubEvent,
  parseIssueUpdate,
  prClosedText,
  stageAfterPrClosed,
  stageForLinearState,
  stoppedText
} from './work-item-events';

const config = parseFactoryConfig(
  readFileSync(fileURLToPath(new URL('../../../projects/tastebook/factory.yaml', import.meta.url)), 'utf8')
);

const APP_USER = 'app-user';
const HUMAN = 'human-user';

// Trimmed from real deliveries (tastebook PR #4 and its pushes, 2026-10-25).
const pullRequestClosed = (merged: boolean) => ({
  action: 'closed',
  repository: { full_name: 'milobedini/tastebook' },
  pull_request: {
    number: 4,
    merged,
    head: { ref: 'tas-7-page-not-found', repo: { full_name: 'milobedini/tastebook' } },
    user: { login: 'claude[bot]' }
  }
});

const push = (overrides: Record<string, unknown>) => ({
  ref: 'refs/heads/tas-7-page-not-found',
  created: false,
  deleted: false,
  forced: false,
  repository: { full_name: 'milobedini/tastebook' },
  sender: { login: 'milobedini', type: 'User' },
  commits: [{ id: 'a1' }, { id: 'b2' }],
  ...overrides
});

describe('parseGitHubEvent', () => {
  it.each([true, false])('reads a closed pull request with merged=%s', (merged) => {
    expect(parseGitHubEvent('pull_request', pullRequestClosed(merged))).toEqual({
      kind: 'pr_closed',
      repository: 'milobedini/tastebook',
      number: 4,
      branch: 'tas-7-page-not-found',
      merged
    });
  });

  it('ignores a pull request from a fork, even with a factory branch’s name', () => {
    const fromFork = pullRequestClosed(false);
    const pr = {
      ...fromFork.pull_request,
      head: { ref: 'tas-7-page-not-found', repo: { full_name: 'someone/tastebook' } }
    };
    expect(parseGitHubEvent('pull_request', { ...fromFork, pull_request: pr })).toBeUndefined();
  });

  it('ignores pull request actions other than closed', () => {
    expect(parseGitHubEvent('pull_request', { ...pullRequestClosed(false), action: 'opened' })).toBeUndefined();
  });

  it('reads a human push to a branch with its commit count', () => {
    expect(parseGitHubEvent('push', push({}))).toEqual({
      kind: 'human_push',
      repository: 'milobedini/tastebook',
      branch: 'tas-7-page-not-found',
      login: 'milobedini',
      commits: 2
    });
  });

  it('counts a force push that leaves no new commits', () => {
    expect(parseGitHubEvent('push', push({ forced: true, commits: [] }))).toMatchObject({ commits: 0 });
  });

  it.each([
    ['the factory’s own push', { sender: { login: 'claude[bot]', type: 'Bot' } }],
    ['the branch deletion after a merge', { deleted: true, commits: [] }],
    ['an empty push', { commits: [] }],
    ['a tag', { ref: 'refs/tags/v1' }]
  ])('ignores %s', (_label, overrides) => {
    expect(parseGitHubEvent('push', push(overrides))).toBeUndefined();
  });

  it('ignores other events and malformed payloads', () => {
    expect(parseGitHubEvent('check_suite', { action: 'completed' })).toBeUndefined();
    expect(parseGitHubEvent('push', { ref: 'refs/heads/x' })).toBeUndefined();
  });
});

describe('stageAfterPrClosed', () => {
  it('settles an active work item', () => {
    expect(stageAfterPrClosed('awaiting_merge', true)).toBe('done');
    expect(stageAfterPrClosed('building', false)).toBe('canceled');
  });

  it('leaves a settled work item where it is', () => {
    expect(stageAfterPrClosed('done', true)).toBeUndefined();
  });
});

// Trimmed from real deliveries (TAS-5 to TAS-9, 2026-10-24 and 25).
const issueUpdate = (overrides: {
  data?: Record<string, unknown>;
  updatedFrom?: Record<string, unknown>;
  actor?: string;
}) => ({
  type: 'Issue',
  action: 'update',
  organizationId: 'org-1',
  actor: { id: overrides.actor ?? HUMAN, type: 'user' },
  data: {
    id: 'issue-1',
    identifier: 'TAS-9',
    delegateId: APP_USER,
    state: { id: 'state-1', name: 'Awaiting Merge', type: 'started' },
    ...overrides.data
  },
  updatedFrom: { updatedAt: '2026-10-25T08:55:48.485Z', ...overrides.updatedFrom }
});

describe('parseIssueUpdate', () => {
  it('reads a status change', () => {
    expect(parseIssueUpdate(issueUpdate({ updatedFrom: { stateId: 'state-0' } }))).toEqual({
      organizationId: 'org-1',
      issueId: 'issue-1',
      identifier: 'TAS-9',
      actorId: HUMAN,
      state: { name: 'Awaiting Merge', type: 'started' }
    });
  });

  it('reads a removed delegation', () => {
    expect(
      parseIssueUpdate(issueUpdate({ data: { delegateId: null }, updatedFrom: { delegateId: APP_USER } }))
    ).toMatchObject({ delegate: { from: APP_USER, to: null } });
  });

  it('leaves out fields the update didn’t change', () => {
    const parsed = parseIssueUpdate(issueUpdate({ updatedFrom: { labelIds: ['label-1'] } }));
    expect(parsed).not.toHaveProperty('state');
    expect(parsed).not.toHaveProperty('delegate');
  });

  it('ignores other actions and types', () => {
    expect(parseIssueUpdate({ ...issueUpdate({}), action: 'create' })).toBeUndefined();
    expect(parseIssueUpdate({ ...issueUpdate({}), type: 'Comment' })).toBeUndefined();
  });
});

describe('stageForLinearState', () => {
  it.each([
    [{ name: 'Building', type: 'started' }, 'building'],
    [{ name: 'Spec Review', type: 'started' }, 'spec_review'],
    [{ name: 'Done', type: 'completed' }, 'done'],
    [{ name: 'Duplicate', type: 'canceled' }, 'canceled'],
    [{ name: 'Todo', type: 'unstarted' }, undefined]
  ])('maps %o to %s', (state, expected) => {
    expect(stageForLinearState(config, state)).toBe(expected);
  });
});

describe('decideIssueUpdate', () => {
  const decide = (raw: ReturnType<typeof issueUpdate>, stage: Parameters<typeof decideIssueUpdate>[1]['stage']) => {
    const update = parseIssueUpdate(raw);
    if (!update) {
      throw new Error('fixture did not parse');
    }
    return decideIssueUpdate(update, { config, appUserId: APP_USER, stage });
  };

  it('follows a human’s move to a factory status', () => {
    expect(decide(issueUpdate({ updatedFrom: { stateId: 'state-0' } }), 'building')).toEqual({
      stage: 'awaiting_merge'
    });
  });

  it('ignores the factory’s own moves', () => {
    expect(decide(issueUpdate({ actor: APP_USER, updatedFrom: { stateId: 'state-0' } }), 'building')).toEqual({});
  });

  it('does nothing when the stage already matches', () => {
    expect(decide(issueUpdate({ updatedFrom: { stateId: 'state-0' } }), 'awaiting_merge')).toEqual({});
  });

  it('leaves the stage alone for a status outside the factory', () => {
    const toTodo = issueUpdate({ data: { state: { name: 'Todo', type: 'unstarted' } }, updatedFrom: { stateId: 's' } });
    expect(decide(toTodo, 'building')).toEqual({});
  });

  it('settles the work item and stops its runs when the issue is closed', () => {
    const toCanceled = issueUpdate({
      data: { state: { name: 'Canceled', type: 'canceled' } },
      updatedFrom: { stateId: 'state-0' }
    });
    expect(decide(toCanceled, 'building')).toEqual({
      stage: 'canceled',
      stop: { kind: 'issue_closed', status: 'Canceled' }
    });
  });

  it('stops the runs when the delegation is removed, keeping the stage', () => {
    expect(
      decide(issueUpdate({ data: { delegateId: null }, updatedFrom: { delegateId: APP_USER } }), 'building')
    ).toEqual({ stop: { kind: 'undelegated' } });
  });

  it('ignores a delegation to the factory and changes to someone else’s delegation', () => {
    expect(decide(issueUpdate({ updatedFrom: { delegateId: null } }), 'building')).toEqual({});
    expect(
      decide(issueUpdate({ data: { delegateId: null }, updatedFrom: { delegateId: 'other-agent' } }), 'building')
    ).toEqual({});
  });
});

describe('stop copy', () => {
  it('names what happened', () => {
    expect(prClosedText(6, true)).toBe('PR #6 merged.');
    expect(stoppedText({ kind: 'pr_closed', number: 6, merged: false })).toBe(
      'Stopped: PR #6 was closed without merging.'
    );
    expect(stoppedText({ kind: 'issue_closed', status: 'Done' })).toBe('Stopped: the issue was moved to Done.');
  });
});
