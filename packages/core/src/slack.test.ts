import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseFactoryConfig } from './config';
import type { AskedQuestion } from './questions';
import {
  isAllowedSlackUser,
  linearSlackReplyText,
  parseSlackAction,
  parseSlackThreadReply,
  slackPlainText,
  slackQuestionMessage,
  slackQuestionSettled,
  slackSpecGateMessage,
  slackSpecGateSettled
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

describe('slackQuestionMessage', () => {
  const round = [
    asked(1, { prompt: 'Store <img> tags?' }),
    asked(2, { topic: 'Recipe address', options: ['Slug', 'ID'] }),
    asked(3)
  ];

  it('offers each option as a button, the suggestion marked, with the shortcut and what follows', () => {
    const [first] = round;
    const message = first && slackQuestionMessage(first, round, issueUrl);
    const blocks = message ? blocksOf(message) : [];
    expect(message?.text).toBe('Question 1 of 3: Store <img> tags?');
    expect(blocks[0]?.text?.text).toBe('*Question 1 of 3:* Store &lt;img&gt; tags?');
    const buttons = blocks.find(({ type }) => type === 'actions')?.elements ?? [];
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
    expect(JSON.stringify(blocks)).toContain('2. Recipe address → Slug · 3. Question 3? → Yes 3');
  });

  it('lists long options in full, since Slack cuts button text short', () => {
    const long = asked(1, { options: ['Title and description only; new fields are a separate issue', 'More'] });
    const listed = blocksOf(slackQuestionMessage(long, [long], issueUrl))[1];
    expect(listed?.text?.text).toBe('• (R) Title and description only; new fields are a separate issue\n• More');
  });

  it('offers no shortcut on the last question', () => {
    const last = round[2];
    const blocks = last ? blocksOf(slackQuestionMessage(last, round, issueUrl)) : [];
    expect(blocks.find(({ type }) => type === 'actions')?.elements).toHaveLength(2);
    expect(JSON.stringify(blocks)).not.toContain('Still to come');
  });
});

describe('slackQuestionSettled', () => {
  it('replaces the buttons with the answer and who gave it', () => {
    const settled = slackQuestionSettled({ ...asked(2, { answer: 'Slug <x>' }), closed: false }, 3, 'Milo');
    expect(JSON.stringify(settled.blocks)).toContain('Answered by Milo: *Slug &lt;x&gt;*');
    expect(JSON.stringify(settled.blocks)).not.toContain('button');
  });

  it('says a closed question is no longer needed', () => {
    expect(JSON.stringify(slackQuestionSettled({ ...asked(1), closed: true }, 1).blocks)).toContain('No longer needed');
  });
});

describe('the spec gate', () => {
  it('offers Approve and Change something with the same values as Linear, and how to approve with suggestions', () => {
    const blocks = blocksOf(
      slackSpecGateMessage(workItemId, { prUrl: 'https://github.com/milobedini/tastebook/pull/11', issueUrl })
    );
    expect(blocks[0]?.text?.text).toContain('<https://github.com/milobedini/tastebook/pull/11|The spec>');
    const buttons = blocks.find(({ type }) => type === 'actions')?.elements ?? [];
    expect(buttons.map(({ value }) => JSON.parse(value ?? '{}'))).toEqual([
      { w: workItemId, a: 'Approve' },
      { w: workItemId, a: 'Change something' }
    ]);
    expect(JSON.stringify(blocks)).toContain('Approve: <your suggestions>');
  });

  it('says who approved or asked for changes', () => {
    expect(slackSpecGateSettled('Approve', 'Milo').text).toBe('Spec approved by Milo.');
    expect(slackSpecGateSettled('Change something', 'Milo').text).toBe('Milo asked for changes to the spec.');
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

  it('ignores buttons it didn’t make', () => {
    expect(parseSlackAction(payload('click_me_123'))).toBeUndefined();
    expect(parseSlackAction(payload(JSON.stringify({ q: 'not-a-uuid', a: 'x' })))).toBeUndefined();
    expect(parseSlackAction({ ...payload('{}'), type: 'view_submission' })).toBeUndefined();
  });
});
