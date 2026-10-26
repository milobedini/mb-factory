import { z } from 'zod';

import type { FactoryConfig } from './config';
import type { AskedQuestion, PositionedQuestion } from './questions';
import { FOR_ALL, FOR_THE_REST, laterThan, RECOMMENDED, topicOf } from './questions';
import type { ReadyIssue } from './ready';
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

// A ready message lists at most this many issues; the Inbox has the rest.
export const MAX_READY_ROWS = 10;

// What a button sends back: the question or work item it belongs to and the reply it stands for, or the ready issues
// it delegates.
const buttonValueSchema = z.union([
  z.object({ q: z.uuid(), a: z.string().min(1) }),
  z.object({ w: z.uuid(), a: z.string().min(1) }),
  z.object({ r: z.uuid() }),
  z.object({
    d: z
      .array(z.string().regex(/^[A-Z][A-Z0-9]*-\d+$/))
      .min(1)
      .max(MAX_READY_ROWS)
  })
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
  verify: 'Verify',
  security: 'Security check',
  docs: 'Docs check'
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
      : agent === 'review'
        ? 'Answered: the build stage makes any change you asked for, or the PR stays as it is.'
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
  message: z
    .looseObject({
      ts: z.string().min(1),
      text: z.string().nullish(),
      blocks: z.array(z.record(z.string(), z.unknown())).nullish()
    })
    .nullish(),
  response_url: z.url({ protocol: /^https$/ }),
  actions: z.array(z.looseObject({ value: z.string().nullish(), action_ts: z.string().min(1) })).min(1)
});

// The message a tapped button sits in, as Slack sends it back, so it can be redrawn without being rebuilt.
export type TappedMessage = { ts: string; text: string; blocks: SlackBlock[] };

export type SlackAction = {
  userId: string;
  channelId: string | null;
  responseUrl: string;
  actionTs: string;
} & (
  | { kind: 'question'; questionId: string; body: string }
  | { kind: 'spec_gate'; workItemId: string; body: string }
  | { kind: 'delegate'; identifiers: string[]; message: TappedMessage | null }
  | { kind: 'rerun'; runId: string }
);

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
    actionTs: action.action_ts
  };
  if ('d' in value) {
    const { message } = parsed;
    return {
      ...base,
      kind: 'delegate',
      identifiers: value.d,
      message: message ? { ts: message.ts, text: message.text ?? '', blocks: message.blocks ?? [] } : null
    };
  }
  if ('r' in value) {
    return { ...base, kind: 'rerun', runId: value.r };
  }
  return 'q' in value
    ? { ...base, kind: 'question', questionId: value.q, body: value.a }
    : { ...base, kind: 'spec_gate', workItemId: value.w, body: value.a };
};

const mentionEventSchema = z.looseObject({
  type: z.literal('event_callback'),
  event: z.looseObject({
    type: z.literal('app_mention'),
    bot_id: z.string().nullish(),
    user: z.string().min(1),
    text: z.string(),
    channel: z.string().min(1),
    ts: z.string().min(1),
    thread_ts: z.string().nullish()
  })
});

export type SlackMention = { channel: string; ts: string; userId: string; request: string };

// A person's top-level mention of the app, which asks for new work. A mention inside a thread is a reply to that
// thread's work, and arrives as a `message` too; bots don't start work.
export const parseSlackMention = (payload: unknown): SlackMention | undefined => {
  const event = mentionEventSchema.safeParse(payload).data?.event;
  if (!event || event.bot_id || (event.thread_ts && event.thread_ts !== event.ts)) {
    return undefined;
  }
  return { channel: event.channel, ts: event.ts, userId: event.user, request: slackPlainText(event.text) };
};

const MAX_ISSUE_TITLE = 80;

// The console can't run Claude to write a title, so the request's first line stands in; triage sharpens the issue.
export const slackIssueFromRequest = (
  request: string,
  { name, permalink }: { name: string; permalink: string | null }
): { title: string; description: string } | undefined => {
  const firstLine = request
    .split('\n')
    .map(oneLine)
    .find((line) => line.length > 0);
  if (!firstLine) {
    return undefined;
  }
  const source = permalink ? `[in Slack](${permalink})` : 'in Slack';
  return {
    title: clip(firstLine, MAX_ISSUE_TITLE),
    description: `${request.trim()}\n\n---\n\nAsked by ${name} ${source}.`
  };
};

export const slackFiledText = (issue: { identifier: string; url: string }): string =>
  `Filed <${issue.url}|${escapeSlack(issue.identifier)}> and started on it. I’ll keep you posted in this thread.`;

export const emptyMentionText = (config: FactoryConfig): string =>
  `Mention me with what you’d like built, for example: @${config.alias} let visitors rate a recipe. Or @${config.alias} ready to see what’s ready to delegate.`;

// A mention asking what's ready rather than for new work: the one word, as typed, with any closing punctuation.
export const isReadyRequest = (request: string): boolean => /^ready[?!.]*$/i.test(request.trim());

export const nothingReadyText = (consoleUrl: string): string =>
  `Nothing is ready to delegate. The <${consoleUrl}/inbox|Inbox> shows what’s waiting on what.`;

export const notAllowedToStartText = (config: FactoryConfig): string =>
  `Only the people listed for ${config.alias} can start work here. Ask one of them, or file an issue in Linear.`;

export const wrongChannelText = (channels: string[]): string =>
  channels.length > 0
    ? `Mention me in ${channels.join(' or ')} to start work.`
    : 'No project here takes requests from Slack.';

// Slack's permalink shape for a message: the `ts` without its dot, after a `p`. A thread's link is its first message's.
export const slackMessageUrl = (workspaceUrl: string, channel: string, ts: string): string =>
  `${workspaceUrl.replace(/\/$/, '')}/archives/${channel}/p${ts.replace('.', '')}`;

const READY_ROW = 'ready:';
const READY_ALL = 'ready_all';

const readyRowText = ({ url, identifier, title, project, size }: ReadyIssue): string =>
  `<${url}|${escapeSlack(identifier)}> ${escapeSlack(title)} · ${escapeSlack(project)} · ${size}`;

const delegateAllBlock = (identifiers: string[]): SlackBlock => ({
  type: 'actions',
  block_id: READY_ALL,
  elements: [button('delegate_all', `Delegate all ${identifiers.length}`, { d: identifiers }, true)]
});

export const READY_HEADING = '*Ready to delegate*';

// The heading when an issue finishing has made others ready.
export const unblockedHeading = (identifier: string, canceled: boolean, count: number): string =>
  `*${escapeSlack(identifier)} ${canceled ? 'was canceled' : 'is done'}*, so ${count === 1 ? 'this is' : 'these are'} ready to delegate:`;

// Ready issues, each with a button that delegates it as delegating in Linear would, and one for all of them.
export const slackReadyMessage = (
  heading: string,
  issues: ReadyIssue[],
  { alias, consoleUrl }: { alias: string; consoleUrl: string }
): SlackMessage => {
  const shown = issues.slice(0, MAX_READY_ROWS);
  const more = issues.length - shown.length;
  const inbox = `<${consoleUrl}/inbox|Inbox>`;
  return {
    text: `Ready to delegate: ${shown.map(({ identifier }) => identifier).join(', ')}`,
    blocks: [
      section(heading),
      ...shown.map((issue) => ({
        type: 'section',
        block_id: `${READY_ROW}${issue.identifier}`,
        text: { type: 'mrkdwn', text: readyRowText(issue) },
        accessory: button('delegate', 'Delegate', { d: [issue.identifier] })
      })),
      ...(shown.length > 1 ? [delegateAllBlock(shown.map(({ identifier }) => identifier))] : []),
      context(
        `Delegating assigns the issue to you and starts it, like delegating to @${escapeSlack(alias)} in Linear. ${
          more > 0 ? `${more} more on the ${inbox}.` : inbox
        }`
      )
    ]
  };
};

export type ReadyOutcome = { identifier: string } & (
  | { kind: 'delegated'; by: string; at: Date }
  | { kind: 'not_ready' }
);

const clockTime = (at: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);

const settledRowText = (text: string, outcome: ReadyOutcome, timeZone: string): string =>
  outcome.kind === 'delegated'
    ? `✓ ${text} · delegated by ${escapeSlack(outcome.by)}, ${clockTime(outcome.at, timeZone)}`
    : `~${text}~ · no longer ready`;

const openRow = (block: SlackBlock): string | undefined =>
  typeof block.block_id === 'string' && block.block_id.startsWith(READY_ROW) && block.accessory !== undefined
    ? block.block_id.slice(READY_ROW.length)
    : undefined;

// A ready message redrawn from the blocks Slack sent back: settled rows lose their button and say what happened, and
// "Delegate all" covers what's still open, or goes when one row or none is left.
export const settleReadyMessage = (blocks: SlackBlock[], outcomes: ReadyOutcome[], timeZone: string): SlackBlock[] => {
  const rows = blocks.map((block) => {
    const identifier = openRow(block);
    const outcome = outcomes.find((candidate) => candidate.identifier === identifier);
    if (!identifier || !outcome) {
      return block;
    }
    const { accessory: _settled, ...row } = block;
    const text = (block.text as { text?: unknown } | undefined)?.text;
    return {
      ...row,
      text: { type: 'mrkdwn', text: settledRowText(typeof text === 'string' ? text : identifier, outcome, timeZone) }
    };
  });
  const open = rows.flatMap((block) => openRow(block) ?? []);
  return rows.flatMap((block) =>
    block.block_id !== READY_ALL ? [block] : open.length > 1 ? [delegateAllBlock(open)] : []
  );
};

const listed = (identifiers: string[]): string =>
  identifiers.length > 1 ? `${identifiers.slice(0, -1).join(', ')} and ${identifiers.at(-1)}` : (identifiers[0] ?? '');

export const notReadyText = (identifiers: string[]): string =>
  `${listed(identifiers)} ${identifiers.length === 1 ? 'isn’t' : 'aren’t'} ready any more: delegated, assigned, closed or blocked since this message. The Inbox has the current list.`;

export const delegateFailedText = (identifiers: string[], alias: string): string =>
  `I couldn’t start ${listed(identifiers)}, so ${identifiers.length === 1 ? 'it’s' : 'they’re'} still listed. Try again, or delegate to @${alias} in Linear. The details are in the console log.`;

export const READY_UNREADABLE = 'I couldn’t read Linear, so nothing was delegated. Try again in a minute.';

// A failed run's message in the thread, with a button that runs the stage again, as Re-run does in the console.
export const withRerunButton = (text: string, runId: string): SlackMessage => ({
  text,
  blocks: [section(text), { type: 'actions', elements: [button('rerun', 'Re-run', { r: runId })] }]
});

export const RERUN_GONE = 'That run can’t be re-run now: a newer run has started, or the work moved on.';
