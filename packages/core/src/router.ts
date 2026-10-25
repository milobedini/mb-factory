import { z } from 'zod';

import type { FactoryConfig } from './config';
import type { Decision, DispatchRequest, HoldReason, Priority, UsageWindow } from './governor';
import { decideDispatch, PRIORITIES } from './governor';
import type { RunOutcome, RunStatus, RunTrigger } from './runs';
import type { AgentRole, Stage } from './stages';
import { AGENT_FOR_STAGE, STAGES } from './stages';

// Linear's AgentSessionEvent webhook: only the fields the router reads.
const sessionEventSchema = z.looseObject({
  type: z.literal('AgentSessionEvent'),
  action: z.string(),
  organizationId: z.string().min(1),
  agentSession: z.looseObject({
    id: z.string().min(1),
    issue: z
      .looseObject({
        id: z.string().min(1),
        identifier: z.string().min(1),
        url: z.url({ protocol: /^https$/ }),
        title: z.string().nullish(),
        team: z.looseObject({ key: z.string().min(1) })
      })
      .nullish(),
    creator: z.looseObject({ name: z.string().nullish() }).nullish()
  }),
  agentActivity: z
    .looseObject({
      signal: z.string().nullish(),
      body: z.string().nullish(),
      content: z.looseObject({ body: z.string().nullish() }).nullish()
    })
    .nullish()
});

export type SessionIssue = {
  id: string;
  identifier: string;
  url: string;
  title: string | null;
  teamKey: string;
};

export type SessionEvent =
  | { kind: 'created'; organizationId: string; sessionId: string; issue: SessionIssue; requester: string | null }
  | { kind: 'prompted'; organizationId: string; sessionId: string; body: string }
  | { kind: 'stop'; organizationId: string; sessionId: string };

// Returns undefined for anything the router doesn't act on, such as a session with no issue.
export const parseSessionEvent = (payload: unknown): SessionEvent | undefined => {
  const parsed = sessionEventSchema.safeParse(payload);
  if (!parsed.success) {
    return undefined;
  }
  const { action, organizationId, agentSession, agentActivity } = parsed.data;
  const base = { organizationId, sessionId: agentSession.id };
  if (action === 'created' && agentSession.issue) {
    const { id, identifier, url, title, team } = agentSession.issue;
    return {
      kind: 'created',
      ...base,
      issue: { id, identifier, url, title: title ?? null, teamKey: team.key },
      requester: agentSession.creator?.name ?? null
    };
  }
  if (action !== 'prompted') {
    return undefined;
  }
  if (agentActivity?.signal === 'stop') {
    return { kind: 'stop', ...base };
  }
  const body = (agentActivity?.content?.body ?? agentActivity?.body ?? '').trim();
  return body ? { kind: 'prompted', ...base, body } : undefined;
};

export type RunRequest = {
  agent: AgentRole;
  trigger: RunTrigger;
  priority: Priority;
  prompt: string | null;
};

// Phase 1 has no triage: delegation goes straight to implement, and a reply re-runs it with the reply as the prompt.
export const runRequestFor = (event: Exclude<SessionEvent, { kind: 'stop' }>): RunRequest =>
  event.kind === 'created'
    ? { agent: 'implement', trigger: 'delegated', priority: 'feature', prompt: null }
    : { agent: 'implement', trigger: 'prompted', priority: 'in_flight', prompt: event.body };

// A run cut short by the usage limit resumes ahead of new work once the window allows it.
export const resumeRequestFor = (agent: AgentRole): RunRequest => ({
  agent,
  trigger: 'rerun',
  priority: 'in_flight',
  prompt: null
});

export type GovernedDecision = Exclude<Decision, { kind: 'probe' }>;

export type Governed = { decision: GovernedDecision; staleWindows: UsageWindow[] };

// Until the scheduled probe exists, stale readings don't block work: every run records fresh ones.
export const governDispatch = ({
  workItemBusy,
  ...request
}: Omit<DispatchRequest, 'acceptStale'> & { workItemBusy: boolean }): Governed => {
  const first = decideDispatch(request);
  const staleWindows = first.kind === 'probe' ? first.stale : [];
  const decision = first.kind === 'probe' ? decideDispatch({ ...request, acceptStale: true }) : first;
  if (decision.kind === 'probe') {
    throw new Error('The governor asked for a probe after accepting stale readings');
  }
  if (decision.kind === 'dispatch' && workItemBusy) {
    return { decision: { kind: 'hold', state: decision.state, reason: 'work_item_busy' }, staleWindows };
  }
  return { decision, staleWindows };
};

export type ModelledAgent = keyof FactoryConfig['models'];

const isModelled = (agent: AgentRole): agent is ModelledAgent => agent !== 'verify';

export const modelFor = (config: FactoryConfig, agent: AgentRole, downshift: boolean): string => {
  if (!isModelled(agent)) {
    throw new Error(`factory.yaml has no model for the ${agent} stage`);
  }
  return (downshift ? config.usage.downshift[agent] : undefined) ?? config.models[agent];
};

type StatusKey = keyof FactoryConfig['linear']['statuses'];

const STATUS_KEYS: Record<Stage, StatusKey> = {
  researching: 'researching',
  spec: 'spec',
  spec_review: 'specReview',
  building: 'building',
  in_review: 'inReview',
  awaiting_merge: 'awaitingMerge',
  done: 'done',
  canceled: 'canceled'
};

export const stageForAgent = (agent: AgentRole): Stage | undefined =>
  STAGES.find((stage) => AGENT_FOR_STAGE[stage] === agent);

export const linearStatusFor = (config: FactoryConfig, stage: Stage): string =>
  config.linear.statuses[STATUS_KEYS[stage]];

// Linear's workflow state types. A finished issue keeps its status; Linear's GitHub integration owns Done.
export const shouldMoveIssue = (currentStateType: string): boolean =>
  currentStateType !== 'completed' && currentStateType !== 'canceled';

// Phase 1 has no review stage, so a delivered PR goes straight to the human merge gate. Phase 2 sends it to review.
export const stageAfterRun = (
  run: { agent: AgentRole; status: RunStatus; outcome: RunOutcome | null },
  hasPr: boolean
): Stage | undefined =>
  run.agent === 'implement' && run.status === 'finished' && run.outcome === 'done' && hasPr
    ? 'awaiting_merge'
    : undefined;

export type QueueEntry = { runId: string; priority: Priority; heldAt: Date };

export const orderQueue = <T extends QueueEntry>(entries: T[]): T[] =>
  entries.toSorted(
    (a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || a.heldAt.getTime() - b.heldAt.getTime()
  );

const HOLD_COPY: Record<HoldReason, string> = {
  concurrency: 'the factory is already running as many stages as it allows',
  work_item_busy: 'an earlier run on this issue is still going',
  five_hour_throttle: 'usage in the 5-hour window is high, so only work already in flight runs',
  five_hour_pause: 'usage in the 5-hour window is close to the limit',
  weekly_pacing: 'weekly usage is ahead of pace',
  weekly_pause: 'weekly usage is close to the limit'
};

const dayKey = (at: Date, timeZone: string): string => at.toLocaleDateString('en-GB', { timeZone });

export const formatReleaseAt = (at: Date, now: Date, timeZone: string): string => {
  const time = at.toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' });
  if (dayKey(at, timeZone) === dayKey(now, timeZone)) {
    return time;
  }
  return `${at.toLocaleDateString('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
};

export const startedThought = (agent: AgentRole): string => `Working on it: ${agent} run started.`;

export const queuedThought = (
  { reason, releaseAt }: Extract<GovernedDecision, { kind: 'hold' }>,
  now: Date,
  timeZone: string
): string =>
  releaseAt
    ? `Queued until ${formatReleaseAt(releaseAt, now, timeZone)}: ${HOLD_COPY[reason]}.`
    : `Queued: ${HOLD_COPY[reason]}. It starts as soon as that clears.`;

export const STOPPED_RESPONSE = 'Stopped. Nothing more will run on this until you delegate it again or reply here.';

export type FinishedRun = {
  agent: AgentRole;
  status: RunStatus;
  outcome: RunOutcome | null;
  summary: string | null;
};

export type ClosingActivity = { type: 'thought' | 'response' | 'error'; body: string };

const FAILING_OUTCOMES: (RunOutcome | null)[] = ['failed', 'blocked'];

// What the router posts after a run, given whether the agent already closed the session itself.
export const closingActivity = (
  run: FinishedRun,
  { agentClosed, resuming }: { agentClosed: boolean; resuming: boolean }
): ClosingActivity | undefined => {
  if (run.status === 'limit_hit') {
    return resuming
      ? { type: 'thought', body: 'Hit the usage limit before finishing. I’ll pick this up again once it resets.' }
      : { type: 'error', body: 'Hit the usage limit again before finishing. Reply here to try once more.' };
  }
  if (agentClosed || run.status !== 'finished') {
    return undefined;
  }
  const body = run.summary ?? `The ${run.agent} run ended without a summary.`;
  return { type: FAILING_OUTCOMES.includes(run.outcome) ? 'error' : 'response', body };
};

// A resumed run that hits the limit again stops there, so a misread window can't loop dispatches.
export const shouldResume = (run: { status: RunStatus; trigger: RunTrigger }): boolean =>
  run.status === 'limit_hit' && run.trigger !== 'rerun';

const escapeSlack = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const slackLink = (url: string, label: string): string => `<${url}|${escapeSlack(label)}>`;

// The thread's first message; each run then replies in it.
export const slackThreadText = (issue: { identifier: string; url: string; title: string | null }): string =>
  `${slackLink(issue.url, issue.identifier)}${issue.title ? ` ${escapeSlack(issue.title)}` : ''}`;

export const slackStartedText = (agent: AgentRole): string => `Started the ${agent} run.`;

const OUTCOME_COPY: Record<RunOutcome, string> = {
  done: 'finished',
  needs_input: 'needs an answer in Linear',
  blocked: 'is blocked',
  failed: 'failed',
  declined: 'declined the work',
  stopped: 'stopped'
};

export const slackFinishedText = (
  run: FinishedRun & { prUrl: string | null; actionsRunUrl: string | null }
): string => {
  const verdict =
    run.status === 'limit_hit'
      ? 'hit the usage limit; it resumes once the window resets'
      : run.outcome
        ? OUTCOME_COPY[run.outcome]
        : run.status;
  const links = [
    run.prUrl ? slackLink(run.prUrl, 'PR') : undefined,
    run.actionsRunUrl ? slackLink(run.actionsRunUrl, 'run log') : undefined
  ].filter((link) => link !== undefined);
  return [
    `The ${run.agent} run ${verdict}.`,
    run.summary ? escapeSlack(run.summary) : undefined,
    links.length > 0 ? links.join(' · ') : undefined
  ]
    .filter((part) => part !== undefined)
    .join(' ');
};
