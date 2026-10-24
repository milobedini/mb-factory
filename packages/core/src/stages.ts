export type Stage =
  'researching' | 'spec' | 'spec_review' | 'building' | 'in_review' | 'awaiting_merge' | 'done' | 'canceled';

export type AgentRole = 'triage' | 'spec' | 'implement' | 'review';

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
  awaiting_merge: (event) =>
    event.type === 'merged' ? to('done') : event.type === 'closed_unmerged' ? to('canceled') : undefined,
  done: () => undefined,
  canceled: () => undefined
};

const TERMINAL: Stage[] = ['done', 'canceled'];

export const transition = (stage: Stage, event: StageEvent, context: StageContext): Transition => {
  if (event.type === 'canceled' && !TERMINAL.includes(stage)) {
    return to('canceled');
  }
  return HANDLERS[stage](event, context) ?? { ok: false, error: `Event ${event.type} is not valid in stage ${stage}` };
};
