import { z } from 'zod';

import type { FactoryConfig } from './config';
import type { AskedQuestion, PositionedQuestion } from './questions';
import { FOR_ALL, FOR_THE_REST, RECOMMENDED, topicOf } from './questions';

// Block Kit is plain JSON; the console only passes these through to Slack.
export type SlackBlock = Record<string, unknown>;

export type SlackMessage = { text: string; blocks: SlackBlock[] };

const BUTTON_TEXT_LIMIT = 75;
// Slack cuts button text at about 30 characters on screen, so longer options are also listed in the message.
const BUTTON_SHOWS = 30;
const MAX_MIRRORED_REPLY = 280;

export const escapeSlack = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

const clip = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

const section = (text: string): SlackBlock => ({ type: 'section', text: { type: 'mrkdwn', text } });

const context = (text: string): SlackBlock => ({ type: 'context', elements: [{ type: 'mrkdwn', text }] });

// What a button sends back: the question or work item it belongs to, and the reply it stands for.
const buttonValueSchema = z.union([
  z.object({ q: z.uuid(), a: z.string().min(1) }),
  z.object({ w: z.uuid(), a: z.string().min(1) })
]);

type ButtonValue = z.infer<typeof buttonValueSchema>;

const button = (actionId: string, text: string, value: ButtonValue, primary = false): SlackBlock => ({
  type: 'button',
  action_id: actionId,
  text: { type: 'plain_text', text: clip(text, BUTTON_TEXT_LIMIT) },
  value: JSON.stringify(value),
  ...(primary ? { style: 'primary' } : {})
});

const questionHeading = (question: PositionedQuestion, total: number): string =>
  total > 1 ? `Question ${question.position} of ${total}` : 'Question';

// A question in the work item's thread: one button per option, the suggestion first and marked, the defaults shortcut
// while more follow, and what's still to come. A reply in the thread answers it too.
export const slackQuestionMessage = (
  question: AskedQuestion,
  round: PositionedQuestion[],
  issueUrl: string
): SlackMessage => {
  const heading = questionHeading(question, round.length);
  const later = round
    .filter(({ position }) => position > question.position)
    .toSorted((a, b) => a.position - b.position);
  const shortcut = question.position === 1 ? FOR_ALL : FOR_THE_REST;
  const labels = question.options.map((option, index) => (index === 0 ? `${RECOMMENDED}${option}` : option));
  const listed = labels.some((label) => label.length > BUTTON_SHOWS)
    ? [section(labels.map((label) => `• ${escapeSlack(label)}`).join('\n'))]
    : [];
  const buttons = [
    ...question.options.map((option, index) =>
      button(`option_${index}`, labels[index] ?? option, { q: question.id, a: option }, index === 0)
    ),
    ...(later.length > 0 ? [button('defaults', shortcut, { q: question.id, a: shortcut })] : [])
  ];
  const upcoming = later.map(
    (next) => `${next.position}. ${escapeSlack(topicOf(next))} → ${escapeSlack(next.options[0] ?? '')}`
  );
  return {
    text: `${heading}: ${oneLine(question.prompt)}`,
    blocks: [
      section(`*${heading}:* ${escapeSlack(question.prompt)}`),
      ...listed,
      { type: 'actions', elements: buttons },
      ...(upcoming.length > 0
        ? [context(`Still to come, with my suggestions: ${upcoming.join(' · ')}. ${shortcut} takes them all.`)]
        : []),
      context(`Or reply in this thread in your own words. Also in <${issueUrl}|Linear>.`)
    ]
  };
};

// What a question's message becomes once it's settled, so its buttons can't be tapped again.
export const slackQuestionSettled = (
  question: AskedQuestion & { closed: boolean },
  total: number,
  answeredBy?: string
): SlackMessage => {
  const heading = questionHeading(question, total);
  const by = answeredBy ? ` by ${escapeSlack(answeredBy)}` : '';
  const outcome =
    question.answer !== null
      ? `Answered${by}: *${escapeSlack(question.answer)}*`
      : question.closed
        ? 'No longer needed: the work moved on.'
        : 'Waiting for the earlier questions first.';
  const text = `${heading}: ${oneLine(question.prompt)}`;
  return { text, blocks: [section(`*${heading}:* ${escapeSlack(question.prompt)}`), context(outcome)] };
};

export const SPEC_APPROVE = 'Approve';
export const SPEC_CHANGE = 'Change something';

// The spec approval gate in the thread: the same two answers as in Linear, read by the router just as strictly.
export const slackSpecGateMessage = (
  workItemId: string,
  { prUrl, issueUrl }: { prUrl: string | null; issueUrl: string }
): SlackMessage => {
  const spec = prUrl ? `<${prUrl}|The spec>` : 'The spec';
  return {
    text: 'The spec is ready for review.',
    blocks: [
      section(`${spec} is ready for review. Approve it to start building, or say what should change.`),
      {
        type: 'actions',
        elements: [
          button('spec_approve', SPEC_APPROVE, { w: workItemId, a: SPEC_APPROVE }, true),
          button('spec_change', SPEC_CHANGE, { w: workItemId, a: SPEC_CHANGE })
        ]
      },
      context(
        `To approve with suggestions, reply \`Approve: <your suggestions>\` in this thread. Also in <${issueUrl}|Linear>.`
      )
    ]
  };
};

export const slackSpecGateSettled = (answer: string, answeredBy: string): SlackMessage => {
  const text =
    answer === SPEC_APPROVE
      ? `Spec approved by ${escapeSlack(answeredBy)}.`
      : `${escapeSlack(answeredBy)} asked for changes to the spec.`;
  return { text, blocks: [section(text)] };
};

export const SPEC_GATE_GONE = 'The spec isn’t waiting for approval any more.';

export const notAllowedText = (config: FactoryConfig): string =>
  `Only the people listed for ${config.alias} can answer the factory here. Ask one of them, or reply in Linear.`;

export const isAllowedSlackUser = (config: FactoryConfig, userId: string): boolean =>
  config.slack?.allowedUserIds.includes(userId) ?? false;

// A reply from the thread, mirrored into the Linear session so the session stays the full record.
export const linearSlackReplyText = (name: string, body: string): string => {
  const flat = oneLine(body);
  return `Reply in Slack from ${name}: “${flat.length > MAX_MIRRORED_REPLY ? `${flat.slice(0, MAX_MIRRORED_REPLY)}…` : flat}”`;
};

// Slack's message markup as plain text: mentions of the app dropped, other mentions, channels and links readable.
export const slackPlainText = (text: string): string =>
  text
    .replace(/<@[A-Z0-9]+(?:\|([^>]+))?>/g, (_match, name?: string) => (name ? `@${name}` : ''))
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<!(here|channel|everyone)>/g, '@$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();

const messageEventSchema = z.looseObject({
  type: z.literal('event_callback'),
  event: z.looseObject({
    type: z.literal('message'),
    subtype: z.string().nullish(),
    bot_id: z.string().nullish(),
    user: z.string().min(1),
    text: z.string(),
    channel: z.string().min(1),
    ts: z.string().min(1),
    thread_ts: z.string().nullish()
  })
});

export type SlackThreadReply = { channel: string; threadTs: string; userId: string; body: string };

// A person's reply in a thread. Bots (the factory included), edits, joins and top-level messages are not replies.
export const parseSlackThreadReply = (payload: unknown): SlackThreadReply | undefined => {
  const event = messageEventSchema.safeParse(payload).data?.event;
  if (!event || event.subtype || event.bot_id || !event.thread_ts || event.thread_ts === event.ts) {
    return undefined;
  }
  const body = slackPlainText(event.text);
  return body ? { channel: event.channel, threadTs: event.thread_ts, userId: event.user, body } : undefined;
};

const actionPayloadSchema = z.looseObject({
  type: z.literal('block_actions'),
  user: z.looseObject({ id: z.string().min(1) }),
  channel: z.looseObject({ id: z.string().min(1) }).nullish(),
  response_url: z.url({ protocol: /^https$/ }),
  actions: z.array(z.looseObject({ value: z.string().nullish(), action_ts: z.string().min(1) })).min(1)
});

export type SlackAction = {
  userId: string;
  channelId: string | null;
  responseUrl: string;
  actionTs: string;
  body: string;
} & ({ kind: 'question'; questionId: string } | { kind: 'spec_gate'; workItemId: string });

const parseValue = (value: string | null | undefined): ButtonValue | undefined => {
  try {
    return buttonValueSchema.safeParse(JSON.parse(value ?? '')).data;
  } catch {
    return undefined;
  }
};

// A tap on one of the factory's buttons; anything else is undefined.
export const parseSlackAction = (payload: unknown): SlackAction | undefined => {
  const parsed = actionPayloadSchema.safeParse(payload).data;
  const [action] = parsed?.actions ?? [];
  const value = parseValue(action?.value);
  if (!parsed || !action || !value) {
    return undefined;
  }
  const base = {
    userId: parsed.user.id,
    channelId: parsed.channel?.id ?? null,
    responseUrl: parsed.response_url,
    actionTs: action.action_ts,
    body: value.a
  };
  return 'q' in value
    ? { ...base, kind: 'question', questionId: value.q }
    : { ...base, kind: 'spec_gate', workItemId: value.w };
};
