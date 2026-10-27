export const STAGES = [
  'researching',
  'spec',
  'spec_review',
  'building',
  'in_review',
  'awaiting_merge',
  'done',
  'canceled'
] as const;

export type Stage = (typeof STAGES)[number];

// `security` and `docs` run as scheduled jobs, and `ask` answers a question from Slack: none of them on a work item.
export const AGENT_ROLES = ['triage', 'spec', 'implement', 'verify', 'review', 'security', 'docs', 'ask'] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export const JOB_AGENTS = ['security', 'docs'] as const satisfies AgentRole[];

export type JobAgent = (typeof JOB_AGENTS)[number];

export type StageEvent =
  | { type: 'triaged'; needsSpec: boolean }
  | { type: 'spec_written' }
  | { type: 'spec_approved' }
  | { type: 'spec_changes_requested' }
  | { type: 'pr_opened' }
  | { type: 'reviewed'; verdict: 'accepted' | 'revision_needed' | 'human_decision_needed' }
  | { type: 'merged' }
  | { type: 'closed_unmerged' }
  | { type: 'canceled' };

export type StageContext = {
  reviewRounds: number;
  maxReviewRounds: number;
};

export type Transition = { ok: true; stage: Stage } | { ok: false; error: string };

export const AGENT_FOR_STAGE: Partial<Record<Stage, AgentRole>> = {
  researching: 'triage',
  spec: 'spec',
  building: 'implement',
  in_review: 'review'
};

export const HUMAN_GATES: Stage[] = ['spec_review', 'awaiting_merge'];

const to = (stage: Stage): Transition => ({ ok: true, stage });

type Handler = (event: StageEvent, context: StageContext) => Transition | undefined;

const HANDLERS: Record<Stage, Handler> = {
  researching: (event) => (event.type === 'triaged' ? to(event.needsSpec ? 'spec' : 'building') : undefined),
  spec: (event) => (event.type === 'spec_written' ? to('spec_review') : undefined),
  spec_review: (event) =>
    event.type === 'spec_approved' ? to('building') : event.type === 'spec_changes_requested' ? to('spec') : undefined,
  building: (event) => (event.type === 'pr_opened' ? to('in_review') : undefined),
  in_review: (event, { reviewRounds, maxReviewRounds }) => {
    if (event.type !== 'reviewed') {
      return undefined;
    }
    const canRevise = event.verdict === 'revision_needed' && reviewRounds < maxReviewRounds;
    return to(canRevise ? 'building' : 'awaiting_merge');
  },
  awaiting_merge: () => undefined,
  done: () => undefined,
  canceled: () => undefined
};

export const TERMINAL_STAGES: Stage[] = ['done', 'canceled'];

// What happens to the PR or the issue settles the work item, whatever stage the factory had reached.
const SETTLING_EVENTS: Partial<Record<StageEvent['type'], Stage>> = {
  merged: 'done',
  closed_unmerged: 'canceled',
  canceled: 'canceled'
};

export const transition = (stage: Stage, event: StageEvent, context: StageContext): Transition => {
  const settled = SETTLING_EVENTS[event.type];
  if (settled && !TERMINAL_STAGES.includes(stage)) {
    return to(settled);
  }
  return HANDLERS[stage](event, context) ?? { ok: false, error: `Event ${event.type} is not valid in stage ${stage}` };
};
