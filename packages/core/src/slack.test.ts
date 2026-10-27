import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseFactoryConfig } from './config';
import type { AskedQuestion } from './questions';
import type { ReadyIssue } from './ready';
import type { SlackBlock } from './slack';
import {
  delegateFailedText,
  emptyMentionText,
  isAllowedSlackUser,
  isReadyRequest,
  linearSlackReplyText,
  nothingReadyText,
  notReadyText,
  parseSlackAction,
  parseSlackMention,
  parseSlackThreadReply,
  READY_HEADING,
  settleReadyMessage,
  slackFiledText,
  slackGateMessage,
  slackGateSettled,
  slackIssueFromRequest,
  slackMessageUrl,
  slackPlainText,
  slackQuestionCard,
  slackReadyMessage,
  slackSpecGateMessage,
  slackSpecGateSettled,
  specUrl,
  unblockedHeading,
  withRerunButton,
  wrongChannelText
} from './slack';

const config = parseFactoryConfig(
  readFileSync(fileURLToPath(new URL('../../../projects/tastebook/factory.yaml', import.meta.url)), 'utf8')
);

const questionId = '1b4e28ba-2fa1-41d2-883f-0016d3cca427';
const workItemId = '61a9c2a8-6b99-4e1a-acdc-cb7c0ca4b81a';
const issueUrl = 'https://linear.app/tastebook/issue/TAS-14';

const asked = (position: number, overrides: Partial<AskedQuestion> = {}): AskedQuestion => ({
  id: position === 1 ? questionId : `q${position}`,
  position,
  prompt: `Question ${position}?`,
  topic: null,
  why: null,
  options: [`Yes ${position}`, `No ${position}`],
  answer: null,
  answerSource: null,
  ...overrides
});

type Block = {
  type: string;
  text?: { text: string };
  elements?: { text: { text: string } | string; value?: string; style?: string }[];
};

const blocksOf = (message: { blocks: unknown[] }): Block[] => message.blocks as Block[];

describe('slackQuestionCard', () => {
  const card = (overrides: Partial<AskedQuestion>[] = []) =>
    [asked(1), asked(2, { topic: 'Recipe address', options: ['Slug', 'ID'] }), asked(3)].map((question, index) => ({
      ...question,
      ...overrides[index],
      closed: false
    }));
  const textOf = (blocks: Block[]) => JSON.stringify(blocks);
  const buttonsOf = (blocks: Block[]) => blocks.find(({ type }) => type === 'actions')?.elements ?? [];

  it('asks the first question with a button per option, the suggestion marked, and lists the rest', () => {
    const message = slackQuestionCard(
      'spec',
      card([{ prompt: 'Store <img> tags?', why: 'Tags bloat <html>.' }]),
      issueUrl
    );
    const blocks = blocksOf(message);
    expect(message.text).toBe('Spec questions: Store <img> tags?');
    expect(blocks[0]?.text?.text).toBe('*Spec questions* · 1 of 3');
    expect(blocks[1]?.text?.text).toBe('*1. Store &lt;img&gt; tags?*');
    expect(textOf(blocks)).toContain('Tags bloat &lt;html&gt;.');
    const buttons = buttonsOf(blocks);
    expect(buttons.map(({ text }) => (typeof text === 'string' ? text : text.text))).toEqual([
      '(R) Yes 1',
      'No 1',
      'Use the defaults for all'
    ]);
    expect(buttons[0]?.style).toBe('primary');
    expect(buttons.map(({ value }) => JSON.parse(value ?? '{}'))).toEqual([
      { q: questionId, a: 'Yes 1' },
      { q: questionId, a: 'No 1' },
      { q: questionId, a: 'Use the defaults for all' }
    ]);
    expect(textOf(blocks)).toContain(
      'Still to come, with my suggestions:\\n2. Recipe address → Slug\\n3. Question 3? → Yes 3'
    );
  });

  it('collapses answered questions to a line and moves on, with the shortcut for the rest', () => {
    const blocks = blocksOf(slackQuestionCard('spec', card([{ answer: 'No 1', answerSource: 'option' }]), issueUrl));
    expect(blocks[0]?.text?.text).toBe('*Spec questions* · 2 of 3');
    expect(blocks[1]?.text?.text).toBe('✓ 1. Question 1? → *No 1*');
    expect(blocks[2]?.text?.text).toBe('*2. Question 2?*');
    expect(buttonsOf(blocks).at(-1)?.text).toMatchObject({ text: 'Use the defaults for the rest' });
  });

  it('shows typed answers quoted and defaults marked, and says the stage runs again once all are answered', () => {
    const blocks = blocksOf(
      slackQuestionCard(
        'spec',
        card([
          { answer: 'Use <slugs>', answerSource: 'text' },
          { answer: 'Slug', answerSource: 'default' },
          { answer: 'Yes 3', answerSource: 'default' }
        ]),
        issueUrl
      )
    );
    expect(blocks[0]?.text?.text).toBe('*Spec questions* · all answered');
    expect(blocks[1]?.text?.text).toBe(
      '✓ 1. Question 1? → “Use &lt;slugs&gt;”\n✓ 2. Recipe address → *Slug* (default)\n✓ 3. Question 3? → *Yes 3* (default)'
    );
    expect(buttonsOf(blocks)).toEqual([]);
    expect(textOf(blocks)).toContain('The spec run starts again with your answers.');
  });

  it('lists long options in full, since Slack cuts button text short', () => {
    const long = card([{ options: ['Title and description only; new fields are a separate issue', 'More'] }]);
    expect(blocksOf(slackQuestionCard('spec', long, issueUrl))[2]?.text?.text).toBe(
      '• (R) Title and description only; new fields are a separate issue\n• More'
    );
  });

  it('offers no shortcut on the last question, and says when the work moved on', () => {
    const last = card([
      { answer: 'Yes 1', answerSource: 'option' },
      { answer: 'Slug', answerSource: 'option' }
    ]);
    expect(buttonsOf(blocksOf(slackQuestionCard('triage', last, issueUrl)))).toHaveLength(2);
    const closed = card().map((question) => ({ ...question, closed: true }));
    const blocks = blocksOf(slackQuestionCard('implement', closed, issueUrl));
    expect(blocks[0]?.text?.text).toBe('*Build questions* · no longer needed');
    expect(buttonsOf(blocks)).toEqual([]);
  });
});

describe('the spec gate', () => {
  it('offers Approve and Change something with the same values as Linear, and how to approve with suggestions', () => {
    const blocks = blocksOf(
      slackSpecGateMessage(workItemId, {
        specUrl: 'https://github.com/milobedini/tastebook/blob/tas-14-x/specs/TAS-14.md',
        prUrl: 'https://github.com/milobedini/tastebook/pull/11',
        issueUrl
      })
    );
    expect(blocks[0]?.text?.text).toBe(
      '<https://github.com/milobedini/tastebook/blob/tas-14-x/specs/TAS-14.md|The spec> (<https://github.com/milobedini/tastebook/pull/11|PR>) is ready for review. Approve it to start building, or say what should change.'
    );
    const buttons = blocks.find(({ type }) => type === 'actions')?.elements ?? [];
    expect(buttons.map(({ value }) => JSON.parse(value ?? '{}'))).toEqual([
      { w: workItemId, a: 'Approve' },
      { w: workItemId, a: 'Change something' }
    ]);
    expect(JSON.stringify(blocks)).toContain('Approve: <your suggestions>');
  });

  it('says who approved or asked for changes, and where', () => {
    const pr = 'https://github.com/milobedini/tastebook/pull/11';
    expect(blocksOf(slackSpecGateSettled('approved', 'by Milo', pr))[0]?.text?.text).toBe(
      `✓ <${pr}|The spec> was approved by Milo. Building starts next.`
    );
    expect(blocksOf(slackSpecGateSettled('changes', 'in Linear', null))[0]?.text?.text).toBe(
      'Changes to the spec were asked for in Linear.'
    );
  });
});

describe('specUrl', () => {
  const workItem = { repository: 'milobedini/tastebook', issueIdentifier: 'TAS-15', prNumber: 12 };

  it('points at the rendered spec file on the branch', () => {
    expect(specUrl({ ...workItem, branch: 'tas-15-let-visitors-search-recipes-by-title' })).toBe(
      'https://github.com/milobedini/tastebook/blob/tas-15-let-visitors-search-recipes-by-title/specs/TAS-15.md'
    );
  });

  it('falls back to the PR, then to nothing', () => {
    expect(specUrl({ ...workItem, branch: null })).toBe('https://github.com/milobedini/tastebook/pull/12');
    expect(specUrl({ ...workItem, branch: null, prNumber: null })).toBeNull();
  });
});

describe('isAllowedSlackUser', () => {
  it('allows only the members factory.yaml lists', () => {
    expect(isAllowedSlackUser(config, 'U0CBS3FN806')).toBe(true);
    expect(isAllowedSlackUser(config, 'U0SOMEONE00')).toBe(false);
  });
});

describe('slackPlainText', () => {
  it('drops the app mention and makes other markup readable', () => {
    expect(
      slackPlainText('<@U0APP> use a slug &amp; see <https://x.dev|the docs>, cc <@U02|ana> in <#C01|general>')
    ).toBe('use a slug & see the docs (https://x.dev), cc @ana in #general');
    expect(slackPlainText('Approve: keep &lt;h1&gt; <https://x.dev>')).toBe('Approve: keep <h1> https://x.dev');
  });
});

describe('linearSlackReplyText', () => {
  it('quotes the reply on one line, clipped', () => {
    expect(linearSlackReplyText('Milo', 'A readable\n\nslug')).toBe('Reply in Slack from Milo: “A readable slug”');
    expect(linearSlackReplyText('Milo', 'x'.repeat(300))).toHaveLength('Reply in Slack from Milo: “”…'.length + 280);
  });
});

describe('parseSlackThreadReply', () => {
  const event = {
    type: 'message',
    user: 'U0CBS3FN806',
    text: '<@U0APP> A readable slug',
    channel: 'C0CBSE2Q6FQ',
    ts: '1792947100.000200',
    thread_ts: '1792947014.572229'
  };
  const delivery = (overrides: Record<string, unknown> = {}) => ({
    type: 'event_callback',
    event_id: 'Ev1',
    event: { ...event, ...overrides }
  });

  it('reads a person’s reply in a thread as plain text', () => {
    expect(parseSlackThreadReply(delivery())).toEqual({
      channel: 'C0CBSE2Q6FQ',
      threadTs: '1792947014.572229',
      userId: 'U0CBS3FN806',
      body: 'A readable slug'
    });
  });

  it('ignores bots, edits, top-level messages, thread parents and empty text', () => {
    expect(parseSlackThreadReply(delivery({ bot_id: 'B1' }))).toBeUndefined();
    expect(parseSlackThreadReply(delivery({ subtype: 'message_changed' }))).toBeUndefined();
    expect(parseSlackThreadReply(delivery({ thread_ts: undefined }))).toBeUndefined();
    expect(parseSlackThreadReply(delivery({ thread_ts: event.ts }))).toBeUndefined();
    expect(parseSlackThreadReply(delivery({ text: '<@U0APP>' }))).toBeUndefined();
    expect(parseSlackThreadReply(delivery({ type: 'app_mention' }))).toBeUndefined();
  });
});

describe('parseSlackAction', () => {
  const payload = (value: string) => ({
    type: 'block_actions',
    user: { id: 'U0CBS3FN806', username: 'milo' },
    channel: { id: 'C0CBSE2Q6FQ' },
    message: { ts: '1792947100.000300' },
    response_url: 'https://hooks.slack.com/actions/A1/2/x',
    actions: [{ action_id: 'option_1', value, action_ts: '1792947200.1' }]
  });

  it('reads a question button', () => {
    expect(parseSlackAction(payload(JSON.stringify({ q: questionId, a: 'No 1' })))).toEqual({
      kind: 'question',
      questionId,
      body: 'No 1',
      userId: 'U0CBS3FN806',
      channelId: 'C0CBSE2Q6FQ',
      responseUrl: 'https://hooks.slack.com/actions/A1/2/x',
      actionTs: '1792947200.1'
    });
  });

  it('reads a spec gate button', () => {
    expect(parseSlackAction(payload(JSON.stringify({ w: workItemId, a: 'Approve' })))).toMatchObject({
      kind: 'spec_gate',
      workItemId,
      body: 'Approve'
    });
  });

  it('reads a gate button', () => {
    expect(parseSlackAction(payload(JSON.stringify({ g: workItemId, a: 'Create them' })))).toMatchObject({
      kind: 'gate',
      workItemId,
      body: 'Create them'
    });
  });

  it('reads a delegate button with the message it sits in', () => {
    const blocks = [{ type: 'section', block_id: 'ready:TAS-25' }];
    expect(
      parseSlackAction({
        ...payload(JSON.stringify({ d: ['TAS-25', 'TAS-26'] })),
        message: { ts: '1792947100.000300', text: 'Ready to delegate: TAS-25, TAS-26', blocks }
      })
    ).toMatchObject({
      kind: 'delegate',
      identifiers: ['TAS-25', 'TAS-26'],
      message: { ts: '1792947100.000300', text: 'Ready to delegate: TAS-25, TAS-26', blocks }
    });
    expect(parseSlackAction(payload(JSON.stringify({ d: ['TAS-25'] })))).toMatchObject({
      message: { ts: '1792947100.000300', text: '', blocks: [] }
    });
  });

  it('reads a Re-run button', () => {
    const { blocks } = withRerunButton('The review run failed.', workItemId);
    const [rerun] = (blocks[1]?.elements ?? []) as { value: string }[];
    expect(rerun).toBeDefined();
    expect(parseSlackAction(payload(rerun?.value ?? ''))).toMatchObject({ kind: 'rerun', runId: workItemId });
  });

  it('ignores buttons it didn’t make', () => {
    expect(parseSlackAction(payload(JSON.stringify({ d: ['not an issue'] })))).toBeUndefined();
    expect(parseSlackAction(payload(JSON.stringify({ d: [] })))).toBeUndefined();
    expect(parseSlackAction(payload('click_me_123'))).toBeUndefined();
    expect(parseSlackAction(payload(JSON.stringify({ q: 'not-a-uuid', a: 'x' })))).toBeUndefined();
    expect(parseSlackAction({ ...payload('{}'), type: 'view_submission' })).toBeUndefined();
  });
});

describe('parseSlackMention', () => {
  const event = {
    type: 'app_mention',
    user: 'U0CBS3FN806',
    text: '<@U0APP> Let visitors rate a recipe\nOut of five stars',
    channel: 'C0CBSE2Q6FQ',
    ts: '1792950000.000100'
  };
  const delivery = (overrides: Record<string, unknown> = {}) => ({
    type: 'event_callback',
    event_id: 'Ev2',
    event: { ...event, ...overrides }
  });

  it('reads a top-level mention as a request in plain text', () => {
    expect(parseSlackMention(delivery())).toEqual({
      channel: 'C0CBSE2Q6FQ',
      ts: '1792950000.000100',
      userId: 'U0CBS3FN806',
      request: 'Let visitors rate a recipe\nOut of five stars'
    });
    expect(parseSlackMention(delivery({ thread_ts: event.ts }))?.ts).toBe(event.ts);
  });

  it('ignores mentions in a thread, from bots, and other events', () => {
    expect(parseSlackMention(delivery({ thread_ts: '1792947014.572229' }))).toBeUndefined();
    expect(parseSlackMention(delivery({ bot_id: 'B1' }))).toBeUndefined();
    expect(parseSlackMention(delivery({ type: 'message' }))).toBeUndefined();
  });
});

describe('slackIssueFromRequest', () => {
  const from = { name: 'Milo', permalink: 'https://tastebook.slack.com/archives/C0CBSE2Q6FQ/p1792950000000100' };

  it('titles the issue with the first line and keeps the whole request, linked to Slack', () => {
    expect(slackIssueFromRequest('\n  Let visitors   rate a recipe \nOut of five stars', from)).toEqual({
      title: 'Let visitors rate a recipe',
      description: `Let visitors   rate a recipe \nOut of five stars\n\n---\n\nAsked by Milo [in Slack](${from.permalink}).`
    });
  });

  it('clips a long title, and does without a link', () => {
    const issue = slackIssueFromRequest('x'.repeat(100), { name: 'Milo', permalink: null });
    expect(issue?.title).toHaveLength(80);
    expect(issue?.title.endsWith('…')).toBe(true);
    expect(issue?.description.endsWith('Asked by Milo in Slack.')).toBe(true);
  });

  it('has nothing to file for an empty request', () => {
    expect(slackIssueFromRequest(' \n ', from)).toBeUndefined();
  });
});

describe('intake replies', () => {
  it('links the filed issue', () => {
    expect(slackFiledText({ identifier: 'TAS-16', url: 'https://linear.app/tastebook/issue/TAS-16' })).toBe(
      'Filed <https://linear.app/tastebook/issue/TAS-16|TAS-16> and started on it. I’ll keep you posted in this thread.'
    );
  });

  it('names the app and the channels that take requests', () => {
    expect(emptyMentionText(config)).toContain('@Tastebook');
    expect(wrongChannelText(['#tastebook-factory'])).toBe('Mention me in #tastebook-factory to start work.');
    expect(wrongChannelText([])).toBe('No project here takes requests from Slack.');
  });
});

describe('slackMessageUrl', () => {
  it('builds the permalink from the workspace address, channel and ts', () => {
    expect(slackMessageUrl('https://tastebook.slack.com/', 'C0CBSE2Q6FQ', '1793000285.963819')).toBe(
      'https://tastebook.slack.com/archives/C0CBSE2Q6FQ/p1793000285963819'
    );
  });
});

describe('ready messages', () => {
  const ready = (identifier: string, title: string): ReadyIssue => ({
    id: `id-${identifier}`,
    identifier,
    title,
    url: `https://linear.app/tastebook/issue/${identifier}`,
    project: 'Platform',
    size: 'unsized',
    assignee: null,
    blockedBy: [],
    waitingOn: []
  });
  const options = { alias: 'Tastebook', consoleUrl: 'https://console.example' };
  const issues = [ready('TAS-25', 'Report errors to Sentry'), ready('TAS-26', 'Check <every> preview')];
  const at = new Date('2026-10-26T16:42:10Z');

  const buttonsOf = (blocks: SlackBlock[]) =>
    blocks.flatMap((block) => [
      ...(block.accessory ? [block.accessory] : []),
      ...((block.elements as SlackBlock[] | undefined) ?? []).filter(({ type }) => type === 'button')
    ]) as { action_id: string; text: { text: string }; value: string }[];

  it('lists each issue with a Delegate button, and one for all of them', () => {
    const message = slackReadyMessage(READY_HEADING, issues, options);
    expect(message.text).toBe('Ready to delegate: TAS-25, TAS-26');
    expect(message.blocks[2]).toMatchObject({
      block_id: 'ready:TAS-26',
      text: {
        text: '<https://linear.app/tastebook/issue/TAS-26|TAS-26> Check &lt;every&gt; preview · Platform · unsized'
      }
    });
    expect(buttonsOf(message.blocks).map(({ action_id, text, value }) => [action_id, text.text, value])).toEqual([
      ['delegate', 'Delegate', '{"d":["TAS-25"]}'],
      ['delegate', 'Delegate', '{"d":["TAS-26"]}'],
      ['delegate_all', 'Delegate all 2', '{"d":["TAS-25","TAS-26"]}']
    ]);
    expect(message.blocks.at(-1)).toMatchObject({
      elements: [
        {
          text: 'Delegating assigns the issue to you and starts it, like delegating to @Tastebook in Linear. <https://console.example/inbox|Inbox>'
        }
      ]
    });
  });

  it('has no Delegate all for one issue, and sends the rest past ten to the Inbox', () => {
    expect(buttonsOf(slackReadyMessage(READY_HEADING, issues.slice(0, 1), options).blocks)).toHaveLength(1);
    const many = Array.from({ length: 12 }, (_, index) => ready(`TAS-${index + 30}`, 'An issue'));
    const message = slackReadyMessage(READY_HEADING, many, options);
    expect(buttonsOf(message.blocks)).toHaveLength(11);
    expect(JSON.stringify(message.blocks.at(-1))).toContain('2 more on the <https://console.example/inbox|Inbox>.');
  });

  it('heads a message about what an issue finishing made ready', () => {
    expect(unblockedHeading('TAS-24', false, 3)).toBe('*TAS-24 is done*, so these are ready to delegate:');
    expect(unblockedHeading('TAS-24', true, 1)).toBe('*TAS-24 was canceled*, so this is ready to delegate:');
  });

  it('settles tapped rows, and keeps Delegate all for what is still open', () => {
    const three = [...issues, ready('TAS-27', 'Back up the database')];
    const { blocks } = slackReadyMessage(READY_HEADING, three, options);
    const settled = settleReadyMessage(
      blocks,
      [
        { identifier: 'TAS-25', kind: 'delegated', by: 'Milo', at },
        { identifier: 'TAS-26', kind: 'not_ready' }
      ],
      'Europe/London'
    );
    expect(settled[1]).toEqual({
      type: 'section',
      block_id: 'ready:TAS-25',
      text: {
        type: 'mrkdwn',
        text: '✓ <https://linear.app/tastebook/issue/TAS-25|TAS-25> Report errors to Sentry · Platform · unsized · delegated by Milo, 16:42'
      }
    });
    expect(settled[2]).toMatchObject({ text: { text: expect.stringMatching(/^~.*~ · no longer ready$/) } });
    expect(buttonsOf(settled).map(({ action_id }) => action_id)).toEqual(['delegate']);
    expect(settled).toHaveLength(blocks.length - 1);
  });

  it('keeps Delegate all, narrowed, while two or more are open', () => {
    const three = [...issues, ready('TAS-27', 'Back up the database')];
    const settled = settleReadyMessage(
      slackReadyMessage(READY_HEADING, three, options).blocks,
      [{ identifier: 'TAS-26', kind: 'delegated', by: 'Milo', at }],
      'Europe/London'
    );
    expect(buttonsOf(settled).at(-1)).toMatchObject({
      text: { text: 'Delegate all 2' },
      value: '{"d":["TAS-25","TAS-27"]}'
    });
  });

  it('leaves a settled row as it is when it is tapped again', () => {
    const once = settleReadyMessage(
      slackReadyMessage(READY_HEADING, issues, options).blocks,
      [{ identifier: 'TAS-25', kind: 'delegated', by: 'Milo', at }],
      'Europe/London'
    );
    expect(settleReadyMessage(once, [{ identifier: 'TAS-25', kind: 'not_ready' }], 'Europe/London')).toEqual(once);
  });

  it('tells “ready” apart from a request for new work', () => {
    expect(['ready', 'Ready?', ' READY! '].map(isReadyRequest)).toEqual([true, true, true]);
    expect(['ready the recipe page for launch', 'already done', ''].map(isReadyRequest)).toEqual([false, false, false]);
  });

  it('says when nothing is ready', () => {
    expect(nothingReadyText('https://console.example')).toBe(
      'Nothing is ready to delegate. The <https://console.example/inbox|Inbox> shows what’s waiting on what.'
    );
  });

  it('says which issues weren’t ready or couldn’t start', () => {
    expect(notReadyText(['TAS-26'])).toBe(
      'TAS-26 isn’t ready any more: delegated, assigned, closed or blocked since this message. The Inbox has the current list.'
    );
    expect(delegateFailedText(['TAS-25', 'TAS-26', 'TAS-27'], 'Tastebook')).toBe(
      'I couldn’t start TAS-25, TAS-26 and TAS-27, so they’re still listed. Try again, or delegate to @Tastebook in Linear. The details are in the console log.'
    );
  });
});

describe('slackGateMessage', () => {
  const gate = {
    body: '**Verdict:** split into 2 issues.\n\n## Slices\n- Recipe details, M\n- Recipe photo, S',
    options: ['Create them', 'Change something', 'Keep as one']
  };

  it('shows the gate in Slack’s markup, with a button per option and the first suggested', () => {
    const { blocks } = slackGateMessage(workItemId, gate, 'https://linear.app/tastebook/issue/TAS-37');
    expect(blocks[0]).toEqual({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Verdict:* split into 2 issues.\n\n*Slices*\n• Recipe details, M\n• Recipe photo, S'
      }
    });
    const actions = blocks[1] as { elements: { text: { text: string }; value: string; style?: string }[] };
    expect(actions.elements.map(({ text }) => text.text)).toEqual(gate.options);
    expect(JSON.parse(actions.elements[0]?.value ?? '')).toEqual({ g: workItemId, a: 'Create them' });
    expect(actions.elements.map(({ style }) => style)).toEqual(['primary', undefined, undefined]);
  });

  it('splits a long gate over sections Slack can hold', () => {
    const long = {
      ...gate,
      body: Array.from({ length: 120 }, (_, index) => `- Slice ${index} ${'x'.repeat(60)}`).join('\n')
    };
    const sections = slackGateMessage(workItemId, long, 'https://linear.app/x').blocks.filter(
      (block) => block.type === 'section'
    ) as { text: { text: string } }[];
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.every(({ text }) => text.text.length <= 3000)).toBe(true);
    expect(sections.map(({ text }) => text.text).join('\n')).toContain('• Slice 119');
  });

  it('keeps the gate and swaps its buttons for the answer once settled', () => {
    const { blocks } = slackGateSettled(gate, 'Create them', 'by Milo');
    expect(blocks.some((block) => block.type === 'actions')).toBe(false);
    expect(blocks.at(-1)).toEqual({ type: 'context', elements: [{ type: 'mrkdwn', text: '✓ Create them, by Milo.' }] });
  });
});
