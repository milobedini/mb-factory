import { z } from 'zod';

import { sizeLabel } from './dashboard';
import type { Gate } from './gates';
import type { HoldReason } from './governor';
import type { InboxEntry, InboxQuestion, InboxRun } from './inbox';
import { inboxEntry } from './inbox';
import { mergeButton } from './merge';
import { queuedThought } from './router';
import type { RunTrigger } from './runs';
import { formatRunTime, isOpenRun, runTotals } from './runs';
import type { SlackBlock, SlackMessage } from './slack';
import {
  button,
  escapeSlack,
  issueMetaText,
  projectText,
  SPEC_APPROVE,
  SPEC_CHANGE,
  sizeText,
  slackEmoji,
  specUrl
} from './slack';
import type { AgentRole, Stage } from './stages';

// A work item's thread starts with a card, edited in place as the work moves: a title, then a coloured attachment with
// the stage track, what's happening now, the size and project, and a button when there's something to do from it.

export type CardStatus = 'queued' | 'running' | 'waiting' | 'blocked' | 'ready' | 'merged' | 'canceled';

type StepState = 'done' | 'running' | 'queued' | 'waiting' | 'blocked' | 'todo' | 'skipped' | 'canceled';

export type CardRun = InboxRun & {
  id: string;
  trigger: RunTrigger;
  summary: string | null;
  costUsd: number | null;
  durationMs: number | null;
  dispatchedAt: Date | null;
  startedAt: Date | null;
  actionsRunUrl: string | null;
};

// An issue the work item's finishing made ready, offered on its card; settled once someone delegates it or it isn't
// ready any more. Kept on the work item as JSON, so this is also how it's read back.
const nextIssueSchema = z.object({
  identifier: z.string().min(1),
  title: z.string(),
  url: z.string().min(1),
  size: z.string(),
  // Where it sits in Linear; left out of what cards stored before 27 Oct.
  project: z.string().nullish(),
  projectUrl: z.string().nullish(),
  milestone: z.string().nullish(),
  delegatedBy: z.string().nullish(),
  delegatedAt: z.iso.datetime().nullish(),
  notReady: z.boolean().nullish()
});

export type NextIssue = z.infer<typeof nextIssueSchema>;

export const readNextIssues = (json: unknown): NextIssue[] =>
  z
    .array(nextIssueSchema)
    .catch([])
    .parse(json ?? []);

export type CardInput = {
  workItem: {
    id: string;
    identifier: string;
    url: string;
    title: string | null;
    stage: Stage;
    repository: string;
    branch: string | null;
    prNumber: number | null;
    estimate: number | null;
    reviewRounds: number;
    // When the work item last changed stage: a merged or canceled card says when.
    updatedAt: Date;
    project: { name: string; url: string | null } | null;
    milestone: string | null;
    // Who it's for: the Linear assignee's name, when the project lists them.
    assignee: string | null;
  };
  // Oldest first.
  runs: CardRun[];
  // The latest round of questions.
  round: InboxQuestion[];
  // Why the open run is queued, while the governor holds it.
  hold: { reason: HoldReason; releaseAt: Date | null } | null;
  // A gate a stage reported, while it waits for an answer.
  gate: Gate | undefined;
  // Whether the latest run can be re-run, as Re-run in the console decides.
  rerunnable: boolean;
  // The question card in the thread, while questions wait.
  questionsUrl: string | null;
  // What the review the PR waits on says to check before merging, and what merging sets off (the project's
  // `mergeEffect`), for Approve and merge's confirm.
  beforeMerging?: string;
  mergeEffect?: string;
  next: NextIssue[];
  now: Date;
  timeZone: string;
  // The workspace's custom emoji are named `<prefix>-done`, `<prefix>-size-m`, and so on.
  emojiPrefix: string;
};

export type SlackCard = SlackMessage & { attachments: { color: string; blocks: SlackBlock[] }[] };

export const CARD_COLOURS: Record<CardStatus, string> = {
  running: '#1d9bd1',
  queued: '#9a9da3',
  waiting: '#ecb22e',
  blocked: '#e01e5a',
  ready: '#2eb67d',
  merged: '#6b6f76',
  canceled: '#6b6f76'
};

export const STATUS_EMOJI: Record<CardStatus, string> = {
  running: 'running',
  queued: 'queued',
  waiting: 'needs-you',
  blocked: 'blocked',
  ready: 'done',
  merged: 'merged',
  canceled: 'canceled'
};

const STEP_EMOJI: Record<StepState, string> = {
  done: 'done',
  running: 'running',
  queued: 'queued',
  waiting: 'needs-you',
  blocked: 'blocked',
  todo: 'todo',
  skipped: 'skipped',
  canceled: 'canceled'
};

const STATUS_WORDS: Record<CardStatus, string> = {
  running: 'running',
  queued: 'queued',
  waiting: 'waiting on you',
  blocked: 'blocked',
  ready: 'ready to merge',
  merged: 'merged',
  canceled: 'canceled'
};

const STEPS: { name: string; agent: AgentRole | null }[] = [
  { name: 'Triage', agent: 'triage' },
  { name: 'Spec', agent: 'spec' },
  { name: 'Implement', agent: 'implement' },
  { name: 'Verify', agent: 'verify' },
  { name: 'Review', agent: 'review' },
  { name: 'Merge', agent: null }
];

const MERGE_STEP = STEPS.length - 1;

// Where each stage sits on the track when no run says otherwise; a settled work item is past the end.
const STAGE_STEP: Record<Stage, number> = {
  researching: 0,
  spec: 1,
  spec_review: 1,
  building: 2,
  in_review: 4,
  awaiting_merge: MERGE_STEP,
  done: STEPS.length,
  canceled: 0
};

const stepOf = (agent: AgentRole): number => {
  const index = STEPS.findIndex((step) => step.agent === agent);
  return index === -1 ? 0 : index;
};

// The run the card follows: one already going, ahead of any queued behind it (a second reply while it runs); otherwise
// the latest.
const currentRun = (runs: CardRun[]): CardRun | undefined =>
  runs.findLast((run) => run.status === 'dispatched' || run.status === 'running') ?? runs.at(-1);

// The run that's waiting on a person, or still going, decides the step; otherwise the stage does.
const RUN_DECIDES: InboxEntry['kind'][] = ['questions', 'run_ended', 'reply_needed'];

export const cardStatus = (
  stage: Stage,
  latest: CardRun | undefined,
  entry: InboxEntry | undefined,
  held: boolean
): CardStatus => {
  if (stage === 'canceled' || stage === 'done') {
    return stage === 'done' ? 'merged' : 'canceled';
  }
  if (latest && isOpenRun(latest.status)) {
    return latest.status === 'queued' && held ? 'queued' : 'running';
  }
  if (!entry) {
    return 'running';
  }
  return entry.kind === 'run_ended' ? 'blocked' : entry.kind === 'awaiting_merge' ? 'ready' : 'waiting';
};

const CURRENT_STEP: Record<CardStatus, StepState> = {
  running: 'running',
  queued: 'queued',
  waiting: 'waiting',
  ready: 'waiting',
  blocked: 'blocked',
  merged: 'done',
  canceled: 'canceled'
};

const trackSteps = (
  stage: Stage,
  runs: CardRun[],
  entry: InboxEntry | undefined,
  status: CardStatus
): { name: string; state: StepState; current: boolean }[] => {
  const latest = currentRun(runs);
  const runDecides =
    latest !== undefined &&
    (stage === 'canceled' || isOpenRun(latest.status) || (entry !== undefined && RUN_DECIDES.includes(entry.kind)));
  const current = runDecides ? stepOf(latest.agent) : STAGE_STEP[stage];
  const ran = (agent: AgentRole | null): boolean => agent === null || runs.some((run) => run.agent === agent);
  return STEPS.map(({ name, agent }, index) => {
    if (index < current) {
      return { name, state: ran(agent) ? 'done' : 'skipped', current: false };
    }
    if (index > current) {
      return { name, state: status === 'canceled' ? 'canceled' : 'todo', current: false };
    }
    return { name, state: CURRENT_STEP[status], current: true };
  });
};

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

const clip = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

const MAX_SUMMARY = 300;

const summaryOf = (run: CardRun | undefined): string =>
  run?.summary ? ` ${escapeSlack(clip(oneLine(run.summary), MAX_SUMMARY))}` : '';

const clock = (at: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);

// Slack shows the reader "started 4 minutes ago" and keeps it current, so the card needn't be edited to stay right.
const startedAgo = (at: Date, timeZone: string): string =>
  `<!date^${Math.floor(at.getTime() / 1000)}^started {ago}|started at ${clock(at, timeZone)}>`;

const RUNNING: Record<AgentRole, string> = {
  triage: 'Triaging',
  spec: 'Writing the spec',
  implement: 'Implementing',
  verify: 'Checking it on screen',
  review: 'Reviewing',
  security: 'Checking security',
  docs: 'Checking the docs',
  ask: 'Looking into it',
  size: 'Sizing'
};

const IMPLEMENTING_BECAUSE: Partial<Record<RunTrigger, string>> = {
  review_findings: 'Fixing the review findings',
  ci_failed: 'Fixing the failed CI run',
  conflict: 'Resolving a merge conflict'
};

const runningText = (run: CardRun, { prNumber, reviewRounds }: CardInput['workItem'], timeZone: string): string => {
  const doing =
    run.agent === 'implement'
      ? (IMPLEMENTING_BECAUSE[run.trigger] ?? RUNNING.implement)
      : run.agent === 'review' && prNumber
        ? `Reviewing PR #${prNumber}${reviewRounds > 0 ? `, round ${reviewRounds + 1}` : ''}`
        : RUNNING[run.agent];
  return `*${doing}* · ${startedAgo(run.startedAt ?? run.dispatchedAt ?? run.createdAt, timeZone)}`;
};

// A gate's body is markdown; its first line says what's being asked.
const gateLine = (gate: Gate): string => {
  const first = gate.body
    .split('\n')
    .map((line) => line.replace(/^[\s#>*-]+/, '').replace(/\*\*/g, ''))
    .find((line) => line.trim().length > 0);
  return escapeSlack(clip(oneLine(first ?? 'answer the question in the thread.'), 150));
};

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

const waitingText = (input: CardInput, entry: InboxEntry | undefined, latest: CardRun | undefined): string => {
  if (entry?.kind === 'questions') {
    const from = latest ? ` from ${latest.agent}` : '';
    const answered = entry.answered > 0 ? ` (${entry.answered} answered)` : '';
    return `*Waiting on you:* ${plural(entry.open, 'question')}${from}${answered}.`;
  }
  if (input.workItem.stage === 'spec_review') {
    return '*Waiting on you:* approve the spec.';
  }
  return input.gate
    ? `*Waiting on you:* ${gateLine(input.gate)}`
    : `*Waiting on you:* reply in the thread.${summaryOf(latest)}`;
};

// When review accepted the PR the merge gate waits on.
const acceptedText = ({ workItem, runs, timeZone }: CardInput): string => {
  const review = runs.findLast(({ agent, status }) => agent === 'review' && status === 'finished');
  const at = review?.finishedAt ? ` at ${clock(review.finishedAt, timeZone)}` : '';
  return `review accepted PR #${workItem.prNumber ?? '?'}${at}.`;
};

const statusText = (input: CardInput, status: CardStatus, entry: InboxEntry | undefined): string => {
  const { workItem, now, timeZone } = input;
  const latest = currentRun(input.runs);
  const pr = workItem.prNumber ? ` · PR #${workItem.prNumber}` : '';
  switch (status) {
    case 'queued':
      // "Queued until 14:00: usage … is high", with the first word bold like the other states.
      return input.hold ? `*Queued*${queuedThought(input.hold, now, timeZone).slice('Queued'.length)}` : '*Queued*';
    case 'running':
      return latest ? runningText(latest, workItem, timeZone) : '*Starting*';
    case 'waiting':
      return waitingText(input, entry, latest);
    case 'blocked':
      return latest?.outcome === 'blocked'
        ? `*Blocked:*${summaryOf(latest) || ' see the thread.'}`
        : `*The ${latest?.agent ?? 'last'} run failed.*${summaryOf(latest)}`;
    case 'ready':
      return `*Ready to merge:* ${acceptedText(input)}`;
    case 'merged':
      return `*Merged* at ${clock(workItem.updatedAt, timeZone)}${pr}`;
    case 'canceled':
      return `*Canceled* at ${clock(workItem.updatedAt, timeZone)}${workItem.prNumber ? `${pr} closed` : ''}`;
  }
};

const metaText = (input: CardInput): string | undefined => {
  const { workItem, runs } = input;
  const { project, milestone } = workItem;
  const totals = runTotals(runs);
  const parts = [
    sizeText(sizeLabel(workItem.estimate), input.emojiPrefix),
    projectText(project, milestone),
    workItem.assignee ? escapeSlack(workItem.assignee) : undefined,
    totals.runs > 0 ? plural(totals.runs, 'run') : undefined,
    totals.durationMs > 0 ? formatRunTime(totals.durationMs) : undefined,
    totals.costUsd !== null ? `$${totals.costUsd.toFixed(2)}` : undefined
  ].filter((part) => part !== undefined);
  return parts.length > 0 ? parts.join(' · ') : undefined;
};

export const linkButton = (actionId: string, text: string, url: string, primary = false): SlackBlock => ({
  type: 'button',
  action_id: actionId,
  text: { type: 'plain_text', text },
  url,
  ...(primary ? { style: 'primary' } : {})
});

const cardButtons = (input: CardInput, status: CardStatus, entry: InboxEntry | undefined): SlackBlock[] => {
  const { workItem } = input;
  const latest = currentRun(input.runs);
  const prUrl = workItem.prNumber ? `https://github.com/${workItem.repository}/pull/${workItem.prNumber}` : null;
  const runLog = latest?.actionsRunUrl ? [linkButton('run_log', 'Run log', latest.actionsRunUrl)] : [];
  if (status === 'waiting' && entry?.kind === 'questions') {
    return input.questionsUrl ? [linkButton('questions_open', 'Answer in the thread', input.questionsUrl, true)] : [];
  }
  if (status === 'waiting' && workItem.stage === 'spec_review') {
    const spec = specUrl({ ...workItem, issueIdentifier: workItem.identifier });
    return [
      button('spec_approve', SPEC_APPROVE, { w: workItem.id, a: SPEC_APPROVE }, true),
      button('spec_change', SPEC_CHANGE, { w: workItem.id, a: SPEC_CHANGE }),
      ...(spec ? [linkButton('spec_open', 'Read the spec', spec)] : [])
    ];
  }
  if (status === 'waiting' && input.gate) {
    return input.gate.options.map((option, index) =>
      button(`gate_${index}`, option, { g: workItem.id, a: option }, index === 0)
    );
  }
  if (status === 'blocked') {
    return [...(input.rerunnable && latest ? [button('rerun', 'Re-run', { r: latest.id }, true)] : []), ...runLog];
  }
  if (status === 'ready') {
    return prUrl && workItem.prNumber
      ? [
          mergeButton(workItem.id, workItem.prNumber, {
            beforeMerging: input.beforeMerging,
            mergeEffect: input.mergeEffect
          }),
          linkButton('pr_open', `Open PR #${workItem.prNumber}`, prUrl)
        ]
      : [];
  }
  if (status === 'running' || status === 'queued') {
    return [...(prUrl ? [linkButton('pr_open', `PR #${workItem.prNumber}`, prUrl)] : []), ...runLog];
  }
  return [];
};

const section = (text: string): SlackBlock => ({ type: 'section', text: { type: 'mrkdwn', text } });

const context = (text: string): SlackBlock => ({ type: 'context', elements: [{ type: 'mrkdwn', text }] });

const nextBlock = (issue: NextIssue, { timeZone, emojiPrefix }: CardInput): SlackBlock => {
  const row = `<${issue.url}|${escapeSlack(issue.identifier)}> ${escapeSlack(issue.title)} · ${issueMetaText(issue, emojiPrefix)}`;
  if (issue.delegatedBy) {
    const at = issue.delegatedAt ? `, ${clock(new Date(issue.delegatedAt), timeZone)}` : '';
    return context(`✓ Next: ${row} · delegated by ${escapeSlack(issue.delegatedBy)}${at}`);
  }
  if (issue.notReady) {
    return context(`Next: ~${row}~ · no longer ready`);
  }
  return {
    ...section(`*Next:* ${row} · ready to delegate`),
    accessory: button('delegate', `Delegate ${issue.identifier}`, { d: [issue.identifier] }, true)
  };
};

export type CardSummary = { status: CardStatus; entry: InboxEntry | undefined; line: string; buttons: SlackBlock[] };

// What a work item's card says about it now, for the card and for the App Home's rows.
export const cardSummary = (input: CardInput): CardSummary => {
  const { workItem, runs, round } = input;
  const entry = inboxEntry(workItem, runs, round);
  const status = cardStatus(workItem.stage, currentRun(runs), entry, input.hold !== null);
  return { status, entry, line: statusText(input, status, entry), buttons: cardButtons(input, status, entry) };
};

export const workItemCard = (input: CardInput): SlackCard => {
  const { workItem, runs, emojiPrefix } = input;
  const { status, entry, line, buttons } = cardSummary(input);
  const track = trackSteps(workItem.stage, runs, entry, status)
    .map(
      ({ name, state, current }) =>
        `${slackEmoji(emojiPrefix, STEP_EMOJI[state])} ${current ? `*${name}*` : state === 'skipped' ? `~${name}~` : name}`
    )
    .join('   ');
  const meta = metaText(input);
  const title = workItem.title ? ` ${escapeSlack(workItem.title)}` : '';
  return {
    text: `${escapeSlack(workItem.identifier)}${title}: ${STATUS_WORDS[status]}`,
    blocks: [section(`*<${workItem.url}|${escapeSlack(workItem.identifier)}>${title}*`)],
    attachments: [
      {
        color: CARD_COLOURS[status],
        blocks: [
          context(track),
          section(`${slackEmoji(emojiPrefix, STATUS_EMOJI[status])} ${line}`),
          ...input.next.map((issue) => nextBlock(issue, input)),
          ...(meta ? [context(meta)] : []),
          ...(buttons.length > 0 ? [{ type: 'actions', elements: buttons }] : [])
        ]
      }
    ]
  };
};
