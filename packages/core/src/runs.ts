// `dependabot`: a Dependabot PR the factory took on because it needed work.
export const WORK_ORIGINS = ['linear', 'slack', 'dependabot'] as const;

export type WorkOrigin = (typeof WORK_ORIGINS)[number];

export const RUN_TRIGGERS = [
  'delegated',
  'prompted',
  'review_findings',
  'ci_failed',
  'conflict',
  'spec_approved',
  'delivered',
  'rerun',
  'console',
  'answered',
  'scheduled'
] as const;

export type RunTrigger = (typeof RUN_TRIGGERS)[number];

// Lifecycle of the run itself; `outcome` is what the stage reported once it finished.
export const RUN_STATUSES = ['queued', 'dispatched', 'running', 'finished', 'limit_hit', 'canceled'] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_OUTCOMES = ['done', 'needs_input', 'blocked', 'failed', 'declined', 'stopped'] as const;

export type RunOutcome = (typeof RUN_OUTCOMES)[number];

export const OPEN_RUN_STATUSES: RunStatus[] = ['queued', 'dispatched', 'running'];

export const isOpenRun = (status: RunStatus): boolean => OPEN_RUN_STATUSES.includes(status);

type TimedRun = {
  createdAt: Date;
  dispatchedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
};

// How long a run waited before it was dispatched, and how long it ran; open spans are measured to `now`.
export const runTiming = (
  { createdAt, dispatchedAt, startedAt, finishedAt }: TimedRun,
  now: Date
): { waitedMs: number; ranMs: number | null } => ({
  waitedMs: (dispatchedAt ?? finishedAt ?? now).getTime() - createdAt.getTime(),
  ranMs: startedAt ? (finishedAt ?? now).getTime() - startedAt.getTime() : null
});

export type RunTotals = { runs: number; costUsd: number | null; durationMs: number };

// API-equivalent cost stays null until some run reports one, so "no data" doesn't read as free.
export const runTotals = (runs: { costUsd: number | null; durationMs: number | null }[]): RunTotals => {
  const costs = runs.map(({ costUsd }) => costUsd).filter((cost) => cost !== null);
  return {
    runs: runs.length,
    costUsd: costs.length > 0 ? costs.reduce((sum, cost) => sum + cost, 0) : null,
    durationMs: runs.reduce((sum, { durationMs }) => sum + (durationMs ?? 0), 0)
  };
};

// Run lengths are seconds to minutes, so they read to the second: "34 s", "2 min 5 s", "1 h 3 min".
export const formatRunTime = (ms: number): string => {
  const seconds = Math.round(Math.max(ms, 0) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return [`${hours} h`, minutes ? `${minutes} min` : ''].filter(Boolean).join(' ');
  }
  return minutes > 0 ? [`${minutes} min`, rest ? `${rest} s` : ''].filter(Boolean).join(' ') : `${rest} s`;
};
