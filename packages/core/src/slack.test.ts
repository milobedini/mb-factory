import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseFactoryConfig } from './config';
import type { AskedQuestion } from './questions';
import {
  emptyMentionText,
  isAllowedSlackUser,
  linearSlackReplyText,
  parseSlackAction,
  parseSlackMention,
  parseSlackThreadReply,
  slackFiledText,
  slackIssueFromRequest,
  slackMessageUrl,
  slackPlainText,
  slackQuestionCard,
  slackSpecGateMessage,
  slackSpecGateSettled,
  specUrl,
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

  it('ignores buttons it didn’t make', () => {
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
