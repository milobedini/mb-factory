import { describe, expect, it } from 'vitest';

import {
  answerSections,
  askAckText,
  askAnswerMessage,
  askCard,
  askFailedText,
  askTicketIssue,
  readAskReport,
  slackToMarkdown
} from './ask';
import { filedChoiceMessage, filedForLaterMessage, parseSlackAction } from './slack';

const HEAD = '585bd21a5d0c7e1f4b2a9c3d8e6f7a1b2c3d4e5f';
const ASK_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const ISSUE_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const report = {
  stage: 'ask',
  outcome: 'done',
  summary: 'Mostly server side.',
  head: HEAD,
  answer: '*Mostly, but not everywhere.* The catalogue filters in Django.\n\nThe cuisine chips filter in the browser.',
  ticket: { title: 'Filter cuisines on the server', request: 'Move the cuisine filter to the API.' }
};

const elements = (block: unknown): { value?: string; text: { text: string } }[] =>
  (block as { elements: { value?: string; text: { text: string } }[] }).elements;

describe('readAskReport', () => {
  it('reads the answer, the commit it was read at and the suggested ticket', () => {
    expect(readAskReport(report)).toEqual({
      answer: report.answer,
      head: HEAD,
      ticket: { title: 'Filter cuisines on the server', request: 'Move the cuisine filter to the API.' }
    });
  });

  it('makes anything that would notify people show as typed', () => {
    const read = readAskReport({
      ...report,
      answer: '<!channel> Ask <@U0CBS3FN806> or <!subteam^S1|devs>, <!date^1^{ago}|then> <https://x.dev|x>'
    });
    expect(read?.answer).toBe(
      '&lt;!channel> Ask &lt;@U0CBS3FN806> or &lt;!subteam^S1|devs>, <!date^1^{ago}|then> <https://x.dev|x>'
    );
  });

  it('can’t be beaten by nesting one form in another', () => {
    expect(readAskReport({ ...report, answer: '<<@U1>!here> <https://x.dev|<!channel>>' })?.answer).toBe(
      '&lt;&lt;@U1>!here> &lt;https://x.dev|&lt;!channel>>'
    );
  });

  it('keeps an answer whose ticket or head is malformed, and refuses a report with no answer', () => {
    expect(readAskReport({ ...report, head: 'abc', ticket: { title: '' } })).toEqual({
      answer: report.answer,
      head: null,
      ticket: null
    });
    expect(readAskReport({ ...report, answer: '  ' })).toBeUndefined();
    expect(readAskReport(null)).toBeUndefined();
  });
});

describe('answerSections', () => {
  it('packs paragraphs into sections Slack accepts', () => {
    const paragraph = 'x'.repeat(1400);
    const sections = answerSections([paragraph, paragraph, paragraph].join('\n\n'));
    expect(sections).toHaveLength(2);
    expect(sections.every((section) => section.length <= 3000)).toBe(true);
    expect(answerSections('y'.repeat(3500))[0]).toHaveLength(3000);
  });
});

describe('askCard', () => {
  const card = (state: Parameters<typeof askCard>[0]['state']) =>
    askCard({ askerId: 'U1', question: 'Do we filter <server> side?', state, emojiPrefix: 'tb', timeZone: 'UTC' });
  const line = (built: ReturnType<typeof askCard>) =>
    (built.attachments[0]?.blocks[1] as { elements: { text: string }[] } | undefined)?.elements[0]?.text;

  it('shows the question, who asked it and how its run is going', () => {
    const running = card({ kind: 'running', startedAt: new Date('2026-10-27T18:20:00Z') });
    expect(running.blocks[0]).toEqual({ type: 'section', text: { type: 'mrkdwn', text: '*Question* from <@U1>' } });
    expect(running.attachments[0]?.color).toBe('#1d9bd1');
    expect(running.attachments[0]?.blocks[0]).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: 'Do we filter &lt;server&gt; side?' }
    });
    expect(line(running)).toBe(':tb-running: *Looking into it* · <!date^1793125200^started {ago}|started at 18:20>');
  });

  it('settles grey once answered, saying when a ticket was left for later', () => {
    const answered = card({
      kind: 'answered',
      durationMs: 112_000,
      forLater: { identifier: 'TAS-57', url: 'https://linear.app/t/TAS-57' }
    });
    expect(answered.attachments[0]?.color).toBe('#6b6f76');
    expect(line(answered)).toBe(
      ':tb-merged: *Answered* in the thread · 1 min 52 s · filed <https://linear.app/t/TAS-57|TAS-57> for later'
    );
    expect(card({ kind: 'failed' }).attachments[0]?.color).toBe('#e01e5a');
    expect(line(card({ kind: 'queued', text: 'Queued: the factory is paused.' }))).toBe(
      ':tb-queued: Queued: the factory is paused.'
    );
  });
});

describe('askAnswerMessage', () => {
  const read = readAskReport(report);
  if (!read) {
    throw new Error('the report should read');
  }
  const input = {
    askId: ASK_ID,
    askerId: 'U1',
    report: read,
    repository: 'milobedini/tastebook',
    durationMs: 112_000,
    costUsd: 0.214,
    runUrl: 'https://github.com/milobedini/tastebook/actions/runs/1',
    timeZone: 'Europe/London'
  };

  it('mentions the asker, then gives the answer, where it was read, and the suggested ticket', () => {
    const message = askAnswerMessage(input);
    expect(message.text).toMatch(/^<@U1> \*Mostly, but not everywhere\.\*/);
    expect(message.blocks[0]).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: `<@U1> ${report.answer}` }
    });
    expect(message.blocks[1]).toEqual({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `Read main at <https://github.com/milobedini/tastebook/commit/${HEAD}|585bd21> · 1 min 52 s · $0.21 · <${input.runUrl}|run log>`
        }
      ]
    });
    expect(message.blocks[2]).toEqual({
      type: 'section',
      text: { type: 'mrkdwn', text: '*Ticket:* Filter cuisines on the server' }
    });
    expect(elements(message.blocks[3]).map(({ value, text }) => [text.text, value])).toEqual([
      ['File and start', JSON.stringify({ t: ASK_ID, a: 'start' })],
      ['File for later', JSON.stringify({ t: ASK_ID, a: 'later' })]
    ]);
  });

  it('says who filed the ticket in place of the buttons', () => {
    const message = askAnswerMessage({
      ...input,
      filed: {
        identifier: 'TAS-57',
        url: 'https://linear.app/t/TAS-57',
        by: 'Milo',
        at: new Date('2026-10-27T18:26:00Z'),
        started: false
      }
    });
    expect(message.blocks.at(-1)).toEqual({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '✓ Filed as <https://linear.app/t/TAS-57|TAS-57> for later by Milo at 18:26' }]
    });
    expect(message.blocks.some((block) => block.type === 'actions')).toBe(false);
  });

  it('has no ticket part when none was suggested', () => {
    const message = askAnswerMessage({ ...input, report: { ...read, ticket: null } });
    expect(message.blocks).toHaveLength(2);
  });
});

describe('the short replies', () => {
  it('link to the thread, or say it waits for the pause', () => {
    expect(askAckText('https://slack/p1', 'C1', false)).toBe(
      'Looking into it. I’ll answer in <https://slack/p1|this thread> in <#C1>, usually within three minutes.'
    );
    expect(askAckText(null, 'C1', true)).toMatch(
      /^The factory is paused.*a thread in <#C1>, and I’ll answer there then\.$/
    );
    expect(askFailedText('U1', 'It ran out of time', 'https://run')).toBe(
      '<@U1> I couldn’t answer that: It ran out of time Ask again, or see the <https://run|run log>.'
    );
  });
});

describe('slackToMarkdown', () => {
  it('turns Slack links into Markdown and makes the rest inert', () => {
    expect(
      slackToMarkdown('See <https://github.com/a/b/blob/c/x.ts#L4|x.ts:4> and ![img](https://evil) &lt;b&gt;')
    ).toBe('See [x.ts:4](https://github.com/a/b/blob/c/x.ts#L4) and !\\[img\\](https://evil) \\<b\\>');
    expect(slackToMarkdown('<https://linear.app/t/TAS-1>')).toBe(
      '[https://linear.app/t/TAS-1](https://linear.app/t/TAS-1)'
    );
  });
});

describe('askTicketIssue', () => {
  it('files the request with the question and answer it came from', () => {
    expect(
      askTicketIssue(
        { title: '  Filter   cuisines ', request: 'Move the filter to the API.' },
        {
          question: 'Do we always filter [server] side?',
          answer: 'No: <https://x.dev/a|a.ts>.',
          askerName: 'Milo',
          permalink: 'https://slack/p1'
        }
      )
    ).toEqual({
      title: 'Filter cuisines',
      description: [
        'Move the filter to the API.',
        '',
        '---',
        '',
        '**Question** from Milo [in Slack](https://slack/p1): Do we always filter \\[server\\] side?',
        '',
        '**Answer:**',
        '',
        'No: [a.ts](https://x.dev/a).'
      ].join('\n')
    });
  });
});

describe('filed issue messages', () => {
  const issue = { id: ISSUE_ID, identifier: 'TAS-58', url: 'https://linear.app/t/TAS-58' };

  it('offers to start it now or leave it, and keeps Start once left', () => {
    const choice = filedChoiceMessage(issue);
    expect(choice.text).toBe('Filed <https://linear.app/t/TAS-58|TAS-58>. Start on it now, or leave it for later?');
    expect(elements(choice.blocks[1]).map(({ text }) => text.text)).toEqual(['Start now', 'Leave for later']);
    const later = filedForLaterMessage(issue, 'Tastebook');
    expect(later.text).toMatch(
      /^Filed <https:\/\/linear.app\/t\/TAS-58\|TAS-58> for later\. It’s in Linear, unassigned until someone starts it\. /
    );
    expect(elements(later.blocks[1]).map(({ text, value }) => [text.text, value])).toEqual([
      ['Start TAS-58', JSON.stringify({ s: ISSUE_ID, a: 'start' })]
    ]);
  });

  it('reads the taps back, with the thread the message sits in', () => {
    const tap = (value: unknown, message: Record<string, unknown>) =>
      parseSlackAction({
        type: 'block_actions',
        user: { id: 'U1' },
        channel: { id: 'C1' },
        message,
        response_url: 'https://hooks.slack.com/actions/1',
        actions: [{ value: JSON.stringify(value), action_ts: '1.2' }]
      });
    expect(tap({ s: ISSUE_ID, a: 'later' }, { ts: '5.6', thread_ts: '3.4' })).toMatchObject({
      kind: 'filed',
      issueId: ISSUE_ID,
      choice: 'later',
      messageTs: '5.6',
      threadTs: '3.4'
    });
    expect(tap({ t: ASK_ID, a: 'start' }, { ts: '5.6', thread_ts: '3.4' })).toMatchObject({
      kind: 'ask_ticket',
      askId: ASK_ID,
      choice: 'start',
      messageTs: '5.6'
    });
    expect(tap({ t: ASK_ID, a: 'maybe' }, { ts: '5.6' })).toBeUndefined();
  });
});
