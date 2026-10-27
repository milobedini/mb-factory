import { z } from 'zod';

import { CARD_COLOURS, STATUS_EMOJI } from './card';
import { clock } from './home';
import { neutraliseMarkdown } from './jobs';
import { formatRunTime } from './runs';
import { ESTIMATES, SIZES } from './sizes';
import type { SlackBlock, SlackMessage } from './slack';
import { button, escapeSlack, slackEmoji } from './slack';

// A question asked with the slash command: the app posts it in the project's channel as a small card, a read-only
// `ask` run answers it in the card's thread, and the answer can become a ticket, started now or left for later.

const clip = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

const section = (text: string): SlackBlock => ({ type: 'section', text: { type: 'mrkdwn', text } });

const context = (text: string): SlackBlock => ({ type: 'context', elements: [{ type: 'mrkdwn', text }] });

export const MAX_QUESTION = 1000;

// Slack takes 3,000 characters in a section; a longer answer is split across several, up to this many in all.
const SECTION_LIMIT = 3000;
const MAX_ANSWER = 8000;
const MAX_TICKET_TITLE = 80;
const MAX_TICKET_REQUEST = 4000;

const ticketSchema = z.looseObject({
  title: z.string().trim().min(1),
  request: z.string().trim().min(1),
  size: z.enum(SIZES).nullish().catch(null)
});

const askReportSchema = z.looseObject({
  // The commit on the default branch the answer was read from.
  head: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullish()
    .catch(null),
  answer: z.string().trim().min(1),
  // Work the answer shows is worth doing, when there is some.
  ticket: ticketSchema.nullish().catch(null)
});

export type AskTicket = { title: string; request: string; estimate: number | null };

export type AskReport = { answer: string; head: string | null; ticket: AskTicket | null };

// The agent read public repo and Linear text to write its answer, so nothing in it may notify anyone. Slack only
// reads `<…>` as a mention, broadcast or link when the `<` is literal, so every `<` that doesn't open a web link or a
// date is written as `&lt;` and shows as typed. Removing the forms instead could be beaten by nesting one in another.
const quiet = (text: string): string =>
  text.replace(/<(?!(?:https?:\/\/[^<>|\s]+(?:\|[^<>]*)?|!date\^[^<>]*)>)/g, '&lt;');

// A run's report as an answer; undefined when it holds none.
export const readAskReport = (report: unknown): AskReport | undefined => {
  const parsed = askReportSchema.safeParse(report).data;
  if (!parsed) {
    return undefined;
  }
  const answer = clip(quiet(parsed.answer).trim(), MAX_ANSWER);
  return {
    answer,
    head: parsed.head ?? null,
    ticket: parsed.ticket
      ? {
          title: clip(oneLine(parsed.ticket.title), MAX_TICKET_TITLE),
          request: clip(parsed.ticket.request.trim(), MAX_TICKET_REQUEST),
          estimate: parsed.ticket.size ? ESTIMATES[parsed.ticket.size] : null
        }
      : null
  };
};

// An answer's paragraphs packed into sections Slack accepts; a paragraph too long for one is cut.
export const answerSections = (answer: string): string[] =>
  answer
    .split(/\n{2,}/)
    .map((paragraph) => clip(paragraph, SECTION_LIMIT))
    .reduce<string[]>((sections, paragraph) => {
      const last = sections.at(-1);
      return last !== undefined && last.length + paragraph.length + 2 <= SECTION_LIMIT
        ? sections.slice(0, -1).concat(`${last}\n\n${paragraph}`)
        : sections.concat(paragraph);
    }, []);

export type AskCardState =
  | { kind: 'waiting' }
  | { kind: 'queued'; text: string }
  | { kind: 'running'; startedAt: Date }
  | { kind: 'answered'; durationMs: number | null; forLater: { identifier: string; url: string } | null }
  | { kind: 'failed' }
  | { kind: 'canceled' };

export type AskCardInput = {
  askerId: string;
  question: string;
  state: AskCardState;
  emojiPrefix: string;
  timeZone: string;
};

const CARD_LOOK: Record<AskCardState['kind'], keyof typeof CARD_COLOURS> = {
  waiting: 'running',
  queued: 'queued',
  running: 'running',
  answered: 'merged',
  failed: 'blocked',
  canceled: 'canceled'
};

const startedAgo = (at: Date, timeZone: string): string =>
  `<!date^${Math.floor(at.getTime() / 1000)}^started {ago}|started at ${clock(at, timeZone)}>`;

const cardLine = (state: AskCardState, timeZone: string): string => {
  switch (state.kind) {
    case 'waiting':
      return '*Looking into it*';
    case 'queued':
      return escapeSlack(state.text);
    case 'running':
      return `*Looking into it* · ${startedAgo(state.startedAt, timeZone)}`;
    case 'answered': {
      const took = state.durationMs === null ? '' : ` · ${formatRunTime(state.durationMs)}`;
      const filed = state.forLater
        ? ` · filed <${state.forLater.url}|${escapeSlack(state.forLater.identifier)}> for later`
        : '';
      return `*Answered* in the thread${took}${filed}`;
    }
    case 'failed':
      return '*Couldn’t answer:* the thread says why';
    case 'canceled':
      return '*Canceled*';
  }
};

const CARD_WORDS: Record<AskCardState['kind'], string> = {
  waiting: 'looking into it',
  queued: 'queued',
  running: 'looking into it',
  answered: 'answered',
  failed: 'couldn’t answer',
  canceled: 'canceled'
};

// The question's message in the channel, edited as its run goes; `text` is the fallback and the notification.
export const askCard = ({
  askerId,
  question,
  state,
  emojiPrefix,
  timeZone
}: AskCardInput): SlackMessage & { attachments: { color: string; blocks: SlackBlock[] }[] } => {
  const look = CARD_LOOK[state.kind];
  return {
    text: `Question from <@${askerId}>: ${CARD_WORDS[state.kind]}`,
    blocks: [section(`*Question* from <@${askerId}>`)],
    attachments: [
      {
        color: CARD_COLOURS[look],
        blocks: [
          section(escapeSlack(question)),
          context(`${slackEmoji(emojiPrefix, STATUS_EMOJI[look])} ${cardLine(state, timeZone)}`)
        ]
      }
    ]
  };
};

export type AskTicketChoice = 'start' | 'later';

export type FiledTicket = {
  identifier: string;
  url: string;
  by: string;
  at: Date;
  started: boolean;
};

export type AnswerInput = {
  askId: string;
  askerId: string;
  report: AskReport;
  repository: string;
  durationMs: number | null;
  costUsd: number | null;
  runUrl: string | null;
  timeZone: string;
  // Once the suggested ticket is filed, its buttons give way to who filed it.
  filed?: FiledTicket;
};

const answerMeta = ({ report, repository, durationMs, costUsd, runUrl }: AnswerInput): string =>
  [
    report.head
      ? `Read main at <https://github.com/${repository}/commit/${report.head}|${report.head.slice(0, 7)}>`
      : 'Read main',
    durationMs === null ? undefined : formatRunTime(durationMs),
    costUsd === null ? undefined : `$${costUsd.toFixed(2)}`,
    runUrl ? `<${runUrl}|run log>` : undefined
  ]
    .filter((part) => part !== undefined)
    .join(' · ');

export const filedLine = ({ identifier, url, by, at, started }: FiledTicket, timeZone: string): string =>
  `✓ Filed as <${url}|${escapeSlack(identifier)}>${started ? ' and started' : ' for later'} by ${escapeSlack(by)} at ${clock(at, timeZone)}`;

const ticketBlocks = (input: AnswerInput): SlackBlock[] => {
  const { ticket } = input.report;
  if (!ticket) {
    return [];
  }
  if (input.filed) {
    return [context(filedLine(input.filed, input.timeZone))];
  }
  return [
    section(`*Ticket:* ${escapeSlack(ticket.title)}`),
    {
      type: 'actions',
      elements: [
        button('ask_ticket_start', 'File and start', { t: input.askId, a: 'start' }, true),
        button('ask_ticket_later', 'File for later', { t: input.askId, a: 'later' })
      ]
    }
  ];
};

// The answer in the question's thread, mentioning the asker so they hear of it.
export const askAnswerMessage = (input: AnswerInput): SlackMessage => {
  const [first = '', ...rest] = answerSections(input.report.answer);
  const mention = `<@${input.askerId}>`;
  return {
    text: `${mention} ${clip(oneLine(input.report.answer), 300)}`,
    blocks: [section(`${mention} ${first}`), ...rest.map(section), context(answerMeta(input)), ...ticketBlocks(input)]
  };
};

export const askFailedText = (askerId: string, summary: string | null, runUrl: string | null): string =>
  `<@${askerId}> I couldn’t answer that${summary ? `: ${escapeSlack(oneLine(summary))}` : '.'}${
    runUrl ? ` Ask again, or see the <${runUrl}|run log>.` : ' Ask again in a minute.'
  }`;

export const askAckText = (threadUrl: string | null, channel: string, paused: boolean): string => {
  const where = threadUrl ? `<${threadUrl}|this thread> in <#${channel}>` : `a thread in <#${channel}>`;
  return paused
    ? `The factory is paused, so I can’t look into this until someone resumes it. Your question is in ${where}, and I’ll answer there then.`
    : `Looking into it. I’ll answer in ${where}, usually within three minutes.`;
};

export const emptyQuestionText = (command: string): string =>
  `Ask me about the code or the plan, for example: \`${command} ask what’s our full tech stack?\``;

export const askNotAllowedText = (alias: string): string =>
  `Only the people listed for ${escapeSlack(alias)} can ask. Ask one of them to add you.`;

export const ASK_TICKET_GONE = 'That ticket was already filed.';

// Slack's links `<url|label>` as Markdown, everything else made inert, for an issue description built from an answer
// the agent wrote.
export const slackToMarkdown = (text: string): string => {
  const decode = (part: string): string => part.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  // A target with brackets, quotes or angle brackets could close the Markdown link early and start an image after it,
  // so only plain URLs become links.
  const pattern = /<(https?:\/\/[^|>\s()[\]<"']+)(?:\|([^>]*))?>/g;
  const pieces = [...text.matchAll(pattern)].reduce<{ out: string; from: number }>(
    ({ out, from }, match) => {
      const [whole, url = '', label] = match;
      const before = neutraliseMarkdown(decode(text.slice(from, match.index)));
      const link = `[${neutraliseMarkdown(decode(label || url))}](${url})`;
      return { out: `${out}${before}${link}`, from: match.index + whole.length };
    },
    { out: '', from: 0 }
  );
  return `${pieces.out}${neutraliseMarkdown(decode(text.slice(pieces.from)))}`;
};

export type AskContext = {
  question: string;
  answer: string;
  askerName: string;
  permalink: string | null;
};

// A ticket filed from a question's thread: the request (Markdown as it should read: made inert first when the agent
// wrote it), then the question and answer it came from.
export const askTicketIssue = (
  { title, request }: Pick<AskTicket, 'title' | 'request'>,
  { question, answer, askerName, permalink }: AskContext
): { title: string; description: string } => ({
  title: clip(oneLine(title), MAX_TICKET_TITLE),
  description: [
    request.trim(),
    '',
    '---',
    '',
    `**Question** from ${askerName} ${permalink ? `[in Slack](${permalink})` : 'in Slack'}: ${neutraliseMarkdown(oneLine(question))}`,
    '',
    '**Answer:**',
    '',
    slackToMarkdown(answer)
  ].join('\n')
});
