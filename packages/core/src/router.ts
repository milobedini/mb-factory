import { z } from 'zod';

import type { FactoryConfig } from './config';
import type { SpecDesign } from './design';
import { readDesignComponents } from './design';
import type { Gate } from './gates';
import { readGate } from './gates';
import type { Decision, DispatchRequest, HoldReason, Priority, UsageWindow } from './governor';
import { decideDispatch, PRIORITIES, USAGE_HOLD_REASONS } from './governor';
import type { Question } from './questions';
import { readQuestions } from './questions';
import type { RunOutcome, RunStatus, RunTrigger } from './runs';
import type { AgentRole, Stage } from './stages';
import { AGENT_FOR_STAGE, JOB_AGENTS, STAGES, TERMINAL_STAGES, transition } from './stages';

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

// Which agent picks the work up from each stage, on a reply or a new delegation. Settled work starts again at triage.
const AGENT_TO_CONTINUE: Record<Stage, AgentRole> = {
  researching: 'triage',
  spec: 'spec',
  spec_review: 'spec',
  design: 'design',
  design_review: 'design',
  building: 'implement',
  in_review: 'review',
  awaiting_merge: 'implement',
  done: 'triage',
  canceled: 'triage'
};

export type SpecReply =
  | { kind: 'approve'; suggestions: string | null }
  | { kind: 'ask_changes' }
  | { kind: 'changes'; body: string };

const APPROVALS = ['approve', 'approved', 'lgtm'];
const CHANGE_OPTIONS = ['change something', 'change'];
const APPROVE_WITH_SUGGESTIONS = /^approved?\s*[:\-–—]\s*(\S[\s\S]*)$/i;

// Approval is a gate, so it's read strictly: the Approve option (by label or value), a bare "approve" or "lgtm", or
// "Approve: <suggestions>". The Change something option alone says nothing to change yet. Anything else is a change.
export const readSpecReply = (body: string): SpecReply => {
  const text = body.trim();
  const bare = text.toLowerCase().replace(/[.!\s]+$/, '');
  if (APPROVALS.includes(bare)) {
    return { kind: 'approve', suggestions: null };
  }
  const suggestions = APPROVE_WITH_SUGGESTIONS.exec(text)?.[1]?.trim();
  if (suggestions) {
    return { kind: 'approve', suggestions };
  }
  return CHANGE_OPTIONS.includes(bare) ? { kind: 'ask_changes' } : { kind: 'changes', body: text };
};

export const CHANGES_QUESTION = 'What should change? Reply here with the changes and I’ll revise the spec.';

export const DESIGN_CHANGES_QUESTION = 'What should change? Reply here with the changes and I’ll revise the design.';

// The design stage runs for a project only once it names its design routine and its Linear workflow has the Design and
// Design Review statuses.
export const designStageOn = (config: FactoryConfig): boolean =>
  config.design !== undefined &&
  config.linear.statuses.design !== undefined &&
  config.linear.statuses.designReview !== undefined;

// An approved spec that calls for design goes to the design stage, carrying the approval's suggestions, instead of
// straight to implement.
export const afterSpecApproval = (request: RunRequest, design: SpecDesign | null, designOn: boolean): RunRequest =>
  request.trigger === 'spec_approved' && designOn && design?.needed ? { ...request, agent: 'design' } : request;

// New work starts at triage; a reply carries the human's message to the agent for the work item's stage. In Spec Review
// an approval starts implement on the spec's branch; undefined means the router should ask what to change.
export const runRequestFor = (
  event: { kind: 'created' } | { kind: 'prompted'; body: string },
  stage: Stage | undefined
): RunRequest | undefined => {
  const agent = stage ? AGENT_TO_CONTINUE[stage] : 'triage';
  if (event.kind === 'created') {
    return { agent, trigger: 'delegated', priority: 'feature', prompt: null };
  }
  if (stage !== 'spec_review' && stage !== 'design_review') {
    return { agent, trigger: 'prompted', priority: 'in_flight', prompt: event.body };
  }
  // Design Review reads a reply as Spec Review does: an approval hands the design off to the repo before implement
  // builds it, and anything else revises the design.
  const reply = readSpecReply(event.body);
  if (reply.kind === 'approve') {
    return stage === 'spec_review'
      ? { agent: 'implement', trigger: 'spec_approved', priority: 'in_flight', prompt: reply.suggestions }
      : { agent: 'design', trigger: 'design_approved', priority: 'in_flight', prompt: reply.suggestions };
  }
  return reply.kind === 'changes'
    ? { agent, trigger: 'prompted', priority: 'in_flight', prompt: reply.body }
    : undefined;
};

const RERUN_OUTCOMES: (RunOutcome | null)[] = ['failed', 'blocked', 'stopped'];

// Re-running is for a run that ended badly, on work that isn't settled. A finished stage the router moved on from,
// a question, a decline, or triage's `next: human` all have better routes: a reply in Linear, or a new delegation.
export const canRerun = (
  run: { agent: AgentRole; status: RunStatus; outcome: RunOutcome | null; report: unknown },
  workItem: ReviewLoop & { stage: Stage; hasPr: boolean }
): boolean => {
  if (TERMINAL_STAGES.includes(workItem.stage)) {
    return false;
  }
  if (run.status === 'limit_hit' || run.status === 'canceled') {
    return true;
  }
  if (run.status !== 'finished') {
    return false;
  }
  if (RERUN_OUTCOMES.includes(run.outcome)) {
    return true;
  }
  const stoppedForHuman = run.agent === 'triage' && triageReportSchema.safeParse(run.report).data?.next === 'human';
  const { stage: _stage, ...loop } = workItem;
  const next = nextStepAfterRun(run, loop);
  return run.outcome === 'done' && !stoppedForHuman && next.stage === undefined && next.request === undefined;
};

type RunEnd = {
  agent: AgentRole;
  status: RunStatus;
  outcome: RunOutcome | null;
  report: unknown;
  costUsd: number | null;
  durationMs: number | null;
};

// Setting up the agent takes a minute or two; a stage step that ran longer than this had the agent working.
const SETUP_MS = 10 * 60 * 1000;

// A run whose agent never started: a setup step failed (a download, the runner) before Claude ran, so there's no
// report and no usage, and the step ended soon. Nothing about the work caused it. One stopped at its time limit has
// no report or usage either, but the agent worked all along.
export const neverStarted = ({ status, outcome, report, costUsd, durationMs }: RunEnd): boolean =>
  status === 'finished' &&
  outcome === 'failed' &&
  report === null &&
  costUsd === null &&
  (durationMs === null || durationMs < SETUP_MS);

// Such a run is tried once more by itself; a retry that fails the same way waits for a person.
export const shouldRetry = (run: RunEnd, parent: RunEnd | undefined): boolean =>
  neverStarted(run) && !(parent && parent.agent === run.agent && neverStarted(parent));

export const retryText = (agent: AgentRole, actionsRunUrl: string | null): string =>
  `The ${agent} run didn’t start: a setup step failed before the agent ran${
    actionsRunUrl ? ` (${slackLink(actionsRunUrl, 'run log')})` : ''
  }. Trying again.`;

// The outcomes that leave a work item waiting on a person, shown in Linear as the Blocked label.
export const BLOCKING_OUTCOMES: (RunOutcome | null)[] = ['blocked', 'failed'];

// Re-run from the console: the same stage again, ahead of new work.
export const consoleRerunRequest = (agent: AgentRole): RunRequest => ({
  agent,
  trigger: 'console',
  priority: 'in_flight',
  prompt: null
});

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
export type GovernInput = Omit<DispatchRequest, 'acceptStale'> & {
  workItemBusy: boolean;
  // The console's pause switch.
  paused: boolean;
  // A human chose "allow once": usage limits and the pause don't apply; the run caps still do.
  allowUsage: boolean;
};

export const governDispatch = ({ workItemBusy, paused, allowUsage, ...request }: GovernInput): Governed => {
  const first = decideDispatch(request);
  const staleWindows = first.kind === 'probe' ? first.stale : [];
  const decided = first.kind === 'probe' ? decideDispatch({ ...request, acceptStale: true }) : first;
  if (decided.kind === 'probe') {
    throw new Error('The governor asked for a probe after accepting stale readings');
  }
  if (paused && !allowUsage) {
    return { decision: { kind: 'hold', state: 'paused', reason: 'manual_pause' }, staleWindows };
  }
  const overridden = allowUsage && decided.kind === 'hold' && USAGE_HOLD_REASONS.includes(decided.reason);
  const decision: GovernedDecision = overridden
    ? { kind: 'dispatch', state: decided.state, downshift: false }
    : decided;
  if (decision.kind === 'dispatch' && workItemBusy) {
    return { decision: { kind: 'hold', state: decision.state, reason: 'work_item_busy' }, staleWindows };
  }
  return { decision, staleWindows };
};

export type ModelledAgent = Exclude<keyof FactoryConfig['models'], 'slicing'>;

const isModelled = (agent: AgentRole): agent is ModelledAgent => !(JOB_AGENTS as readonly AgentRole[]).includes(agent);

// Triage slices a project instead when its issue's title starts `Slice ` and a word (plugin/agents/triage.md). Any word
// counts; if an ordinary "Slice …" issue misfires, match `Slice <the issue's own project>` instead.
export const isSlicingTitle = (title: string | null | undefined): boolean => /^slice\s+\S/i.test(title?.trim() ?? '');

// Slicing falls back to the triage model when a project sets none for it.
export const modelFor = (
  config: FactoryConfig,
  agent: AgentRole,
  downshift: boolean,
  title?: string | null
): string => {
  if (!isModelled(agent)) {
    throw new Error(`factory.yaml has no model for the ${agent} stage`);
  }
  const key = agent === 'triage' && isSlicingTitle(title) ? 'slicing' : agent;
  // Questions are never downshifted, as the governor's throttle doesn't hold them either, nor is design, whose routine
  // sets its own model.
  const model =
    (downshift && key !== 'ask' && key !== 'size' && key !== 'design' ? config.usage.downshift[key] : undefined) ??
    config.models[key] ??
    config.models[agent];
  if (!model) {
    throw new Error(`factory.yaml has no model for the ${agent} stage`);
  }
  return model;
};

// Whether a PR's changed files touch a path that shows on screen: a directory (with or without its trailing slash)
// or a single file.
export const showsOnScreen = (paths: string[], changedFiles: string[]): boolean => {
  const prefixes = paths.map((path) => path.replace(/^\.?\/+/, '').replace(/\/+$/, ''));
  return changedFiles.some((file) => prefixes.some((prefix) => file === prefix || file.startsWith(`${prefix}/`)));
};

const notOnScreenSchema = z.looseObject({ notOnScreen: z.string().trim().min(1).max(300).nullish().catch(null) });
const verifyAgainSchema = z.looseObject({ verifyAgain: z.string().trim().min(1).max(300).nullish().catch(null) });

// `again` is the implement run's reason for asking, passed on to the verify run.
export type VerifyDecision = { verify: boolean; skipped?: string; again?: string };

const criteriaSchema = z.looseObject({ criteria: z.array(z.looseObject({ result: z.string() })) });

// Whether a verify run showed the whole change working: at least one criterion met and none not met. Anything less,
// and a revision has to be shown on screen again.
export const metEveryCriterion = (report: unknown): boolean => {
  const results = (criteriaSchema.safeParse(report).data?.criteria ?? []).map(({ result }) =>
    result
      .replace(/[\s_]+/g, ' ')
      .trim()
      .toLowerCase()
  );
  return results.includes('met') && !results.includes('not met');
};

// Revisions that don't redo a verify run that met every criterion, unless they ask for it with `verifyAgain`: fixing
// review findings, making the changes a human's answers to review asked for, fixing a failed check, and merging the
// default branch in to clear a conflict (its own changes were verified on their PRs).
const REVERIFY_ON_REQUEST: RunTrigger[] = ['review_findings', 'answered', 'ci_failed', 'conflict'];

export const reverifiesOnRequest = (trigger: RunTrigger): boolean => REVERIFY_ON_REQUEST.includes(trigger);

// Whether a delivered PR is verified in the app: when the implement run asks for it again, with why; otherwise when it
// touches a path that shows on screen, unless the implement run said why nothing a person sees changed, or an earlier
// verify run on the work item already met every criterion (`verifiedAt`, as the thread shows it), for a revision that
// reverifies only on request.
export const decideVerify = (
  paths: string[],
  changedFiles: string[],
  report: unknown,
  verifiedAt?: string
): VerifyDecision => {
  const again = verifyAgainSchema.safeParse(report).data?.verifyAgain?.replace(/\s+/g, ' ');
  if (again) {
    return { verify: true, again };
  }
  if (!showsOnScreen(paths, changedFiles)) {
    return { verify: false };
  }
  const reason = notOnScreenSchema.safeParse(report).data?.notOnScreen?.replace(/\s+/g, ' ');
  if (reason) {
    return { verify: false, skipped: reason };
  }
  return verifiedAt
    ? { verify: false, skipped: `already verified at ${verifiedAt}, and nothing it checked was unmet` }
    : { verify: true };
};

type StatusKey = keyof FactoryConfig['linear']['statuses'];

const STATUS_KEYS: Record<Stage, StatusKey> = {
  researching: 'researching',
  spec: 'spec',
  spec_review: 'specReview',
  design: 'design',
  design_review: 'designReview',
  building: 'building',
  in_review: 'inReview',
  awaiting_merge: 'awaitingMerge',
  done: 'done',
  canceled: 'canceled'
};

export const stageForAgent = (agent: AgentRole): Stage | undefined =>
  STAGES.find((stage) => AGENT_FOR_STAGE[stage] === agent);

// Undefined only for a design status, in a project without the design stage.
export const linearStatusFor = (config: FactoryConfig, stage: Stage): string | undefined =>
  config.linear.statuses[STATUS_KEYS[stage]];

// Linear's workflow state types. A finished issue keeps its status; Linear's GitHub integration owns Done.
export const shouldMoveIssue = (currentStateType: string): boolean =>
  currentStateType !== 'completed' && currentStateType !== 'canceled';

// `reviewRounds` is set when a review finished, to the number of reviews completed in this loop. `questions` are for
// the router to ask one at a time.
export type NextStep = {
  stage?: Stage;
  request?: RunRequest;
  reviewRounds?: number;
  questions?: Question[];
  gate?: Gate;
};

// The review round a brief names: the one a review run is about to do, or the one a revision is fixing.
export const briefRound = (
  run: { agent: AgentRole; trigger: RunTrigger },
  reviewRounds: number
): number | undefined => {
  if (run.agent === 'review') {
    return reviewRounds + 1;
  }
  return run.agent === 'implement' && run.trigger === 'review_findings' ? reviewRounds : undefined;
};

const NEW_LOOP_TRIGGERS: RunTrigger[] = ['delegated', 'spec_approved', 'design_approved', 'prompted'];

// An implement run a human asked for starts a fresh review loop; revisions and resumes continue the current one.
export const startsReviewLoop = (request: RunRequest): boolean =>
  request.agent === 'implement' && NEW_LOOP_TRIGGERS.includes(request.trigger);

export const MAX_CI_FIXES = 2;

// Implement runs triggered by a failed check since the last implement run anything else asked for (newest first).
export const consecutiveCiFixes = (runs: { agent: AgentRole; trigger: RunTrigger }[]): number => {
  const implementRuns = runs.filter(({ agent }) => agent === 'implement');
  const streak = implementRuns.findIndex(({ trigger }) => trigger !== 'ci_failed');
  return streak === -1 ? implementRuns.length : streak;
};

export type CiFailureAction = { kind: 'fix'; request: RunRequest } | { kind: 'hand_over' } | { kind: 'ignore' };

const CI_FIXABLE_STAGES: Stage[] = ['in_review', 'awaiting_merge'];

// A failed check on a delivered PR goes back to implement, unless a run is already going (a review reads the checks
// itself) or the last fixes didn't take.
export const decideCiFailure = (
  failure: { workflow: string; url: string | null },
  { stage, openRuns, ciFixes }: { stage: Stage; openRuns: number; ciFixes: number }
): CiFailureAction => {
  if (!CI_FIXABLE_STAGES.includes(stage) || openRuns > 0) {
    return { kind: 'ignore' };
  }
  if (ciFixes >= MAX_CI_FIXES) {
    return { kind: 'hand_over' };
  }
  const where = failure.url ? `: ${failure.url}` : '.';
  return {
    kind: 'fix',
    request: {
      agent: 'implement',
      trigger: 'ci_failed',
      priority: 'in_flight',
      prompt: `The ${failure.workflow} workflow failed on the PR${where}`
    }
  };
};

export type CommitRun = {
  id: number;
  workflowId: number;
  name: string | null;
  event: string;
  conclusion: string | null;
  url: string;
};

const CHECK_EVENTS = ['pull_request', 'deployment_status'];
const FAILED_CHECK_CONCLUSIONS = ['failure', 'timed_out'];

// The checks failing on a PR's head, from its commit's Actions runs, newest first as GitHub lists them: the latest run
// of each check workflow (a re-run that passed clears it). Stage runs and other events aren't checks.
export const failedChecks = (commitRuns: CommitRun[]): { runId: number; workflow: string; url: string }[] =>
  commitRuns
    .filter(({ event }) => CHECK_EVENTS.includes(event))
    .filter((run, index, all) => all.findIndex(({ workflowId }) => workflowId === run.workflowId) === index)
    .filter(({ conclusion }) => FAILED_CHECK_CONCLUSIONS.includes(conclusion ?? ''))
    .map(({ id, name, url }) => ({ runId: id, workflow: name ?? 'A check', url }));

export type ConflictAction = { kind: 'fix'; request: RunRequest } | { kind: 'hand_over' } | { kind: 'ignore' };

// Conflict fixes get one attempt for each state of the default branch: a later merge there can conflict afresh.
export const MAX_CONFLICT_FIXES = 1;

// Implement runs that resolved a conflict, made since the default branch last moved.
export const conflictFixesSince = (runs: { agent: AgentRole; trigger: RunTrigger; createdAt: Date }[], since: Date) =>
  runs.filter(({ agent, trigger, createdAt }) => agent === 'implement' && trigger === 'conflict' && createdAt > since)
    .length;

// A delivered PR that no longer merges goes back to implement, unless a run is already going (it's checked again when
// the PR reaches the merge gate) or this state of the default branch already had its attempt.
export const decideConflict = (
  { branch }: { branch: string },
  { stage, openRuns, conflictFixes }: { stage: Stage; openRuns: number; conflictFixes: number }
): ConflictAction => {
  if (!CI_FIXABLE_STAGES.includes(stage) || openRuns > 0) {
    return { kind: 'ignore' };
  }
  if (conflictFixes >= MAX_CONFLICT_FIXES) {
    return { kind: 'hand_over' };
  }
  return {
    kind: 'fix',
    request: {
      agent: 'implement',
      trigger: 'conflict',
      priority: 'in_flight',
      prompt: `The PR conflicts with ${branch}. Merge origin/${branch} into the branch and resolve the conflicts.`
    }
  };
};

// A PR waiting at the merge gate that's behind its base gets the base merged in by the console, with no run: the merge
// gate takes the new head while the PR's changes stay as reviewed, and CI checks it as usual. GitHub often can't say
// whether a PR merges for minutes after its base moves, so only a known conflict stops it (the merge itself is refused
// on one). Not while a run is going, which pushes commits of its own.
export const shouldBringUpToDate = ({
  stage,
  openRuns,
  mergeable,
  behindBy
}: {
  stage: Stage;
  openRuns: number;
  mergeable: boolean | null;
  behindBy: number;
}): boolean => stage === 'awaiting_merge' && openRuns === 0 && mergeable !== false && behindBy > 0;

// The most merges of the default branch a head can stack on the reviewed commit and still count as reviewed.
export const MAX_BASE_MERGES = 10;

// The newest default-branch commit merged in on the way from `reviewed` to `head`, when every commit along the head's
// first parents is a two-parent merge whose other parent is already on the default branch. Undefined when the walk
// leaves that shape, runs past `limit`, or `head` is `reviewed`.
export const newestMergedBase = async (
  head: string,
  reviewed: string,
  { parents, onBase }: { parents: (sha: string) => Promise<string[]>; onBase: (sha: string) => Promise<boolean> },
  limit = MAX_BASE_MERGES
): Promise<string | undefined> => {
  const walk = async (sha: string, steps: number, newest: string | undefined): Promise<string | undefined> => {
    if (sha === reviewed) {
      return newest;
    }
    if (steps === 0) {
      return undefined;
    }
    const [first, other, ...more] = await parents(sha);
    if (!first || !other || more.length > 0 || !(await onBase(other))) {
      return undefined;
    }
    return walk(first, steps - 1, newest ?? other);
  };
  return walk(head, limit, undefined);
};

// Whether `head` sits on `reviewed` only through merge commits the console made itself (`made`), following first
// parents. GitHub computed each of those merges, so nothing in them went unreviewed, whatever files the base shares.
export const madeOnlyBy = async (
  head: string,
  reviewed: string,
  { parents, made }: { parents: (sha: string) => Promise<string[]>; made: (sha: string) => boolean },
  limit = MAX_BASE_MERGES
): Promise<boolean> => {
  const walk = async (sha: string, steps: number): Promise<boolean> => {
    if (sha === reviewed) {
      return steps < limit;
    }
    if (steps === 0 || !made(sha)) {
      return false;
    }
    const [first] = await parents(sha);
    return first !== undefined && walk(first, steps - 1);
  };
  return walk(head, limit);
};

// Two runs that finish close together (a conflict fix and an answer's revision) can each hand on to the same stage. A
// verify or review already queued works on the PR's head when it starts, so a second would only repeat it; and with an
// implement run queued, that run hands on once it's done, so one review sees both changes.
export const queuedAlready = (request: RunRequest, queued: { agent: AgentRole }[]): boolean =>
  request.trigger === 'delivered' && queued.some(({ agent }) => agent === request.agent || agent === 'implement');

export type ReviewThread = { id: string; isResolved: boolean; author: string | null };

// The GitHub login the review stage posts its findings as (the Claude app).
export const FACTORY_REVIEWER_LOGIN = 'claude';

// The review's own threads still open, once nothing is left to decide: each is fixed, decided or a Nit by then. A
// person's threads are theirs to resolve.
export const reviewThreadsToResolve = (threads: ReviewThread[]): string[] =>
  threads.filter(({ isResolved, author }) => !isResolved && author === FACTORY_REVIEWER_LOGIN).map(({ id }) => id);

// GitHub works `mergeable` out lazily, so right after either branch moves it can still give the answer for the old
// heads. A `true` holds only when its test merge commit joins the base's head and the PR's head; otherwise it's not
// known yet. A `false` has no test merge to check, so it stands.
export const currentMergeable = ({
  mergeable,
  testMergeParents,
  baseHead,
  prHead
}: {
  mergeable: boolean | null;
  testMergeParents: string[] | undefined;
  baseHead: string;
  prHead: string;
}): boolean | null => {
  if (mergeable !== true) {
    return mergeable;
  }
  return testMergeParents?.[0] === baseHead && testMergeParents[1] === prHead ? true : null;
};

export const conflictHandOverText = (branch: string, prUrl: string | null): string =>
  `The PR still conflicts with ${branch} after I tried to resolve it, so I’ve stopped there; it needs a look${prUrl ? `: ${prUrl}` : '.'}`;

export const ciHandOverText = (workflow: string, url: string | null): string =>
  `The ${workflow} workflow failed again after ${MAX_CI_FIXES} fixes, so I’ve stopped there; it needs a look${url ? `: ${url}` : '.'}`;

const triageReportSchema = z.looseObject({
  next: z.string().nullish(),
  // Slicing's last run: the issues it created. Read alone, so a malformed list never hides `next`.
  created: z.unknown().nullish()
});

const ISSUE_IDENTIFIER = /^[A-Z][A-Z0-9]*-\d+$/;

// The issues a slicing run reports it created; once there are any, the slicing issue's work is done.
export const slicedIssues = (report: unknown): string[] => {
  const created = triageReportSchema.safeParse(report).data?.created;
  return Array.isArray(created)
    ? created.filter(
        (identifier): identifier is string => typeof identifier === 'string' && ISSUE_IDENTIFIER.test(identifier)
      )
    : [];
};

// Triage's `next` picks the stage after it; the follow-on run is still `delegated`, as the agents expect.
// No verify stage yet: a UI bug triage wants reproduced goes to implement, whose bug path starts with a failing test.
const agentAfterTriage = (report: unknown): AgentRole | undefined => {
  const next = triageReportSchema.safeParse(report).data?.next;
  if (next === 'spec') {
    return 'spec';
  }
  return next === 'implement' || next === 'verify' ? 'implement' : undefined;
};

export const REVIEW_VERDICTS = ['accepted', 'revision_needed', 'human_decision_needed'] as const;

export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

const findingSchema = z.looseObject({
  tier: z.string().nullish(),
  path: z.string().nullish(),
  line: z.int().nullish(),
  needsHuman: z.boolean().nullish(),
  summary: z.string().min(1),
  fix: z.string().nullish(),
  // The cheapest guard against the finding's whole class of problem.
  guard: z.string().nullish()
});

type Finding = z.infer<typeof findingSchema>;

export type ReviewFinding = Finding;

const reviewReportSchema = z.looseObject({
  verdict: z.enum(REVIEW_VERDICTS).nullish(),
  findings: z.array(z.unknown()).nullish()
});

// A review that doesn't say what it decided goes to a human, never back round the loop.
const readReview = (report: unknown): { verdict: ReviewVerdict; fixable: Finding[] } => {
  const parsed = reviewReportSchema.safeParse(report).data;
  const findings = (parsed?.findings ?? []).flatMap((finding) => {
    const read = findingSchema.safeParse(finding);
    return read.success ? [read.data] : [];
  });
  return {
    verdict: parsed?.verdict ?? 'human_decision_needed',
    fixable: findings.filter(({ needsHuman }) => needsHuman !== true)
  };
};

export const reviewVerdict = (report: unknown): ReviewVerdict => readReview(report).verdict;

// The findings the implement stage could fix: everything but those that need a human's decision.
export const readFixableFindings = (report: unknown): Finding[] => readReview(report).fixable;

const MAX_FINDINGS_IN_BRIEF = 25;
const MAX_FIELD_LENGTH = 600;

const clip = (text: string): string => {
  const flat = text.trim();
  return flat.length > MAX_FIELD_LENGTH ? `${flat.slice(0, MAX_FIELD_LENGTH)}…` : flat;
};

// Unambiguous findings never reach GitHub, so the revision's brief carries them.
// A review round's answers and its fixable findings settle in one revision: findings left beside questions are fixed
// with the answers that change the PR, as the findings message's default (every box ticked) would.
export const withFindings = (request: RunRequest, round: number, findings: Finding[]): RunRequest =>
  findings.length === 0
    ? request
    : { ...request, prompt: [request.prompt, findingsPrompt(round, findings)].filter(Boolean).join('\n\n') };

export const findingsPrompt = (round: number, findings: Finding[]): string => {
  const listed = findings.slice(0, MAX_FINDINGS_IN_BRIEF).map(({ tier, path, line, summary, fix, guard }, index) => {
    const where = path ? ` ${path}${line ? `:${line}` : ''}` : '';
    return [
      `${index + 1}. [${tier ?? 'finding'}]${where}: ${clip(summary)}`,
      fix ? `   Fix: ${clip(fix)}` : undefined,
      guard ? `   Guard: ${clip(guard)}` : undefined
    ]
      .filter((part) => part !== undefined)
      .join('\n');
  });
  const more = findings.length - listed.length;
  return [
    `Review round ${round} found these for you to fix:`,
    ...listed,
    more > 0 ? `…and ${more} more; the next review round checks what's left.` : undefined
  ]
    .filter((line) => line !== undefined)
    .join('\n');
};

export type ReviewLoop = { reviewRounds: number; maxReviewRounds: number };

// Files a package manager writes from the manifests beside it, so a merge that changes only these needs no review.
const LOCKFILES = [
  'pnpm-lock.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lock',
  'uv.lock',
  'poetry.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'go.sum',
  'composer.lock'
];

const isLockfile = (path: string): boolean => LOCKFILES.includes(path.split('/').at(-1) ?? path);

// A file in GitHub's compare of two commits: its diff (missing for a binary or very large file) and its content at the
// later one.
export type ChangedFile = { filename: string; status: string; sha: string | null; patch?: string | null };

// A diff without its hunks' line numbers, which shift when the base gains lines elsewhere in the file. Each hunk's
// place stays: its order, its context lines, and the function or section name after the header.
const diffLines = (patch: string): string => patch.replace(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/gm, '@@');

const sameFiles = (reviewed: ChangedFile[], now: ChangedFile[], counts: (filename: string) => boolean): boolean => {
  const code = (files: ChangedFile[]): string[] =>
    files
      .filter(({ filename }) => counts(filename))
      .map(({ filename, status, sha, patch }) => [filename, status, patch ? diffLines(patch) : sha].join('\u0000'))
      .toSorted();
  const [before, after] = [code(reviewed), code(now)];
  return before.length === after.length && before.every((file, index) => file === after[index]);
};

// The PR's changes against its new base, beside its changes as reviewed: the same apart from lockfiles means merging
// the base changed nothing the PR does, as when the base moves without a conflict. Both lists come from GitHub, never
// from the run's own report. A file with no diff is compared by content.
export const onlyLockfilesChanged = (reviewed: ChangedFile[], now: ChangedFile[]): boolean =>
  sameFiles(reviewed, now, (filename) => !isLockfile(filename));

// The same, lockfiles included: for a head nobody's run made, where a lockfile changed inside a merge commit could
// install a different package unreviewed.
export const sameChanges = (reviewed: ChangedFile[], now: ChangedFile[]): boolean =>
  sameFiles(reviewed, now, () => true);

const WAITING_ON_SPEC_REVIEW: (RunOutcome | null)[] = ['done', 'needs_input'];

const afterReview = (report: unknown, { reviewRounds, maxReviewRounds }: ReviewLoop): NextStep => {
  const round = reviewRounds + 1;
  const { verdict, fixable } = readReview(report);
  // Nothing the implement stage could act on is a decision for a human, whatever the verdict says.
  const effective: ReviewVerdict =
    verdict === 'revision_needed' && fixable.length === 0 ? 'human_decision_needed' : verdict;
  const moved = transition(
    'in_review',
    { type: 'reviewed', verdict: effective },
    { reviewRounds: round, maxReviewRounds }
  );
  const stage = moved.ok ? moved.stage : 'awaiting_merge';
  // The findings left for a human come as questions, so they're answered with a tap like any other stage's.
  const questions = stage === 'awaiting_merge' ? readQuestions(report) : [];
  return stage === 'building'
    ? {
        stage,
        reviewRounds: round,
        request: {
          agent: 'implement',
          trigger: 'review_findings',
          priority: 'in_flight',
          prompt: findingsPrompt(round, fixable)
        }
      }
    : { stage, reviewRounds: round, ...(questions.length > 0 ? { questions } : {}) };
};

// What follows a run that finished its stage. Anything else (a question, `next: human`, a failure) waits for a human;
// questions the stage reported are asked by the router.
// A spec run with its PR open is waiting on approval, whether it reports that as done or as needing input.
// A delivered PR goes to review; the review's verdict sends it to the human merge gate or back for a revision.
export const nextStepAfterRun = (
  run: {
    agent: AgentRole;
    trigger?: RunTrigger;
    status: RunStatus;
    outcome: RunOutcome | null;
    report: unknown;
    prompt?: string | null;
  },
  {
    hasPr,
    lockfileOnlyMerge = false,
    verify = false,
    verifyPrompt = null,
    ...loop
  }: ReviewLoop & { hasPr: boolean; lockfileOnlyMerge?: boolean; verify?: boolean; verifyPrompt?: string | null }
): NextStep => {
  const waiting = run.status === 'finished' && run.outcome === 'needs_input';
  const questions = waiting ? readQuestions(run.report) : [];
  // A gate's report has no questions; if one has both, the questions are asked.
  const gate = waiting && questions.length === 0 ? readGate(run.report) : undefined;
  const asking = questions.length > 0 ? { questions } : gate ? { gate } : {};
  if (run.agent === 'spec' && run.status === 'finished' && WAITING_ON_SPEC_REVIEW.includes(run.outcome) && hasPr) {
    return { stage: 'spec_review', ...asking };
  }
  // The hand-off committed the approved boards: implement builds them, with the approval's suggestions, unless the
  // design needs new Dino components, which are built first.
  if (run.agent === 'design' && run.trigger === 'design_approved') {
    if (run.status !== 'finished' || run.outcome !== 'done') {
      return asking;
    }
    return readDesignComponents(run.report).some(({ change }) => change === 'new')
      ? { stage: 'building' }
      : {
          stage: 'building',
          request: { agent: 'implement', trigger: 'design_approved', priority: 'in_flight', prompt: run.prompt ?? null }
        };
  }
  // A design run that drew or revised the canvas waits on Design Review, as a spec waits on Spec Review.
  if (run.agent === 'design' && run.status === 'finished' && WAITING_ON_SPEC_REVIEW.includes(run.outcome)) {
    return { stage: 'design_review', ...asking };
  }
  if (run.status !== 'finished' || run.outcome !== 'done') {
    return asking;
  }
  if (run.agent === 'implement') {
    // An accepted PR whose conflict fix changed only lockfiles, as checked against GitHub, goes back to the gate.
    if (hasPr && run.trigger === 'conflict' && lockfileOnlyMerge) {
      return { stage: 'awaiting_merge' };
    }
    // A PR that changes what shows on screen is verified in the app first; verify always hands on to review.
    return hasPr
      ? {
          stage: 'in_review',
          request: {
            agent: verify ? 'verify' : 'review',
            trigger: 'delivered',
            priority: 'in_flight',
            prompt: verify ? verifyPrompt : null
          }
        }
      : {};
  }
  if (run.agent === 'verify') {
    return hasPr
      ? { stage: 'in_review', request: { agent: 'review', trigger: 'delivered', priority: 'in_flight', prompt: null } }
      : {};
  }
  if (run.agent === 'review') {
    return afterReview(run.report, loop);
  }
  const agent = run.agent === 'triage' ? agentAfterTriage(run.report) : undefined;
  // A slicing issue is done once its slices exist: nothing else would ever move it.
  if (run.agent === 'triage' && !agent && slicedIssues(run.report).length > 0) {
    return { stage: 'done' };
  }
  return agent
    ? {
        stage: stageForAgent(agent),
        request: { agent, trigger: 'delegated', priority: 'feature', prompt: null }
      }
    : {};
};

export type QueueEntry = { runId: string; priority: Priority; heldAt: Date };

export const orderQueue = <T extends QueueEntry>(entries: T[]): T[] =>
  entries.toSorted(
    (a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) || a.heldAt.getTime() - b.heldAt.getTime()
  );

const HOLD_COPY: Record<HoldReason, string> = {
  concurrency: 'the factory is already running as many stages as it allows',
  work_item_busy: 'an earlier run on this issue is still going',
  manual_pause: 'the factory is paused from the console',
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
  { reason, releaseAt }: { reason: HoldReason; releaseAt?: Date | null },
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

export type ClosingActivity = { type: 'thought' | 'response' | 'error' | 'elicitation'; body: string };

const FAILING_OUTCOMES: (RunOutcome | null)[] = ['failed', 'blocked'];

// What the router posts after a run, given whether the agent already closed the session itself. A run that needs input
// but asked nothing leaves the session waiting on a reply.
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
  if (run.outcome === 'needs_input') {
    return { type: 'elicitation', body };
  }
  return { type: FAILING_OUTCOMES.includes(run.outcome) ? 'error' : 'response', body };
};

// A resumed run that hits the limit again stops there, so a misread window can't loop dispatches.
export const shouldResume = (run: { status: RunStatus; trigger: RunTrigger }): boolean =>
  run.status === 'limit_hit' && run.trigger !== 'rerun';

const escapeSlack = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const slackLink = (url: string, label: string): string => `<${url}|${escapeSlack(label)}>`;

// The thread's first message, until the card replaces it.
export const slackThreadText = (issue: { identifier: string; url: string; title: string | null }): string =>
  `${slackLink(issue.url, issue.identifier)}${issue.title ? ` ${escapeSlack(issue.title)}` : ''}`;

const MAX_MIRRORED_REPLY = 280;

// A human's reply in the Linear session, mirrored into the thread; long replies link to the issue for the rest.
export const slackReplyText = (body: string, issueUrl: string): string => {
  const flat = body.replace(/\s+/g, ' ').trim();
  const clipped = flat.length > MAX_MIRRORED_REPLY;
  const quoted = escapeSlack(clipped ? `${flat.slice(0, MAX_MIRRORED_REPLY)}…` : flat);
  return `Reply in Linear: “${quoted}”${clipped ? ` ${slackLink(issueUrl, 'Read it all')}` : ''}`;
};

const OUTCOME_COPY: Record<RunOutcome, string> = {
  done: 'finished',
  needs_input: 'needs an answer',
  blocked: 'is blocked',
  failed: 'failed',
  declined: 'declined the work',
  stopped: 'stopped'
};

// A run that asked questions, or reported a gate, points at them instead of repeating its summary, which only says what's
// coming; a spec waiting for approval points at the approval message.
// A blocked run waits on a person changing something; their reply is what starts it again.
const BLOCKED_NEXT = 'Reply here once that’s done and I’ll carry on.';

export const slackFinishedText = (
  run: FinishedRun & { prUrl: string | null; actionsRunUrl: string | null },
  { questions = 0, specReview = false, gate = false }: { questions?: number; specReview?: boolean; gate?: boolean } = {}
): string => {
  const verdict =
    run.status === 'limit_hit'
      ? 'hit the usage limit; it resumes once the window resets'
      : questions > 0
        ? `has ${questions === 1 ? 'a question' : `${questions} questions`} for you below`
        : gate
          ? 'is waiting for your answer below'
          : specReview
            ? 'finished: the spec is ready for review below'
            : run.outcome
              ? OUTCOME_COPY[run.outcome]
              : run.status;
  const links = [
    run.prUrl ? slackLink(run.prUrl, 'PR') : undefined,
    run.actionsRunUrl ? slackLink(run.actionsRunUrl, 'run log') : undefined
  ].filter((link) => link !== undefined);
  return [
    `The ${run.agent} run ${verdict}.`,
    run.summary && questions === 0 && !gate ? escapeSlack(run.summary) : undefined,
    run.status === 'finished' && run.outcome === 'blocked' ? BLOCKED_NEXT : undefined,
    links.length > 0 ? links.join(' · ') : undefined
  ]
    .filter((part) => part !== undefined)
    .join(' ');
};
