import { z } from 'zod';

import type { FactoryConfig } from './config';
import type { Gate } from './gates';
import { slackChunks, slackMarkdown } from './gates';
import type { AskedQuestion, PositionedQuestion } from './questions';
import { FOR_ALL, FOR_THE_REST, laterThan, RECOMMENDED, topicOf } from './questions';
import type { ReadyIssue } from './ready';
import type { ReviewFinding } from './router';
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

// Custom emoji uploaded to the workspace (sources in `slack-assets/emoji`), named after the project's prefix.
export const slackEmoji = (prefix: string, name: string): string => `:${prefix}-${name}:`;

const SIZE_WORDS: Record<string, string> = {
  XS: 'Extra small',
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large'
};

// The size as its bars emoji and the word, since a letter alone isn't clear.
export const sizeText = (label: string, prefix: string): string | undefined => {
  const word = SIZE_WORDS[label];
  return word ? `${slackEmoji(prefix, `size-${label.toLowerCase()}`)} ${word}` : undefined;
};

// Where an issue sits in Linear: its project, linked, › its milestone.
export const projectText = (
  project: { name: string; url: string | null } | null,
  milestone: string | null
): string | undefined =>
  project
    ? `${project.url ? `<${project.url}|${escapeSlack(project.name)}>` : escapeSlack(project.name)}${
        milestone ? ` › ${escapeSlack(milestone)}` : ''
      }`
    : undefined;

// An issue's size and place, as the card's meta line shows them, for rows that offer issues to delegate.
export const issueMetaText = (
  issue: { size: string; project?: string | null; projectUrl?: string | null; milestone?: string | null },
  prefix: string
): string =>
  [
    sizeText(issue.size, prefix) ?? 'Unsized',
    projectText(issue.project ? { name: issue.project, url: issue.projectUrl ?? null } : null, issue.milestone ?? null)
  ]
    .filter((part) => part !== undefined)
    .join(' · ');

// A ready message lists at most this many issues; the Inbox has the rest.
export const MAX_READY_ROWS = 10;

// The App Home's own buttons.
export const HOME_ACTIONS = ['refresh', 'pause', 'resume'] as const;

export type HomeAction = (typeof HOME_ACTIONS)[number];

// What a button sends back: the question or work item it belongs to and the reply it stands for, or the ready issues
// it delegates.
const buttonValueSchema = z.union([
  z.object({ q: z.uuid(), a: z.string().min(1) }),
  z.object({ w: z.uuid(), a: z.string().min(1) }),
  z.object({ g: z.uuid(), a: z.string().min(1) }),
  z.object({ r: z.uuid() }),
  // Approve and merge a work item's PR.
  z.object({ m: z.uuid() }),
  // Review findings: fix the ticked ones, or leave them all.
  z.object({ f: z.uuid(), a: z.enum(['fix', 'keep']) }),
  z.object({ h: z.enum(HOME_ACTIONS) }),
  // A question's suggested ticket, filed and started now or left for later.
  z.object({ t: z.uuid(), a: z.enum(['start', 'later']) }),
  // An issue filed from Slack: start it now, or leave it for later. Linear's issue ID.
  z.object({ s: z.uuid(), a: z.enum(['start', 'later']) }),
  z.object({
    d: z
      .array(z.string().regex(/^[A-Z][A-Z0-9]*-\d+$/))
      .min(1)
      .max(MAX_READY_ROWS)
  })
]);

export type ButtonValue = z.infer<typeof buttonValueSchema>;

export const button = (actionId: string, text: string, value: ButtonValue, primary = false): SlackBlock => ({
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
  docs: 'Docs check',
  ask: 'Question',
  size: 'Sizing'
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

// Slack holds 3,000 characters a section and 50 blocks a message; a gate needs two blocks besides its body.
const SECTION_LIMIT = 3000;
const MAX_BODY_SECTIONS = 45;

const gateSections = (gate: Gate): SlackBlock[] =>
  slackChunks(slackMarkdown(gate.body), SECTION_LIMIT)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
    .slice(0, MAX_BODY_SECTIONS)
    .map(section);

// A reported gate in the thread, such as slicing approval: its body, then a button per option, the first suggested.
export const slackGateMessage = (workItemId: string, gate: Gate, issueUrl: string): SlackMessage => ({
  text: 'Waiting for your answer.',
  blocks: [
    ...gateSections(gate),
    {
      type: 'actions',
      elements: gate.options.map((option, index) =>
        button(`gate_${index}`, option, { g: workItemId, a: option }, index === 0)
      )
    },
    context(`Reply in this thread to answer in your own words. Also in <${issueUrl}|Linear>.`)
  ]
});

// The gate once answered, wherever: its body stays for the record, the buttons go. `by` reads "by Milo" or "in Linear".
export const slackGateSettled = (gate: Gate, answer: string, by: string): SlackMessage => ({
  text: 'Answered.',
  blocks: [...gateSections(gate), context(`✓ ${escapeSlack(clip(oneLine(answer), 200))}, ${escapeSlack(by)}.`)]
});

const FINDING_BLOCK = /^finding_(\d+)$/;
// Slack holds 50 blocks a message: the heading, the findings, a note of any more and the buttons.
const MAX_FINDINGS_SHOWN = 40;
const FINDING_FIELD_LIMIT = 600;

const TIER_NAMES: Record<string, string> = {
  blocking: 'Blocking',
  should_fix: 'Should fix',
  nit: 'Nit',
  could_cut: 'Could cut'
};

export type FindingsPlace = { repository: string; branch: string | null };

const findingPlace = ({ path, line }: ReviewFinding, { repository, branch }: FindingsPlace): string => {
  if (!path) {
    return '';
  }
  const label = escapeSlack(`${path}${line ? `:${line}` : ''}`);
  // Review names things that aren't files too ("PR description"): those stay plain text.
  if (/\s/.test(path)) {
    return ` ${label}`;
  }
  return branch
    ? ` <https://github.com/${repository}/blob/${encodeURI(branch)}/${encodeURI(path)}${line ? `#L${line}` : ''}|${label}>`
    : ` \`${label}\``;
};

const findingText = (finding: ReviewFinding, place: FindingsPlace, note?: string): string =>
  [
    `*${TIER_NAMES[finding.tier ?? ''] ?? 'Finding'}*${findingPlace(finding, place)}`,
    escapeSlack(clip(oneLine(finding.summary), FINDING_FIELD_LIMIT)),
    finding.fix ? `_Fix:_ ${escapeSlack(clip(oneLine(finding.fix), FINDING_FIELD_LIMIT))}` : undefined,
    note
  ]
    .filter((part) => part !== undefined)
    .join('\n');

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

const moreFindings = (findings: ReviewFinding[]): SlackBlock[] =>
  findings.length > MAX_FINDINGS_SHOWN
    ? [context(`…and ${findings.length - MAX_FINDINGS_SHOWN} more in the PR’s review, fixed with the ticked ones.`)]
    : [];

const FIX_OPTION = { text: { type: 'plain_text', text: 'Fix' }, value: 'fix' };

// Review findings left for a person (Nits, Could cut, and any a revision round can't take): each with a Fix box,
// ticked to start, then Fix ticked or Approve and merge (`merge`, when the PR is ready to merge; Merge as it is, which
// only leaves them, otherwise). A revision round's own findings are listed without them.
export const slackFindingsMessage = (
  run: { id: string; round: number },
  findings: ReviewFinding[],
  place: FindingsPlace,
  choosable: boolean,
  merge?: SlackBlock
): SlackMessage => {
  const shown = findings.slice(0, MAX_FINDINGS_SHOWN);
  const heading = choosable
    ? `*Review round ${run.round}* left ${plural(findings.length, 'finding')} for you. Untick any to leave as they are.`
    : `*Review round ${run.round}* found ${plural(findings.length, 'thing')} to fix. The next round fixes them.`;
  return {
    text: choosable ? `Review left ${plural(findings.length, 'finding')} for you.` : 'Review found things to fix.',
    blocks: [
      section(heading),
      ...shown.map((finding, index) => ({
        type: 'section',
        block_id: `finding_${index}`,
        text: { type: 'mrkdwn', text: findingText(finding, place) },
        ...(choosable
          ? {
              accessory: {
                type: 'checkboxes',
                action_id: `tick_${index}`,
                options: [FIX_OPTION],
                initial_options: [FIX_OPTION]
              }
            }
          : {})
      })),
      ...moreFindings(findings),
      ...(choosable
        ? [
            {
              type: 'actions',
              elements: [
                button('findings_fix', 'Fix ticked', { f: run.id, a: 'fix' }, true),
                merge ?? button('findings_keep', 'Merge as it is', { f: run.id, a: 'keep' })
              ]
            }
          ]
        : [])
    ]
  };
};

// The findings once chosen: the list stays for the record, the boxes and buttons go. `fixing` is null when they were
// all left as they are.
export const slackFindingsSettled = (
  run: { round: number },
  findings: ReviewFinding[],
  place: FindingsPlace,
  fixing: number[] | null,
  by: string,
  // Fixed with the answers to the same round's questions, rather than chosen here.
  withAnswers = false
): SlackMessage => {
  const left = (index: number) => fixing === null || !fixing.includes(index);
  const outcome =
    fixing === null
      ? `✓ Left as they are, by ${escapeSlack(by)}. Ready for you to merge.`
      : withAnswers
        ? `✓ Fixing ${fixing.length === findings.length ? 'them' : `${fixing.length} of them`} in the same run as the answers above.`
        : `✓ Fixing ${fixing.length} of ${plural(findings.length, 'finding')}, chosen by ${escapeSlack(by)}.`;
  return {
    text: fixing === null ? 'Review findings left as they are.' : 'Fixing the chosen review findings.',
    blocks: [
      section(`*Review round ${run.round}* left ${plural(findings.length, 'finding')}.`),
      ...findings
        .slice(0, MAX_FINDINGS_SHOWN)
        .map((finding, index) =>
          section(findingText(finding, place, fixing !== null && left(index) ? '_Left as it is._' : undefined))
        ),
      context(outcome)
    ]
  };
};

// A thread message that waits on someone, with them mentioned first, so Slack notifies them: the bot starts each
// thread, so the person isn't in it unless they've replied. The notification shows `text`; the message, its first
// section.
export const mentioning = <M extends string | SlackMessage>(message: M, mention: string | undefined): M => {
  if (!mention) {
    return message;
  }
  if (typeof message === 'string') {
    return `${mention} ${message}` as M;
  }
  const { text: fallback, blocks } = message as SlackMessage;
  const first = blocks.findIndex((block) => block.type === 'section');
  return {
    ...(message as SlackMessage),
    text: `${mention} ${fallback}`,
    blocks: blocks.map((block, index) => {
      const text = block.text as { type?: unknown; text?: unknown } | undefined;
      return index === first && text?.type === 'mrkdwn' && typeof text.text === 'string'
        ? { ...block, text: { ...text, text: `${mention} ${text.text}` } }
        : block;
    })
  } as M;
};

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

export type SlackThreadReply = { channel: string; threadTs: string; ts: string; userId: string; body: string };

// A person's reply in a thread. Bots (the factory included), edits, joins and top-level messages are not replies.
export const parseSlackThreadReply = (payload: unknown): SlackThreadReply | undefined => {
  const event = messageEventSchema.safeParse(payload).data?.event;
  if (!event || event.subtype || event.bot_id || !event.thread_ts || event.thread_ts === event.ts) {
    return undefined;
  }
  const body = slackPlainText(event.text);
  return body
    ? { channel: event.channel, threadTs: event.thread_ts, ts: event.ts, userId: event.user, body }
    : undefined;
};

const actionPayloadSchema = z.looseObject({
  type: z.literal('block_actions'),
  user: z.looseObject({ id: z.string().min(1) }),
  channel: z.looseObject({ id: z.string().min(1) }).nullish(),
  message: z
    .looseObject({
      ts: z.string().min(1),
      thread_ts: z.string().nullish(),
      text: z.string().nullish(),
      blocks: z.array(z.record(z.string(), z.unknown())).nullish()
    })
    .nullish(),
  // A tap in the App Home has no response URL, only the view it sits in.
  response_url: z.url({ protocol: /^https$/ }).nullish(),
  view: z.looseObject({ type: z.string() }).nullish(),
  container: z.looseObject({ is_ephemeral: z.boolean().nullish() }).nullish(),
  actions: z.array(z.looseObject({ value: z.string().nullish(), action_ts: z.string().min(1) })).min(1),
  // Every stateful element in the message as it is now, such as the review findings' Fix boxes.
  state: z
    .looseObject({
      values: z.record(
        z.string(),
        z.record(z.string(), z.looseObject({ selected_options: z.array(z.unknown()).nullish() }))
      )
    })
    .nullish()
});

// The findings whose Fix box was cleared. A box Slack sends no state for is as it was drawn: ticked.
const untickedFindings = (state: z.infer<typeof actionPayloadSchema>['state']): number[] =>
  Object.entries(state?.values ?? {}).flatMap(([blockId, elements]) => {
    const index = FINDING_BLOCK.exec(blockId)?.[1];
    const cleared = Object.values(elements).some(({ selected_options }) => selected_options?.length === 0);
    return index !== undefined && cleared ? [Number(index)] : [];
  });

// The message a tapped button sits in, as Slack sends it back, so it can be redrawn without being rebuilt.
export type TappedMessage = { ts: string; text: string; blocks: SlackBlock[] };

export type SlackAction = {
  userId: string;
  channelId: string | null;
  responseUrl: string | null;
  actionTs: string;
  // Tapped in the App Home, which is redrawn for the tapper afterwards.
  fromHome: boolean;
  // Tapped in a message only the tapper sees (a slash command's reply). Slack doesn't send such a message back, so it
  // can only be redrawn through the response URL.
  ephemeral: boolean;
} & (
  | { kind: 'question'; questionId: string; body: string }
  | { kind: 'spec_gate'; workItemId: string; body: string }
  | { kind: 'gate'; workItemId: string; body: string }
  | { kind: 'delegate'; identifiers: string[]; message: TappedMessage | null }
  | { kind: 'rerun'; runId: string }
  | { kind: 'merge'; workItemId: string }
  // `unticked` are the findings whose Fix box was cleared, by their index in the review's report.
  | { kind: 'findings'; runId: string; choice: 'fix' | 'keep'; unticked: number[]; messageTs: string | null }
  | { kind: 'home'; action: HomeAction }
  | { kind: 'ask_ticket'; askId: string; choice: 'start' | 'later'; messageTs: string | null }
  // `threadTs` is the thread the tapped message sits in, which the work then belongs to.
  | { kind: 'filed'; issueId: string; choice: 'start' | 'later'; messageTs: string | null; threadTs: string | null }
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
    responseUrl: parsed.response_url ?? null,
    actionTs: action.action_ts,
    fromHome: parsed.view?.type === 'home',
    ephemeral: parsed.container?.is_ephemeral === true
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
  if ('h' in value) {
    return { ...base, kind: 'home', action: value.h };
  }
  if ('t' in value) {
    return { ...base, kind: 'ask_ticket', askId: value.t, choice: value.a, messageTs: parsed.message?.ts ?? null };
  }
  if ('s' in value) {
    const { message } = parsed;
    return {
      ...base,
      kind: 'filed',
      issueId: value.s,
      choice: value.a,
      messageTs: message?.ts ?? null,
      threadTs: message ? (message.thread_ts ?? message.ts) : null
    };
  }
  if ('r' in value) {
    return { ...base, kind: 'rerun', runId: value.r };
  }
  if ('m' in value) {
    return { ...base, kind: 'merge', workItemId: value.m };
  }
  if ('f' in value) {
    return {
      ...base,
      kind: 'findings',
      runId: value.f,
      choice: value.a,
      unticked: untickedFindings(parsed.state),
      messageTs: parsed.message?.ts ?? null
    };
  }
  if ('g' in value) {
    return { ...base, kind: 'gate', workItemId: value.g, body: value.a };
  }
  return 'q' in value
    ? { ...base, kind: 'question', questionId: value.q, body: value.a }
    : { ...base, kind: 'spec_gate', workItemId: value.w, body: value.a };
};

const homeOpenedSchema = z.looseObject({
  type: z.literal('event_callback'),
  event: z.looseObject({ type: z.literal('app_home_opened'), user: z.string().min(1), tab: z.string() })
});

// Who opened the app's Home tab; the Messages tab and anything else is undefined.
export const parseAppHomeOpened = (payload: unknown): { userId: string } | undefined => {
  const event = homeOpenedSchema.safeParse(payload).data?.event;
  return event?.tab === 'home' ? { userId: event.user } : undefined;
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

// `threadTs` is set for a mention inside a thread.
export type SlackMention = { channel: string; ts: string; threadTs: string | null; userId: string; request: string };

// A person's mention of the app. A top-level one asks for new work; inside a question's thread it asks for a ticket
// from the answer. Inside a work item's thread it's a reply to that work, which arrives as a `message` too and is
// acted on there. Bots don't start work.
export const parseSlackMention = (payload: unknown): SlackMention | undefined => {
  const event = mentionEventSchema.safeParse(payload).data?.event;
  if (!event || event.bot_id) {
    return undefined;
  }
  const threadTs = event.thread_ts && event.thread_ts !== event.ts ? event.thread_ts : null;
  return { channel: event.channel, ts: event.ts, threadTs, userId: event.user, request: slackPlainText(event.text) };
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

export type FiledIssue = { id: string; identifier: string; url: string };

const issueLink = ({ identifier, url }: FiledIssue): string => `<${url}|${escapeSlack(identifier)}>`;

// An issue filed from Slack, before anyone has said whether to start it. It's nobody's until someone starts it.
export const filedChoiceMessage = (issue: FiledIssue): SlackMessage => {
  const text = `Filed ${issueLink(issue)}. Start on it now, or leave it for later?`;
  return {
    text,
    blocks: [
      section(text),
      {
        type: 'actions',
        elements: [
          button('filed_start', 'Start now', { s: issue.id, a: 'start' }, true),
          button('filed_later', 'Leave for later', { s: issue.id, a: 'later' })
        ]
      }
    ]
  };
};

// Left for later: it says where the issue is, and keeps a button to start it from here. Unassigned, it shows in the
// Ready list once someone accepts it out of Triage.
export const filedForLaterMessage = (issue: FiledIssue, alias: string): SlackMessage => {
  const text = `Filed ${issueLink(issue)} for later. It’s in Linear, unassigned until someone starts it. Start it here when you’re ready, or delegate it to @${escapeSlack(alias)} in Linear.`;
  return {
    text,
    blocks: [
      section(text),
      {
        type: 'actions',
        elements: [button('filed_start', `Start ${issue.identifier}`, { s: issue.id, a: 'start' }, true)]
      }
    ]
  };
};

export const filedStartedMessage = (issue: FiledIssue): SlackMessage => {
  const text = slackFiledText(issue);
  return { text, blocks: [section(text)] };
};

export const alreadyStartedText = (identifier: string): string =>
  `${escapeSlack(identifier)} has already started, so nothing more was done.`;

export const filedIssueClosedText = (identifier: string): string =>
  `${escapeSlack(identifier)} is closed in Linear, so I haven’t started it. Reopen it there first.`;

export const emptyMentionText = (config: FactoryConfig): string =>
  `Mention me with what you’d like built, for example: @${config.alias} let visitors rate a recipe. Or @${config.alias} ready to see what’s ready to delegate.`;

// A mention asking what's ready rather than for new work: the one word, as typed, with any closing punctuation.
export const isReadyRequest = (request: string): boolean => /^ready[?!.]*$/i.test(request.trim());

// Unassigned issues with no size: none can be delegated until someone sets its estimate in Linear.
export const needsSizeText = (issues: ReadyIssue[]): string => {
  const shown = issues.slice(0, MAX_READY_ROWS);
  const more = issues.length - shown.length;
  return `Needs a size before it can be delegated: ${shown
    .map(({ identifier, url }) => `<${url}|${escapeSlack(identifier)}>`)
    .join(', ')}${more > 0 ? ` and ${more} more` : ''}. Set an estimate in Linear.`;
};

export const nothingReadyText = (consoleUrl: string, needsSize: ReadyIssue[] = []): string =>
  `Nothing is ready to delegate. The <${consoleUrl}/inbox|Inbox> shows what’s waiting on what.${
    needsSize.length > 0 ? `\n${needsSizeText(needsSize)}` : ''
  }`;

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

const readyRowText = (issue: ReadyIssue, prefix: string): string =>
  `<${issue.url}|${escapeSlack(issue.identifier)}> ${escapeSlack(issue.title)} · ${issueMetaText(issue, prefix)}`;

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
  {
    alias,
    consoleUrl,
    emojiPrefix,
    needsSize = []
  }: { alias: string; consoleUrl: string; emojiPrefix: string; needsSize?: ReadyIssue[] }
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
        text: { type: 'mrkdwn', text: readyRowText(issue, emojiPrefix) },
        accessory: button('delegate', 'Delegate', { d: [issue.identifier] })
      })),
      ...(shown.length > 1 ? [delegateAllBlock(shown.map(({ identifier }) => identifier))] : []),
      ...(needsSize.length > 0 ? [context(needsSizeText(needsSize))] : []),
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
