import { describe, expect, it } from 'vitest';

import type { PullForMerge } from './merge';
import {
  closedLine,
  connectGitHubMessage,
  mergeButton,
  mergedLine,
  mergeRefusal,
  mergeRefusedText,
  movedOnLine,
  readBeforeMerging,
  slackAcceptedMessage,
  slackMergeSettled,
  withConnectInstead
} from './merge';
import type { SlackBlock } from './slack';
import { parseSlackAction, slackFindingsMessage } from './slack';

const workItemId = '22222222-2222-4222-8222-222222222222';
const accepted = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

const pull = (overrides: Partial<PullForMerge> = {}): PullForMerge => ({
  state: 'open',
  merged: false,
  draft: false,
  head: accepted,
  mergeable: true,
  ...overrides
});

const elements = (blocks: SlackBlock[]): SlackBlock[] =>
  blocks.flatMap((block) => (block.type === 'actions' ? (block.elements as SlackBlock[]) : []));

describe('readBeforeMerging', () => {
  it('reads review’s note as one line, and nothing when it’s missing or blank', () => {
    expect(readBeforeMerging({ verdict: 'accepted', beforeMerging: '  Check the seed\n recipes. ' })).toBe(
      'Check the seed recipes.'
    );
    expect(readBeforeMerging({ verdict: 'accepted' })).toBeUndefined();
    expect(readBeforeMerging({ beforeMerging: '   ' })).toBeUndefined();
    expect(readBeforeMerging(null)).toBeUndefined();
    expect(readBeforeMerging({ beforeMerging: 'x'.repeat(600) })?.length).toBe(500);
  });
});

describe('slackAcceptedMessage', () => {
  const finished = 'The review run finished. Round 3: accepted with no findings.';
  const pr = {
    workItemId,
    prNumber: 39,
    prUrl: 'https://github.com/o/r/pull/39',
    mergeEffect: 'deploys it to production'
  };

  it('adds what to check before merging, then Approve and merge with its confirm and Open PR', () => {
    const message = slackAcceptedMessage(finished, { ...pr, beforeMerging: 'Seed recipes are <placeholders>.' });
    expect(message.text).toBe(`${finished}\n*Before merging:* Seed recipes are &lt;placeholders&gt;.`);
    expect(message.blocks[1]).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Before merging:* Seed recipes are &lt;placeholders&gt;.' }
    });
    const [merge, open] = elements(message.blocks);
    expect(merge).toMatchObject({
      action_id: 'merge',
      style: 'primary',
      value: JSON.stringify({ m: workItemId }),
      confirm: { title: { text: 'Merge PR #39?' }, deny: { text: 'Not yet' } }
    });
    expect(open).toMatchObject({ text: { text: 'Open PR #39' }, url: pr.prUrl });
  });

  it('leaves the note out when review gave none, and keeps the confirm within Slack’s 300 characters', () => {
    expect(slackAcceptedMessage(finished, { ...pr, beforeMerging: undefined }).blocks).toHaveLength(2);
    const long = slackAcceptedMessage(finished, { ...pr, beforeMerging: 'Check this. '.repeat(40) });
    const [merge] = elements(long.blocks);
    const text = (merge?.confirm as { text: { text: string } } | undefined)?.text.text ?? '';
    expect(text.length).toBeLessThanOrEqual(300);
    expect(text).toMatch(/\n\nBefore merging: Check this\. .*…$/);
  });

  it('says what merging sets off only when the project says', () => {
    const confirmText = (mergeEffect: string | undefined): string => {
      const [merge] = elements(slackAcceptedMessage(finished, { ...pr, beforeMerging: undefined, mergeEffect }).blocks);
      return (merge?.confirm as { text: { text: string } } | undefined)?.text.text ?? '';
    };
    expect(confirmText('deploys it to production')).toBe(
      'You’ll approve PR #39 on GitHub as yourself and merge it, which deploys it to production.'
    );
    expect(confirmText(undefined)).toBe('You’ll approve PR #39 on GitHub as yourself and merge it.');
  });

  it('is what the merge button sends back', () => {
    const [merge] = elements(slackAcceptedMessage(finished, { ...pr, beforeMerging: undefined }).blocks);
    const payload = {
      type: 'block_actions',
      user: { id: 'U0CBS3FN806' },
      channel: { id: 'C0CBSE2Q6FQ' },
      response_url: 'https://hooks.slack.com/actions/T/1/x',
      actions: [{ value: merge?.value, action_ts: '1793117999.1' }]
    };
    expect(parseSlackAction(payload)).toMatchObject({ kind: 'merge', workItemId, userId: 'U0CBS3FN806' });
  });
});

describe('slackMergeSettled', () => {
  it('takes the buttons away and says what happened', () => {
    const { blocks } = slackAcceptedMessage('Accepted.', {
      workItemId,
      prNumber: 39,
      prUrl: 'https://github.com/o/r/pull/39',
      beforeMerging: 'Check it.',
      mergeEffect: undefined
    });
    const line = mergedLine({ by: 'Milo Bedini', time: '16:52', repository: 'o/r', sha: accepted });
    expect(line).toBe(
      '✓ Merged by Milo Bedini at 16:52 · <https://github.com/o/r/commit/a1b2c3d4e5f60718293a4b5c6d7e8f9012345678|a1b2c3d>'
    );
    const settled = slackMergeSettled(blocks, line);
    expect(settled.map(({ type }) => type)).toEqual(['section', 'section', 'section']);
    expect(settled[2]).toEqual({ type: 'section', text: { type: 'mrkdwn', text: line } });
    expect(slackMergeSettled(blocks, closedLine(39))[2]).toMatchObject({
      text: { text: 'PR #39 was closed without merging.' }
    });
  });

  it('says less when it doesn’t know who merged or the commit', () => {
    expect(mergedLine({ by: null, time: '16:52', repository: 'o/r', sha: null })).toBe('✓ Merged at 16:52');
  });

  // TAS-40, 27 Oct: rounds 1, 3 and 4 each left Approve and merge in the thread.
  it('says why when the PR moved on to another run', () => {
    expect(movedOnLine('implement')).toBe(
      'Moved on: the PR went back to implement, so this review no longer covers it. The next accepted review brings Approve and merge.'
    );
  });
});

describe('mergeRefusal', () => {
  const check = { pull: pull(), acceptedHead: accepted, checks: 'passing' as const };

  it('lets the commit review accepted merge when its checks are green and GitHub says it merges', () => {
    expect(mergeRefusal(39, check)).toBeUndefined();
    expect(mergeRefusal(39, { ...check, checks: 'none' })).toBeUndefined();
  });

  it('refuses a PR that isn’t open, or is a draft', () => {
    expect(mergeRefusal(39, { ...check, pull: pull({ state: 'closed', merged: true }) })).toBe(
      'PR #39 is already merged, so there’s nothing to do.'
    );
    expect(mergeRefusal(39, { ...check, pull: pull({ state: 'closed' }) })).toBe(
      'PR #39 is closed, so nothing was merged.'
    );
    expect(mergeRefusal(39, { ...check, pull: pull({ draft: true }) })).toBe(
      'PR #39 is a draft, so nothing was merged.'
    );
  });

  it('refuses commits review hasn’t seen, or when it can’t tell what review saw', () => {
    expect(mergeRefusal(39, { ...check, pull: pull({ head: 'e4f5a6b7c8d9' }) })).toBe(
      'PR #39 has commits review hasn’t seen (it accepted a1b2c3d; the head is now e4f5a6b), so nothing was merged. Look at it on GitHub, or ask for another review here.'
    );
    expect(mergeRefusal(39, { ...check, acceptedHead: null })).toMatch(/^I can’t tell which commit review accepted/);
  });

  it('refuses until the checks are green and GitHub knows it merges', () => {
    expect(mergeRefusal(39, { ...check, checks: 'failing' })).toBe('A check failed on PR #39, so nothing was merged.');
    expect(mergeRefusal(39, { ...check, checks: 'pending' })).toMatch(/still running/);
    expect(mergeRefusal(39, { ...check, pull: pull({ mergeable: false }) })).toMatch(/conflicts with its base branch/);
    expect(mergeRefusal(39, { ...check, pull: pull({ mergeable: null }) })).toMatch(/Tap again in a minute\.$/);
  });

  it('checks the PR’s state before its head, and its head before its checks', () => {
    expect(
      mergeRefusal(39, { pull: pull({ draft: true, head: 'other' }), acceptedHead: accepted, checks: 'failing' })
    ).toMatch(/is a draft/);
    expect(mergeRefusal(39, { pull: pull({ head: 'other' }), acceptedHead: accepted, checks: 'failing' })).toMatch(
      /commits review hasn’t seen/
    );
  });

  it('quotes GitHub’s refusal safely', () => {
    expect(mergeRefusedText(39, 'Base <branch> was\nmodified')).toBe(
      'I approved PR #39 as you, but GitHub refused the merge: “Base &lt;branch&gt; was modified”. Tap again, or merge it on GitHub.'
    );
  });
});

describe('connecting GitHub', () => {
  const url = 'https://console.example/api/github/connect/start';

  it('asks to connect once, or again when the connection ran out', () => {
    const first = connectGitHubMessage(url, false);
    expect(first.text).toMatch(/^Connect your GitHub account once/);
    expect(elements(first.blocks)).toEqual([
      {
        type: 'button',
        action_id: 'github_connect',
        text: { type: 'plain_text', text: 'Connect GitHub' },
        url,
        style: 'primary'
      }
    ]);
    expect(connectGitHubMessage(url, true).text).toMatch(/^Your GitHub connection has run out/);
  });

  it('puts Connect GitHub where Approve and merge would be on a Home tab', () => {
    const merge = { type: 'button', action_id: 'merge', text: { type: 'plain_text', text: 'Approve and merge' } };
    const approve = { type: 'button', action_id: 'spec_approve' };
    const blocks: SlackBlock[] = [
      { type: 'section', text: { type: 'mrkdwn', text: 'TAS-39' }, accessory: merge },
      { type: 'section', text: { type: 'mrkdwn', text: 'TAS-38' }, accessory: approve }
    ];
    const swapped = withConnectInstead(blocks, url);
    expect(swapped[0]?.accessory).toMatchObject({ action_id: 'github_connect', url });
    expect(swapped[0]?.accessory).not.toHaveProperty('style');
    expect(swapped[1]).toBe(blocks[1]);
  });
});

// TAS-45, 27 Oct: Approve and merge above the findings and Merge as it is (which only left them) below were confusing.
describe('Approve and merge beside the findings', () => {
  const notes = { beforeMerging: undefined, mergeEffect: 'deploys it to production', findingsLeft: 2 };
  const runId = '33333333-3333-4333-8333-333333333333';
  const findings = [
    { tier: 'nit', path: 'backend/recipes/models.py', line: 284, summary: 'Case-sensitive', fix: 'Lower the name' },
    { tier: 'nit', summary: 'No admin test' }
  ];
  const place = { repository: 'o/r', branch: 'tas-45-search' };
  const message = slackFindingsMessage(
    { id: runId, round: 1 },
    findings,
    place,
    true,
    mergeButton(workItemId, 46, notes, false)
  );

  it('leaves the accepted message above with Open PR only', () => {
    const above = slackAcceptedMessage('Accepted with two Nits.', {
      workItemId,
      prNumber: 46,
      prUrl: 'https://github.com/o/r/pull/46',
      ...notes
    });
    expect(elements(above.blocks).map((element) => (element.text as { text: string }).text)).toEqual(['Open PR #46']);
  });

  it('offers Fix ticked or Approve and merge, whose confirm says the findings stay as they are', () => {
    const [fix, merge] = elements(message.blocks);
    expect(fix).toMatchObject({ text: { text: 'Fix ticked' }, style: 'primary' });
    expect(merge).toMatchObject({ action_id: 'merge', text: { text: 'Approve and merge' } });
    expect(merge?.style).toBeUndefined();
    expect((merge?.confirm as { text: { text: string } } | undefined)?.text.text).toBe(
      'You’ll approve PR #46 on GitHub as yourself and merge it, which deploys it to production. Review’s 2 findings stay as they are, ticked or not.'
    );
  });

  it('settles without the buttons or the Fix boxes once merged', () => {
    const settled = slackMergeSettled(message.blocks, '✓ Merged by Milo Bedini at 21:10');
    expect(settled.some((block) => block.type === 'actions' || 'accessory' in block)).toBe(false);
    expect(settled.at(-1)).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: '✓ Merged by Milo Bedini at 21:10' }
    });
  });
});
