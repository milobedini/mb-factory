import { describe, expect, it } from 'vitest';

import type { SentryIssue } from './health';
import type { WatchFindings } from './watch';
import {
  deployStateOf,
  mergeWatch,
  readMergeWatch,
  revertQueuedText,
  slackDeployFailedMessage,
  slackRevertSettled,
  slackWatchEndMessage
} from './watch';

const workItemId = '8c0b7a62-5d55-4c1e-9d1a-2f4f7d3e9b10';
const pr = { workItemId, prNumber: 128, time: '09:45' };
const sha = 'b'.repeat(40);

const issue = (shortId: string): SentryIssue => ({
  project: 'web',
  shortId,
  title: 'TypeError: Cannot read properties of undefined',
  count: 3,
  firstSeen: new Date('2026-11-04T09:20:00Z'),
  url: `https://sentry.io/issues/${shortId}`
});

const found = (overrides: Partial<WatchFindings> = {}): WatchFindings => ({
  deploy: 'success',
  deployUrl: null,
  deployedAt: '09:18',
  deployFailureSaid: false,
  issues: [],
  ...overrides
});

const actionIds = (blocks: { type?: unknown; elements?: unknown }[]): unknown[] =>
  blocks.flatMap((block) =>
    block.type === 'actions' ? (block.elements as { action_id?: unknown }[]).map(({ action_id }) => action_id) : []
  );

describe('mergeWatch', () => {
  it('ends 30 minutes after the merge, and reads back as recorded', () => {
    const watch = mergeWatch(
      { workItemId, repository: 'o/r', prNumber: 128, sha },
      new Date('2026-11-04T09:15:00.000Z')
    );
    expect(watch.endsAt).toBe('2026-11-04T09:45:00.000Z');
    expect(readMergeWatch(JSON.parse(JSON.stringify(watch)))).toEqual(watch);
    expect(readMergeWatch({ ...watch, sha: 'short' })).toBeUndefined();
  });
});

describe('deployStateOf', () => {
  it('reads GitHub’s deployment states', () => {
    expect(['success', 'inactive', 'failure', 'error', 'in_progress', 'queued'].map(deployStateOf)).toEqual([
      'success',
      'success',
      'failed',
      'failed',
      'deploying',
      'deploying'
    ]);
  });
});

describe('slackDeployFailedMessage', () => {
  it('offers Revert, confirmed first, and the deploy', () => {
    const message = slackDeployFailedMessage({ workItemId, prNumber: 128 }, 'https://vercel.com/logs');
    expect(message.text).toContain('The production deploy failed* for PR #128');
    expect(actionIds(message.blocks)).toEqual(['revert', 'deploy_open']);
    expect((message.blocks[1]?.elements as unknown[] | undefined)?.[0]).toMatchObject({
      style: 'danger',
      value: JSON.stringify({ v: workItemId }),
      confirm: { style: 'danger' }
    });
  });
});

describe('slackWatchEndMessage', () => {
  it('says all clear in one line, with no buttons', () => {
    const message = slackWatchEndMessage(pr, found());
    expect(message.text).toBe(
      '✓ Watched PR #128 for 30 minutes after it merged itself: deployed to production at 09:18, and no new Sentry issues.'
    );
    expect(actionIds(message.blocks)).toEqual([]);
  });

  it('lists new Sentry issues with Revert, five at most', () => {
    const issues = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => issue(`WEB-${id}`));
    const message = slackWatchEndMessage(pr, found({ issues }));
    expect(message.text).toContain('6 new Sentry issues since it merged, which may not come from it:');
    expect(message.text).toContain('• <https://sentry.io/issues/WEB-A|WEB-A> TypeError');
    expect(message.text).toContain('…and 1 more.');
    expect(message.text).not.toContain('WEB-F');
    expect(actionIds(message.blocks)).toEqual(['revert']);
  });

  it('says when Sentry couldn’t be read, rather than all clear', () => {
    const message = slackWatchEndMessage(pr, found({ issues: null }));
    expect(message.text).toContain('I couldn’t read Sentry, so new issues weren’t checked.');
    expect(message.text).not.toContain('no new Sentry issues');
    expect(actionIds(message.blocks)).toEqual([]);
  });

  it('says a failed deploy once, and a missing deploy without Revert', () => {
    expect(slackWatchEndMessage(pr, found({ deploy: 'failed', deployUrl: 'https://d' })).text).toContain(
      'The production deploy failed (<https://d|deploy>).'
    );
    expect(slackWatchEndMessage(pr, found({ deploy: 'failed', deployFailureSaid: true })).text).toContain(
      'its deploy failed (above), and no new Sentry issues'
    );
    const missing = slackWatchEndMessage(pr, found({ deploy: 'none' }));
    expect(missing.text).toContain('No production deploy of the merge has appeared');
    expect(actionIds(missing.blocks)).toEqual([]);
  });
});

describe('a routine update’s watch', () => {
  const routine = { ...pr, workItemId: null };

  it('records a watch with no work item', () => {
    const watch = mergeWatch(
      { workItemId: null, repository: 'o/r', prNumber: 169, sha },
      new Date('2026-11-10T09:12:00Z')
    );
    expect(readMergeWatch(watch)).toEqual(watch);
  });

  it('offers no Revert button yet, and says to revert on GitHub', () => {
    const ended = slackWatchEndMessage(routine, found({ issues: [issue('WEB-1')] }));
    expect(actionIds(ended.blocks)).toEqual([]);
    expect(ended.text).toContain('revert it from the PR on GitHub');
    const failed = slackDeployFailedMessage({ workItemId: null, prNumber: 169 }, 'https://vercel.com/d/1');
    expect(actionIds(failed.blocks)).toEqual(['deploy_open']);
    expect(failed.text).toContain('revert it from the PR on GitHub');
  });
});

describe('slackRevertSettled', () => {
  it('takes the buttons off and says who asked', () => {
    const { blocks } = slackDeployFailedMessage({ workItemId, prNumber: 128 }, null);
    expect(slackRevertSettled(blocks, 'Milo asked for a revert at 09:30.')).toEqual([
      blocks[0],
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'Milo asked for a revert at 09:30.' }] }
    ]);
  });
});

describe('revertQueuedText', () => {
  it('says the revert went to the front of the merge queue', () => {
    const revert = {
      workItemId: '00000000-0000-4000-8000-000000000001',
      repository: 'Milo-Bedini/tastebook',
      of: 201,
      prNumber: 210,
      url: 'https://github.com/Milo-Bedini/tastebook/pull/210',
      head: 'a'.repeat(40)
    };
    expect(revertQueuedText(revert)).toBe(
      'Added the revert, <https://github.com/Milo-Bedini/tastebook/pull/210|PR #210>, to the front of the merge queue: it merges once its checks pass on top of main.'
    );
  });
});
