import { z } from 'zod';

import type { FactoryConfig } from './config';
import type { AskedQuestion, PositionedQuestion } from './questions';
import { FOR_ALL, FOR_THE_REST, laterThan, RECOMMENDED, topicOf } from './questions';
import type { AgentRole } from './stages';

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

const STAGE_NAMES: Record<AgentRole, string> = {
  triage: 'Triage',
  spec: 'Spec',
  implement: 'Build',
  review: 'Review',
  verify: 'Verify'
};

const MAX_TYPED_ANSWER_SHOWN = 200;

export type CardQuestion = AskedQuestion & { closed: boolean };

const shownAnswer = ({ answer, answerSource }: CardQuestion): string => {
  const text = escapeSlack(oneLine(answer ?? ''));
  if (answerSource === 'text') {
    return `“${clip(text, MAX_TYPED_ANSWER_SHOWN)}”`;
  }
  return answerSource === 'default' ? `*${text}* (default)` : `*${text}*`;
};

// A round of questions as one message in the thread, edited as it's answered from anywhere: answered questions
// collapse to a line, the current one has a button per option (the suggestion first and marked, the defaults shortcut
// while more follow), and the rest are listed with their suggestions. A reply in the thread answers it too.
export const slackQuestionCard = (agent: AgentRole, round: CardQuestion[], issueUrl: string): SlackMessage => {
  const ordered = round.toSorted((a, b) => a.position - b.position);
  const closed = ordered.some((question) => question.closed);
  const current = closed ? undefined : ordered.find(({ answer }) => answer === null);
  const title = `${STAGE_NAMES[agent]} questions`;
  const status = closed
    ? 'no longer needed'
    : current
      ? ordered.length > 1
        ? `${current.position} of ${ordered.length}`
        : undefined
      : 'all answered';
  const answered = ordered
    .filter(({ answer }) => answer !== null)
    .map((question) => `✓ ${question.position}. ${escapeSlack(topicOf(question))} → ${shownAnswer(question)}`);
  const later = current ? laterThan(current, ordered) : [];
  const footer = current
    ? `Reply in this thread to answer in your own words. Also in <${issueUrl}|Linear>.`
    : closed
      ? 'The work moved on before these were all answered.'
      : `The ${agent} run starts again with your answers.`;
  return {
    text: current ? `${title}: ${oneLine(current.prompt)}` : `${title}: ${status}`,
    blocks: [
      section(`*${title}*${status ? ` · ${status}` : ''}`),
      ...(answered.length > 0 ? [section(answered.join('\n'))] : []),
      ...(current ? currentQuestionBlocks(current, later) : []),
      ...(later.length > 0
        ? [
            context(
              [
                'Still to come, with my suggestions:',
                ...later.map(
                  (next) => `${next.position}. ${escapeSlack(topicOf(next))} → ${escapeSlack(next.options[0] ?? '')}`
                )
              ].join('\n')
            )
          ]
        : []),
      context(footer)
    ]
  };
};

const currentQuestionBlocks = (question: CardQuestion, later: PositionedQuestion[]): SlackBlock[] => {
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
  return [
    section(`*${question.position}. ${escapeSlack(question.prompt)}*`),
    ...(question.why ? [context(escapeSlack(question.why))] : []),
    ...listed,
    { type: 'actions', elements: buttons }
  ];
};

export const SPEC_APPROVE = 'Approve';
export const SPEC_CHANGE = 'Change something';

// Specs live at `specs/<ISSUE-ID>.md` on the work item's branch; GitHub renders the file, which reads better than the
// PR's diff. Without a branch, the PR is the next best thing.
export const specUrl = ({
  repository,
  branch,
  issueIdentifier,
  prNumber
}: {
  repository: string;
  branch: string | null;
  issueIdentifier: string;
  prNumber: number | null;
}): string | null => {
  if (branch) {
    return `https://github.com/${repository}/blob/${encodeURI(branch)}/specs/${encodeURIComponent(issueIdentifier)}.md`;
  }
  return prNumber ? `https://github.com/${repository}/pull/${prNumber}` : null;
};

const specLink = (url: string | null, label: string): string => (url ? `<${url}|${label}>` : label);

// The spec approval gate in the thread: the same two answers as in Linear, read by the router just as strictly.
export const slackSpecGateMessage = (
  workItemId: string,
  { specUrl: spec, prUrl, issueUrl }: { specUrl: string | null; prUrl: string | null; issueUrl: string }
): SlackMessage => {
  const pr = prUrl ? ` (<${prUrl}|PR>)` : '';
  return {
    text: 'The spec is ready for review.',
    blocks: [
      section(
        `${specLink(spec, 'The spec')}${pr} is ready for review. Approve it to start building, or say what should change.`
      ),
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

// The gate once answered, wherever: `by` reads "by Milo" or "in Linear".
export const slackSpecGateSettled = (
  outcome: 'approved' | 'changes',
  by: string,
  spec: string | null
): SlackMessage => {
  const text =
    outcome === 'approved'
      ? `✓ ${specLink(spec, 'The spec')} was approved ${escapeSlack(by)}. Building starts next.`
      : `Changes to ${specLink(spec, 'the spec')} were asked for ${escapeSlack(by)}.`;
  return {
    text: outcome === 'approved' ? 'The spec was approved.' : 'Changes to the spec were asked for.',
    blocks: [section(text)]
  };
};

export const SPEC_GATE_GONE = 'The spec isn’t waiting for approval any more.';

export const QUESTION_GONE = 'That question was already answered, or the work moved on.';

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
