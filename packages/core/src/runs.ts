export const WORK_ORIGINS = ['linear', 'slack'] as const;

export type WorkOrigin = (typeof WORK_ORIGINS)[number];

export const RUN_TRIGGERS = [
  'delegated',
  'prompted',
  'review_findings',
  'ci_failed',
  'spec_approved',
  'rerun'
] as const;

export type RunTrigger = (typeof RUN_TRIGGERS)[number];

// Lifecycle of the run itself; `outcome` is what the stage reported once it finished.
export const RUN_STATUSES = ['queued', 'dispatched', 'running', 'finished', 'limit_hit', 'canceled'] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_OUTCOMES = ['done', 'needs_input', 'blocked', 'failed', 'declined', 'stopped'] as const;

export type RunOutcome = (typeof RUN_OUTCOMES)[number];
