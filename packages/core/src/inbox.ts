import type { RunOutcome, RunStatus } from './runs';
import { isOpenRun } from './runs';
import type { AgentRole, Stage } from './stages';
import { TERMINAL_STAGES } from './stages';

// What a work item is waiting on a person for. Each waits on one thing at a time.
export const INBOX_KINDS = [
  'questions',
  'spec_review',
  'design_review',
  'awaiting_merge',
  'run_ended',
  'reply_needed'
] as const;

export type InboxKind = (typeof INBOX_KINDS)[number];

export type InboxRun = {
  agent: AgentRole;
  status: RunStatus;
  outcome: RunOutcome | null;
  createdAt: Date;
  finishedAt: Date | null;
};

export type InboxQuestion = { answeredAt: Date | null; closedAt: Date | null; askedAt: Date | null; createdAt: Date };

export type InboxEntry =
  | { kind: 'questions'; since: Date; open: number; answered: number }
  | { kind: Exclude<InboxKind, 'questions'>; since: Date; agent: AgentRole | null };

const ENDED_BADLY: (RunOutcome | null)[] = ['failed', 'blocked'];
// A stopped or declined run is settled by whoever stopped or declined it.
const WAITING_FOR_A_REPLY: (RunOutcome | null)[] = ['needs_input', 'done'];

const earliest = (dates: Date[]): Date | undefined =>
  dates.reduce<Date | undefined>((first, date) => (first && first <= date ? first : date), undefined);

// `runs` oldest first; `round` is the latest question round. Nothing waits while the factory is working on it, or once
// it's settled. The time is when it started waiting: when the run before it finished, or the first question was asked.
export const inboxEntry = (
  workItem: { stage: Stage; updatedAt: Date },
  runs: InboxRun[],
  round: InboxQuestion[]
): InboxEntry | undefined => {
  if (TERMINAL_STAGES.includes(workItem.stage) || runs.some(({ status }) => isOpenRun(status))) {
    return undefined;
  }
  const latest = runs.at(-1);
  const since = latest?.finishedAt ?? workItem.updatedAt;
  const agent = latest?.agent ?? null;
  const open = round.filter(({ answeredAt, closedAt }) => answeredAt === null && closedAt === null);
  if (open.length > 0) {
    return {
      kind: 'questions',
      since: earliest(round.map(({ askedAt, createdAt }) => askedAt ?? createdAt)) ?? since,
      open: open.length,
      answered: round.filter(({ answeredAt }) => answeredAt !== null).length
    };
  }
  if (workItem.stage === 'spec_review' || workItem.stage === 'design_review' || workItem.stage === 'awaiting_merge') {
    return { kind: workItem.stage, since, agent };
  }
  if (latest?.status === 'finished' && ENDED_BADLY.includes(latest.outcome)) {
    return { kind: 'run_ended', since, agent };
  }
  // A run that asked in its own words, or one that finished with nothing to follow (triage's `next: human`).
  return latest?.status === 'finished' && WAITING_FOR_A_REPLY.includes(latest.outcome)
    ? { kind: 'reply_needed', since, agent }
    : undefined;
};

export type ChecksState = 'passing' | 'failing' | 'pending' | 'none';

const FAILING_CONCLUSIONS = ['failure', 'timed_out', 'action_required', 'startup_failure'];

// GitHub's check runs on a PR's head: any failure fails it; otherwise anything unfinished keeps it pending.
export const checksState = (checkRuns: { status: string; conclusion: string | null }[]): ChecksState => {
  if (checkRuns.length === 0) {
    return 'none';
  }
  if (checkRuns.some(({ conclusion }) => FAILING_CONCLUSIONS.includes(conclusion ?? ''))) {
    return 'failing';
  }
  return checkRuns.some(({ status }) => status !== 'completed') ? 'pending' : 'passing';
};
