import type {
  AgentRole,
  AskedQuestion,
  FactoryConfig,
  GitHubEvent,
  GovernedDecision,
  Question,
  RunRequest,
  RunStatus,
  SessionEvent,
  SlackMessage,
  Stage,
  StopCause
} from '@mb-factory/core';
import {
  answeredRequest,
  applyAnswer,
  briefRound,
  buildDispatchPayload,
  CHANGES_QUESTION,
  canRerun,
  ciHandOverText,
  closingActivity,
  consecutiveCiFixes,
  consoleRerunRequest,
  decideCiFailure,
  decideIssueUpdate,
  governDispatch,
  isAllowedSlackUser,
  isOpenRun,
  linearSlackReplyText,
  linearStatusFor,
  modelFor,
  nextStepAfterRun,
  notAllowedText,
  orderQueue,
  parseGitHubEvent,
  parseIssueUpdate,
  parseSessionEvent,
  parseSlackAction,
  parseSlackThreadReply,
  prClosedText,
  QUESTION_GONE,
  questionElicitation,
  queuedThought,
  resumeRequestFor,
  runRequestFor,
  SPEC_GATE_GONE,
  STOPPED_RESPONSE,
  shouldMoveIssue,
  shouldResume,
  slackFinishedText,
  slackQuestionCard,
  slackReplyText,
  slackSpecGateMessage,
  slackSpecGateSettled,
  slackStartedText,
  slackThreadText,
  specUrl,
  stageAfterPrClosed,
  stageForAgent,
  startedThought,
  startsReviewLoop,
  stoppedText
} from '@mb-factory/core';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { questions, queue, runs, workItems } from '@/db/schema';

import { requireEnv } from './env';
import { cancelActionsRun, sendStageDispatch } from './github-api';
import type { AgentActivityContent } from './linear-api';
import { createAgentActivity, findAppUserId, hasClosingActivity, moveIssueToStatus } from './linear-api';
import { log } from './log';
import { currentPause } from './pause';
import { findProject, findProjectByTeamKey, repositoryOf } from './projects';
import type { RunWithWorkItem } from './runs';
import { findRun } from './runs';
import {
  postSlackEphemeral,
  postSlackMessage,
  respondToSlackAction,
  slackUserName,
  updateSlackMessage
} from './slack-api';
import { latestReadings } from './usage';

type WorkItem = typeof workItems.$inferSelect;
type Run = typeof runs.$inferSelect;
type QuestionRow = typeof questions.$inferSelect;

const ACTIVE_STATUSES: RunStatus[] = ['dispatched', 'running'];
const OPEN_STATUSES: RunStatus[] = ['queued', ...ACTIVE_STATUSES];

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// Side effects that report on work (Linear, Slack) must not stop the work itself.
const attempt = async (label: string, fields: Record<string, unknown>, effect: () => Promise<unknown>) => {
  try {
    await effect();
  } catch (error) {
    log('error', `${label} failed`, { ...fields, error: errorMessage(error) });
  }
};

const postActivity = (workItem: WorkItem, content: AgentActivityContent, select?: string[]) => {
  const { agentSessionId } = workItem;
  return agentSessionId
    ? attempt('linear activity', { issue: workItem.issueIdentifier, type: content.type }, () =>
        createAgentActivity(workItem.linearOrganizationId, agentSessionId, content, select)
      )
    : Promise.resolve();
};

// Returns the reply's `ts` when it was posted, for messages edited later.
const replyInThread = async (
  project: FactoryConfig,
  workItem: WorkItem,
  message: string | SlackMessage
): Promise<string | undefined> => {
  const channel = workItem.slackChannelId ?? project.slack?.channelId;
  const threadTs = workItem.slackThreadTs;
  const content = typeof message === 'string' ? { text: message } : message;
  if (!channel || !threadTs) {
    return undefined;
  }
  try {
    return await postSlackMessage({ channel, threadTs, ...content });
  } catch (error) {
    log('error', 'slack reply failed', { issue: workItem.issueIdentifier, error: errorMessage(error) });
    return undefined;
  }
};

const editInThread = (project: FactoryConfig, workItem: WorkItem, ts: string, message: SlackMessage) => {
  const channel = workItem.slackChannelId ?? project.slack?.channelId;
  return channel
    ? attempt('slack edit', { issue: workItem.issueIdentifier }, () => updateSlackMessage({ channel, ts, ...message }))
    : Promise.resolve();
};

const openSlackThread = async (project: FactoryConfig, workItem: WorkItem, title: string | null): Promise<void> => {
  if (!project.slack || workItem.slackThreadTs) {
    return;
  }
  const channel = project.slack.channelId;
  await attempt('slack thread', { issue: workItem.issueIdentifier }, async () => {
    const ts = await postSlackMessage({
      channel,
      text: slackThreadText({ identifier: workItem.issueIdentifier, url: workItem.issueUrl, title })
    });
    await getDb()
      .update(workItems)
      .set({ slackChannelId: channel, slackThreadTs: ts, updatedAt: new Date() })
      .where(and(eq(workItems.id, workItem.id), isNull(workItems.slackThreadTs)));
  });
};

const holdRun = async (
  project: FactoryConfig,
  { run, workItem }: RunWithWorkItem,
  decision: Extract<GovernedDecision, { kind: 'hold' }>,
  now: Date
): Promise<void> => {
  const db = getDb();
  const held = await db
    .insert(queue)
    .values({ runId: run.id, priority: run.priority, reason: decision.reason, releaseAt: decision.releaseAt })
    .onConflictDoNothing()
    .returning({ id: queue.id });
  log('info', 'run held', { runId: run.id, issue: workItem.issueIdentifier, reason: decision.reason });
  if (held.length === 0) {
    // Already waiting: keep the reason current, and don't repeat the message.
    await db
      .update(queue)
      .set({ reason: decision.reason, releaseAt: decision.releaseAt ?? null })
      .where(and(eq(queue.runId, run.id), isNull(queue.releasedAt)));
    return;
  }
  const text = queuedThought(decision, now, project.timeZone);
  await Promise.all([postActivity(workItem, { type: 'thought', body: text }), replyInThread(project, workItem, text)]);
};

// Records the stage and moves the Linear issue to its status; a failed move is logged, not fatal.
const moveWorkItem = async (project: FactoryConfig, workItem: WorkItem, stage: Stage): Promise<void> => {
  await Promise.all([
    getDb().update(workItems).set({ stage, updatedAt: new Date() }).where(eq(workItems.id, workItem.id)),
    attempt('linear status', { issue: workItem.issueIdentifier }, async () => {
      const move = await moveIssueToStatus(
        workItem.linearOrganizationId,
        workItem.linearIssueId,
        linearStatusFor(project, stage),
        shouldMoveIssue
      );
      log('info', 'linear status', { issue: workItem.issueIdentifier, stage, ...move });
    })
  ]);
};

const failDispatch = async ({ run, workItem }: RunWithWorkItem, error: unknown, now: Date): Promise<void> => {
  log('error', 'run dispatch failed', { runId: run.id, issue: workItem.issueIdentifier, error: errorMessage(error) });
  await getDb()
    .update(runs)
    .set({ status: 'finished', outcome: 'failed', summary: 'GitHub rejected the stage dispatch.', finishedAt: now })
    .where(eq(runs.id, run.id));
  await postActivity(workItem, {
    type: 'error',
    body: 'I couldn’t start the run: GitHub rejected the dispatch. The details are in the console log.'
  });
};

// Serialises claims, so two dispatchers can't both see a free slot.
const DISPATCH_LOCK = sql`select pg_advisory_xact_lock(hashtext('mb-factory:dispatch'))`;

// Claims the run only if, under the lock, the cap and the one-run-per-issue rule still hold.
const claimRun = async (project: FactoryConfig, run: Run, model: string, now: Date): Promise<boolean> => {
  const db = getDb();
  const active = sql.raw(ACTIVE_STATUSES.map((status) => `'${status}'`).join(', '));
  const [, claimed] = await db.batch([
    db.execute(DISPATCH_LOCK),
    db
      .update(runs)
      .set({ status: 'dispatched', dispatchedAt: now, model })
      .where(
        and(
          eq(runs.id, run.id),
          eq(runs.status, 'queued'),
          sql`(select count(*) from ${runs} as active where active.status in (${active})) < ${project.concurrency.maxRuns}`,
          sql`not exists (select 1 from ${runs} as active where active.work_item_id = ${run.workItemId} and active.status in (${active}))`
        )
      )
      .returning({ id: runs.id })
  ]);
  return claimed.length > 0;
};

type StartResult = 'started' | 'not_claimed' | 'skipped';

const startRun = async (
  project: FactoryConfig,
  found: RunWithWorkItem,
  downshift: boolean,
  now: Date
): Promise<StartResult> => {
  const { run, workItem } = found;
  const db = getDb();
  if (!workItem.agentSessionId) {
    log('warn', 'run not dispatched: work item has no agent session', { runId: run.id });
    return 'skipped';
  }
  const model = modelFor(project, run.agent, downshift);
  // Claim first: the stage workflow's start call only accepts a dispatched run.
  if (!(await claimRun(project, run, model, now))) {
    return 'not_claimed';
  }
  await db
    .update(queue)
    .set({ releasedAt: now })
    .where(and(eq(queue.runId, run.id), isNull(queue.releasedAt)));

  const payload = buildDispatchPayload({
    runId: run.id,
    model,
    brief: {
      agent: run.agent,
      issue: { identifier: workItem.issueIdentifier, url: workItem.issueUrl },
      session: workItem.agentSessionId,
      trigger: run.trigger,
      prompt: run.prompt ?? undefined,
      pr: workItem.prNumber ?? undefined,
      branch: workItem.branch ?? undefined,
      round: briefRound(run, workItem.reviewRounds)
    }
  });
  try {
    await sendStageDispatch(workItem.repository, payload);
  } catch (error) {
    await failDispatch(found, error, now);
    return 'skipped';
  }
  log('info', 'run dispatched', { runId: run.id, issue: workItem.issueIdentifier, model, downshift });

  const stage = stageForAgent(run.agent);
  await Promise.all([
    postActivity(workItem, { type: 'thought', body: startedThought(run.agent) }),
    replyInThread(project, workItem, slackStartedText(run, briefRound(run, workItem.reviewRounds))),
    stage ? moveWorkItem(project, workItem, stage) : undefined
  ]);
  return 'started';
};

// Runs the governor for one queued run, then dispatches it or holds it in the queue.
const dispatchRun = async (project: FactoryConfig, runId: string, retried = false): Promise<void> => {
  const found = await findRun(runId);
  if (found?.run.status !== 'queued') {
    return;
  }
  const db = getDb();
  const [readings, pause, runningCount, busyCount] = await Promise.all([
    latestReadings(),
    currentPause(),
    db.$count(runs, inArray(runs.status, ACTIVE_STATUSES)),
    db.$count(runs, and(eq(runs.workItemId, found.workItem.id), inArray(runs.status, ACTIVE_STATUSES)))
  ]);
  const now = new Date();
  const { decision, staleWindows } = governDispatch({
    policy: project.usage,
    readings,
    priority: found.run.priority,
    runningCount,
    maxRuns: project.concurrency.maxRuns,
    now,
    workItemBusy: busyCount > 0,
    paused: pause !== undefined,
    allowUsage: found.run.usageOverrideBy !== null
  });
  if (staleWindows.length > 0) {
    // No probe until Phase 1 step 4: decide on the readings there are, and say so.
    log('warn', 'governor decided on stale usage readings', { runId, staleWindows, decision: decision.kind });
  }
  if (decision.kind === 'hold') {
    await holdRun(project, found, decision, now);
    return;
  }
  if ((await startRun(project, found, decision.downshift, now)) !== 'not_claimed') {
    return;
  }
  // Another dispatch took the slot (or another run on this issue started) since the governor looked: decide again.
  if (!retried) {
    await dispatchRun(project, runId, true);
    return;
  }
  await holdRun(project, found, { kind: 'hold', state: decision.state, reason: 'concurrency' }, now);
};

const toAsked = ({ id, position, prompt, topic, why, options, answer, answerSource }: QuestionRow): AskedQuestion => ({
  id,
  position,
  prompt,
  topic,
  why,
  options,
  answer,
  answerSource
});

// Redraws a round's message in the thread from the database, so it shows the same state whoever answered and where.
const refreshQuestionCard = async (project: FactoryConfig, workItem: WorkItem, runId: string): Promise<void> => {
  const [rows, [asking]] = await Promise.all([
    getDb().select().from(questions).where(eq(questions.runId, runId)),
    getDb().select({ agent: runs.agent }).from(runs).where(eq(runs.id, runId)).limit(1)
  ]);
  const ts = rows[0]?.slackTs;
  if (!ts || !asking) {
    return;
  }
  const round = rows.map((row) => ({ ...toAsked(row), closed: row.closedAt !== null }));
  await editInThread(project, workItem, ts, slackQuestionCard(asking.agent, round, workItem.issueUrl));
};

const closeOpenQuestions = async (project: FactoryConfig, workItem: WorkItem): Promise<void> => {
  const closed = await getDb()
    .update(questions)
    .set({ closedAt: new Date() })
    .where(
      and(
        isNull(questions.answeredAt),
        isNull(questions.closedAt),
        inArray(questions.runId, getDb().select({ id: runs.id }).from(runs).where(eq(runs.workItemId, workItem.id)))
      )
    )
    .returning({ runId: questions.runId });
  if (closed.length === 0) {
    return;
  }
  log('info', 'open questions closed', { issue: workItem.issueIdentifier, count: closed.length });
  const runIds = [...new Set(closed.map(({ runId }) => runId))];
  await Promise.all(runIds.map((runId) => refreshQuestionCard(project, workItem, runId)));
};

// One question in Linear as a select; the round's message in the thread moves on to it.
const askQuestion = async (
  project: FactoryConfig,
  workItem: WorkItem,
  question: AskedQuestion,
  round: AskedQuestion[],
  runId: string
): Promise<void> => {
  const { body, options } = questionElicitation(question, round);
  await Promise.all([
    postActivity(workItem, { type: 'elicitation', body }, options),
    getDb().update(questions).set({ askedAt: new Date() }).where(eq(questions.id, question.id))
  ]);
  await refreshQuestionCard(project, workItem, runId);
};

// Records the questions a run reported, posts the round's message in the thread and asks the first; a repeated report
// asks nothing new.
const startQuestions = async (
  project: FactoryConfig,
  workItem: WorkItem,
  run: Run,
  reported: Question[]
): Promise<void> => {
  const rows = await getDb()
    .insert(questions)
    .values(
      reported.map(({ prompt, topic, why, options }, index) => ({
        runId: run.id,
        position: index + 1,
        prompt,
        topic,
        why,
        options
      }))
    )
    .onConflictDoNothing()
    .returning();
  log('info', 'questions recorded', { runId: run.id, issue: workItem.issueIdentifier, count: rows.length });
  const round = rows.map(toAsked);
  const first = round.find(({ position }) => position === 1);
  if (!first) {
    return;
  }
  const card = slackQuestionCard(
    run.agent,
    round.map((question) => ({ ...question, closed: false })),
    workItem.issueUrl
  );
  const ts = await replyInThread(project, workItem, card);
  if (ts) {
    await getDb().update(questions).set({ slackTs: ts }).where(eq(questions.runId, run.id));
  }
  await askQuestion(project, workItem, first, round, run.id);
};

// The work item's open round: every question from the run that asked, answered or not.
const openRound = async (
  workItem: WorkItem
): Promise<{ runId: string; agent: AgentRole; round: AskedQuestion[] } | undefined> => {
  const [open] = await getDb()
    .select({ runId: questions.runId, agent: runs.agent })
    .from(questions)
    .innerJoin(runs, eq(questions.runId, runs.id))
    .where(and(eq(runs.workItemId, workItem.id), isNull(questions.answeredAt), isNull(questions.closedAt)))
    .orderBy(desc(questions.createdAt))
    .limit(1);
  if (!open) {
    return undefined;
  }
  const rows = await getDb().select().from(questions).where(eq(questions.runId, open.runId));
  return { ...open, round: rows.map(toAsked) };
};

const currentQuestion = (round: AskedQuestion[]): AskedQuestion | undefined =>
  round.filter(({ answer }) => answer === null).toSorted((a, b) => a.position - b.position)[0];

// A reply while questions are open answers the next one; the last answer starts the stage that asked, once.
// Returns false when nothing was open, so the reply goes the usual way.
const answerQuestion = async (project: FactoryConfig, workItem: WorkItem, body: string): Promise<boolean> => {
  const open = await openRound(workItem);
  const result = open && applyAnswer(open.round, body);
  if (!open || !result) {
    return false;
  }
  const now = new Date();
  const recorded = await Promise.all(
    result.answered.map(({ id, answer, answerSource }) =>
      getDb()
        .update(questions)
        .set({ answer, answerSource, answeredAt: now })
        .where(and(eq(questions.id, id), isNull(questions.answeredAt), isNull(questions.closedAt)))
        .returning({ id: questions.id })
    )
  );
  if (recorded.flat().length < result.answered.length) {
    // Another reply got there first; it carries the round on.
    log('warn', 'question already answered or closed', { issue: workItem.issueIdentifier, runId: open.runId });
    await refreshQuestionCard(project, workItem, open.runId);
    return true;
  }
  if (result.next) {
    await askQuestion(project, workItem, result.next, open.round, open.runId);
    return true;
  }
  const answered = open.round.map((question) => ({
    ...question,
    ...result.answered.find(({ id }) => id === question.id)
  }));
  log('info', 'questions answered', { issue: workItem.issueIdentifier, runId: open.runId, count: answered.length });
  await refreshQuestionCard(project, workItem, open.runId);
  await dispatchRun(project, await createRun(project, workItem, answeredRequest(open.agent, answered), open.runId));
  return true;
};

const createRun = async (
  project: FactoryConfig,
  workItem: WorkItem,
  request: RunRequest,
  parentRunId: string | null = null
): Promise<string> => {
  // New work on the item makes any questions still open moot.
  await closeOpenQuestions(project, workItem);
  const [run] = await getDb()
    .insert(runs)
    .values({
      workItemId: workItem.id,
      parentRunId,
      agent: request.agent,
      model: modelFor(project, request.agent, false),
      trigger: request.trigger,
      priority: request.priority,
      prompt: request.prompt,
      status: 'queued'
    })
    .returning({ id: runs.id });
  if (!run) {
    throw new Error('Inserting the run returned no row');
  }
  if (startsReviewLoop(request)) {
    await getDb()
      .update(workItems)
      .set({ reviewRounds: 0, updatedAt: new Date() })
      .where(eq(workItems.id, workItem.id));
  }
  log('info', 'run created', { runId: run.id, issue: workItem.issueIdentifier, trigger: request.trigger });
  return run.id;
};

// Cancel from the Runs page: the run and its Actions run, then a final word in Linear and Slack.
export const cancelRunFromConsole = async (runId: string, login: string): Promise<boolean> => {
  const found = await findRun(runId);
  const project = found && findProject(found.workItem.project);
  if (!found || !project || !isOpenRun(found.run.status)) {
    return false;
  }
  const text = stoppedText({ kind: 'console', login });
  if (!(await cancelRun(found.run, found.workItem, text, new Date()))) {
    return false;
  }
  await Promise.all([
    postActivity(found.workItem, { type: 'response', body: text }),
    replyInThread(project, found.workItem, text)
  ]);
  await releaseQueue();
  return true;
};

// Re-run from the Runs page: only a work item's latest run, and only when it ended badly (`canRerun`), so two stages
// never race and settled work isn't repeated.
export const rerunFromConsole = async (runId: string, login: string): Promise<boolean> => {
  const found = await findRun(runId);
  const project = found && findProject(found.workItem.project);
  if (!found || !project || isOpenRun(found.run.status)) {
    return false;
  }
  const [latest] = await getDb()
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.workItemId, found.workItem.id))
    .orderBy(desc(runs.createdAt))
    .limit(1);
  const allowed = canRerun(found.run, {
    stage: found.workItem.stage,
    hasPr: found.workItem.prNumber !== null,
    reviewRounds: found.workItem.reviewRounds,
    maxReviewRounds: project.review.maxRounds
  });
  if (latest?.id !== runId || !allowed) {
    return false;
  }
  log('info', 'run re-run from the console', { runId, login, issue: found.workItem.issueIdentifier });
  await dispatchRun(project, await createRun(project, found.workItem, consoleRerunRequest(found.run.agent), runId));
  return true;
};

// "Allow once" from the console: the run skips usage holds and the pause from now on, even if the run caps hold it first.
export const allowRunOnce = async (runId: string, login: string): Promise<boolean> => {
  const [allowed] = await getDb()
    .update(runs)
    .set({ usageOverrideBy: login })
    .where(and(eq(runs.id, runId), eq(runs.status, 'queued')))
    .returning({ workItemId: runs.workItemId });
  if (!allowed) {
    return false;
  }
  const [workItem] = await getDb().select().from(workItems).where(eq(workItems.id, allowed.workItemId)).limit(1);
  const project = workItem && findProject(workItem.project);
  log('info', 'run allowed once', { runId, login, issue: workItem?.issueIdentifier });
  if (project) {
    await dispatchRun(project, runId);
  }
  return true;
};

// Releases held runs, highest priority first, for as long as the governor allows.
export const releaseQueue = async (): Promise<void> => {
  const waiting = await getDb()
    .select({ runId: queue.runId, priority: queue.priority, heldAt: queue.heldAt, project: workItems.project })
    .from(queue)
    .innerJoin(runs, eq(queue.runId, runs.id))
    .innerJoin(workItems, eq(runs.workItemId, workItems.id))
    .where(isNull(queue.releasedAt));
  await orderQueue(waiting).reduce(async (previous, entry) => {
    await previous;
    const project = findProject(entry.project);
    if (project) {
      await dispatchRun(project, entry.runId);
    }
  }, Promise.resolve());
};

const upsertWorkItem = async (
  project: FactoryConfig,
  event: Extract<SessionEvent, { kind: 'created' }>,
  request: RunRequest
): Promise<WorkItem> => {
  const stage = stageForAgent(request.agent) ?? 'building';
  // A new session (re-delegation, or a mention) replaces the old one: it's where humans now expect replies.
  const current = {
    issueIdentifier: event.issue.identifier,
    issueUrl: event.issue.url,
    title: event.issue.title,
    agentSessionId: event.sessionId,
    stage,
    updatedAt: new Date()
  };
  const [workItem] = await getDb()
    .insert(workItems)
    .values({
      project: project.name,
      repository: repositoryOf(project),
      linearOrganizationId: event.organizationId,
      linearIssueId: event.issue.id,
      origin: 'linear',
      requester: event.requester,
      ...current
    })
    .onConflictDoUpdate({ target: workItems.linearIssueId, set: current })
    .returning();
  if (!workItem) {
    throw new Error('Upserting the work item returned no row');
  }
  return workItem;
};

const startFromSession = async (event: Extract<SessionEvent, { kind: 'created' }>): Promise<void> => {
  const project = findProjectByTeamKey(event.issue.teamKey);
  if (!project) {
    log('warn', 'agent session for a team with no factory project', { teamKey: event.issue.teamKey });
    await createAgentActivity(event.organizationId, event.sessionId, {
      type: 'error',
      body: `The ${event.issue.teamKey} team isn’t set up in the factory, so I can’t work on this.`
    });
    return;
  }
  // A new delegation on an issue the factory already worked on carries on from where it stood.
  const [existing] = await getDb()
    .select({ stage: workItems.stage })
    .from(workItems)
    .where(eq(workItems.linearIssueId, event.issue.id))
    .limit(1);
  const request = runRequestFor(event, existing?.stage);
  if (!request) {
    throw new Error('A delegation always yields a run request');
  }
  const workItem = await upsertWorkItem(project, event, request);
  await openSlackThread(project, workItem, event.issue.title);
  await dispatchRun(project, await createRun(project, workItem, request));
};

const cancelRun = async (run: Run, workItem: WorkItem, summary: string, now: Date): Promise<boolean> => {
  const db = getDb();
  const canceled = await db
    .update(runs)
    .set({ status: 'canceled', summary, finishedAt: now })
    .where(and(eq(runs.id, run.id), eq(runs.status, run.status)))
    .returning({ id: runs.id });
  if (canceled.length === 0) {
    return false;
  }
  await db
    .update(queue)
    .set({ releasedAt: now })
    .where(and(eq(queue.runId, run.id), isNull(queue.releasedAt)));
  if (run.actionsRunId) {
    const actionsRunId = run.actionsRunId;
    await attempt('actions run cancel', { runId: run.id }, () => cancelActionsRun(workItem.repository, actionsRunId));
  }
  log('info', 'run canceled', { runId: run.id, issue: workItem.issueIdentifier, from: run.status, summary });
  return true;
};

// Cancels the work item's queued and active runs; returns how many it canceled.
const cancelOpenRuns = async (workItem: WorkItem, summary: string): Promise<number> => {
  const open = await getDb()
    .select()
    .from(runs)
    .where(and(eq(runs.workItemId, workItem.id), inArray(runs.status, OPEN_STATUSES)));
  const now = new Date();
  const canceled = await Promise.all(open.map((run) => cancelRun(run, workItem, summary, now)));
  return canceled.filter(Boolean).length;
};

const stopWorkItem = async (project: FactoryConfig, workItem: WorkItem): Promise<void> => {
  await Promise.all([closeOpenQuestions(project, workItem), cancelOpenRuns(workItem, 'Stopped from Linear.')]);
  // Linear expects a final activity after a stop, whether or not anything was running.
  await Promise.all([
    postActivity(workItem, { type: 'response', body: STOPPED_RESPONSE }),
    replyInThread(project, workItem, 'Stopped from Linear.')
  ]);
  await releaseQueue();
};

// Stops work for a reason outside the session; says so only if something was running or queued.
const stopForCause = async (project: FactoryConfig, workItem: WorkItem, cause: StopCause): Promise<void> => {
  const text = stoppedText(cause);
  await closeOpenQuestions(project, workItem);
  if ((await cancelOpenRuns(workItem, text)) === 0) {
    return;
  }
  await Promise.all([postActivity(workItem, { type: 'response', body: text }), replyInThread(project, workItem, text)]);
  await releaseQueue();
};

// Records the stage without moving the Linear issue: the event came from Linear or GitHub, which already show it.
const recordStage = async (workItem: WorkItem, stage: Stage, cause: string): Promise<void> => {
  await getDb().update(workItems).set({ stage, updatedAt: new Date() }).where(eq(workItems.id, workItem.id));
  log('info', 'work item stage followed', { issue: workItem.issueIdentifier, from: workItem.stage, to: stage, cause });
};

export const handleAgentSessionEvent = async (payload: unknown): Promise<void> => {
  const event = parseSessionEvent(payload);
  if (!event) {
    return;
  }
  // The OAuth callback only installs into this workspace; this keeps any other install from reaching a project.
  if (event.organizationId !== requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID')) {
    log('warn', 'agent session from another Linear workspace ignored', { organizationId: event.organizationId });
    return;
  }
  if (event.kind === 'created') {
    await startFromSession(event);
    return;
  }
  const [workItem] = await getDb()
    .select()
    .from(workItems)
    .where(and(eq(workItems.agentSessionId, event.sessionId), eq(workItems.linearOrganizationId, event.organizationId)))
    .limit(1);
  const project = workItem && findProject(workItem.project);
  if (!workItem || !project) {
    log('warn', 'prompt for a session with no work item', { agentSessionId: event.sessionId, kind: event.kind });
    return;
  }
  if (event.kind === 'stop') {
    await stopWorkItem(project, workItem);
    return;
  }
  await handleReply(project, workItem, event.body, { via: 'linear' });
};

type ReplyFrom = { via: 'linear' } | { via: 'slack'; name: string };

// The spec gate's message in the thread, once the gate is answered from anywhere.
const settleSpecGate = async (
  project: FactoryConfig,
  workItem: WorkItem,
  request: RunRequest | undefined,
  from: ReplyFrom
): Promise<void> => {
  const ts = workItem.specGateSlackTs;
  if (workItem.stage !== 'spec_review' || !ts) {
    return;
  }
  const by = from.via === 'slack' ? `by ${from.name}` : 'in Linear';
  await Promise.all([
    editInThread(
      project,
      workItem,
      ts,
      slackSpecGateSettled(request?.trigger === 'spec_approved' ? 'approved' : 'changes', by, specUrl(workItem))
    ),
    getDb().update(workItems).set({ specGateSlackTs: null }).where(eq(workItems.id, workItem.id))
  ]);
};

// A human's reply, from the Linear session or the Slack thread: mirrored to the other, then it answers the open
// question, or the spec gate, or goes to the agent for the work item's stage.
const handleReply = async (project: FactoryConfig, workItem: WorkItem, body: string, from: ReplyFrom) => {
  await (from.via === 'linear'
    ? replyInThread(project, workItem, slackReplyText(body, workItem.issueUrl))
    : postActivity(workItem, { type: 'thought', body: linearSlackReplyText(from.name, body) }));
  if (await answerQuestion(project, workItem, body)) {
    return;
  }
  const request = runRequestFor({ kind: 'prompted', body }, workItem.stage);
  await settleSpecGate(project, workItem, request, from);
  if (!request) {
    // The Change something option on its own: ask what to change, and keep waiting in Spec Review.
    await Promise.all([
      postActivity(workItem, { type: 'elicitation', body: CHANGES_QUESTION }),
      replyInThread(project, workItem, CHANGES_QUESTION)
    ]);
    return;
  }
  await dispatchRun(project, await createRun(project, workItem, request));
};

// A person's reply in a work item's thread steers the work like a reply in Linear, if they're on the allow-list.
export const handleSlackMessage = async (payload: unknown): Promise<void> => {
  const reply = parseSlackThreadReply(payload);
  if (!reply) {
    return;
  }
  const [workItem] = await getDb()
    .select()
    .from(workItems)
    .where(and(eq(workItems.slackChannelId, reply.channel), eq(workItems.slackThreadTs, reply.threadTs)))
    .limit(1);
  const project = workItem && findProject(workItem.project);
  if (!workItem || !project) {
    return;
  }
  if (!isAllowedSlackUser(project, reply.userId)) {
    log('info', 'slack reply from someone not allowed', { issue: workItem.issueIdentifier, user: reply.userId });
    await attempt('slack ephemeral', { issue: workItem.issueIdentifier }, () =>
      postSlackEphemeral({
        channel: reply.channel,
        user: reply.userId,
        text: notAllowedText(project),
        threadTs: reply.threadTs
      })
    );
    return;
  }
  const name = await slackUserName(reply.userId).catch(() => reply.userId);
  log('info', 'slack reply', { issue: workItem.issueIdentifier, user: reply.userId });
  await handleReply(project, workItem, reply.body, { via: 'slack', name });
};

const findQuestionWithWorkItem = async (questionId: string) => {
  const [found] = await getDb()
    .select({ question: questions, workItem: workItems })
    .from(questions)
    .innerJoin(runs, eq(questions.runId, runs.id))
    .innerJoin(workItems, eq(runs.workItemId, workItems.id))
    .where(eq(questions.id, questionId))
    .limit(1);
  return found;
};

const findWorkItemById = async (id: string): Promise<WorkItem | undefined> => {
  const [workItem] = await getDb().select().from(workItems).where(eq(workItems.id, id)).limit(1);
  return workItem;
};

// A tap on a question's or the spec gate's button. Only the current question and a spec still in review take an
// answer; the messages themselves are redrawn by the answer, wherever it came from.
export const handleSlackAction = async (payload: unknown): Promise<void> => {
  const action = parseSlackAction(payload);
  if (!action) {
    return;
  }
  const tellTapper = (text: string) =>
    attempt('slack action response', { user: action.userId }, () => respondToSlackAction(action.responseUrl, text));
  const tapped = action.kind === 'question' ? await findQuestionWithWorkItem(action.questionId) : undefined;
  const workItem = action.kind === 'question' ? tapped?.workItem : await findWorkItemById(action.workItemId);
  const project = workItem && findProject(workItem.project);
  if (!workItem || !project) {
    return;
  }
  if (!isAllowedSlackUser(project, action.userId)) {
    log('info', 'slack tap from someone not allowed', { issue: workItem.issueIdentifier, user: action.userId });
    await tellTapper(notAllowedText(project));
    return;
  }
  log('info', 'slack tap', { issue: workItem.issueIdentifier, user: action.userId, kind: action.kind });
  if (action.kind === 'spec_gate' && workItem.stage !== 'spec_review') {
    await tellTapper(SPEC_GATE_GONE);
    return;
  }
  if (action.kind === 'question') {
    const open = await openRound(workItem);
    if (!tapped || currentQuestion(open?.round ?? [])?.id !== action.questionId) {
      await tellTapper(QUESTION_GONE);
      if (tapped) {
        await refreshQuestionCard(project, workItem, tapped.question.runId);
      }
      return;
    }
  }
  const name = await slackUserName(action.userId).catch(() => action.userId);
  await handleReply(project, workItem, action.body, { via: 'slack', name });
};

// After a run reports: close the session if the agent didn't, mirror to Slack, start the next stage or resume a
// limit-hit run, free its slot.
export const handleRunFinished = async (runId: string): Promise<void> => {
  const found = await findRun(runId);
  const project = found && findProject(found.workItem.project);
  if (!found || !project) {
    return;
  }
  const { run, workItem } = found;
  const resuming = shouldResume(run);
  const next = nextStepAfterRun(run, {
    hasPr: workItem.prNumber !== null,
    reviewRounds: workItem.reviewRounds,
    maxReviewRounds: project.review.maxRounds
  });
  // Reported questions are the run's last word: the router asks them instead of closing the session.
  const agentClosed =
    !next.questions && run.status === 'finished' && workItem.agentSessionId && run.startedAt
      ? await hasClosingActivity(workItem.linearOrganizationId, workItem.agentSessionId, run.startedAt).catch(
          (error: unknown) => {
            log('error', 'linear session check failed', { runId, error: errorMessage(error) });
            return true;
          }
        )
      : false;
  const closing = next.questions ? undefined : closingActivity(run, { agentClosed, resuming });
  const prUrl = workItem.prNumber ? `https://github.com/${workItem.repository}/pull/${workItem.prNumber}` : null;
  if (next.reviewRounds !== undefined) {
    // Recorded before the revision dispatches, so its brief names the round it's fixing.
    await getDb()
      .update(workItems)
      .set({ reviewRounds: next.reviewRounds, updatedAt: new Date() })
      .where(eq(workItems.id, workItem.id));
  }

  await Promise.all([
    closing ? postActivity(workItem, closing) : undefined,
    replyInThread(
      project,
      workItem,
      slackFinishedText({ ...run, prUrl, actionsRunUrl: run.actionsRunUrl }, next.questions?.length)
    ),
    next.stage ? moveWorkItem(project, workItem, next.stage) : undefined
  ]);
  if (next.questions) {
    await startQuestions(project, workItem, run, next.questions);
  }
  if (next.stage === 'spec_review') {
    const gate = slackSpecGateMessage(workItem.id, {
      specUrl: specUrl(workItem),
      prUrl,
      issueUrl: workItem.issueUrl
    });
    const ts = await replyInThread(project, workItem, gate);
    await getDb()
      .update(workItems)
      .set({ specGateSlackTs: ts ?? null })
      .where(eq(workItems.id, workItem.id));
  }
  if (next.request) {
    await dispatchRun(project, await createRun(project, workItem, next.request, run.id));
  }
  if (resuming) {
    await dispatchRun(project, await createRun(project, workItem, resumeRequestFor(run.agent), run.id));
  }
  await releaseQueue();
};

// A human's status change or undelegation in Linear. Issues the factory never worked on have no work item.
export const handleIssueUpdate = async (payload: unknown): Promise<void> => {
  const update = parseIssueUpdate(payload);
  if (!update || update.organizationId !== requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID')) {
    return;
  }
  const [workItem] = await getDb()
    .select()
    .from(workItems)
    .where(and(eq(workItems.linearIssueId, update.issueId), eq(workItems.linearOrganizationId, update.organizationId)))
    .limit(1);
  const project = workItem && findProject(workItem.project);
  if (!workItem || !project) {
    return;
  }
  const actions = decideIssueUpdate(update, {
    config: project,
    appUserId: await findAppUserId(update.organizationId),
    stage: workItem.stage
  });
  if (actions.stage) {
    await recordStage(workItem, actions.stage, 'linear status');
  }
  if (actions.stop) {
    await stopForCause(project, workItem, actions.stop);
  }
};

const findWorkItemForPr = async (event: Extract<GitHubEvent, { kind: 'pr_closed' }>): Promise<WorkItem | undefined> => {
  const [workItem] = await getDb()
    .select()
    .from(workItems)
    .where(
      and(
        eq(workItems.repository, event.repository),
        or(eq(workItems.prNumber, event.number), and(isNull(workItems.prNumber), eq(workItems.branch, event.branch)))
      )
    )
    .orderBy(desc(workItems.updatedAt))
    .limit(1);
  return workItem;
};

const handleCiFailure = async (event: Extract<GitHubEvent, { kind: 'ci_failed' }>): Promise<void> => {
  const [workItem] = await getDb()
    .select()
    .from(workItems)
    .where(and(eq(workItems.repository, event.repository), inArray(workItems.prNumber, event.prNumbers)))
    .limit(1);
  const project = workItem && findProject(workItem.project);
  if (!workItem || !project) {
    return;
  }
  const history = await getDb()
    .select({ agent: runs.agent, trigger: runs.trigger, status: runs.status })
    .from(runs)
    .where(eq(runs.workItemId, workItem.id))
    .orderBy(desc(runs.createdAt));
  const action = decideCiFailure(event, {
    stage: workItem.stage,
    openRuns: history.filter(({ status }) => OPEN_STATUSES.includes(status)).length,
    ciFixes: consecutiveCiFixes(history)
  });
  log('info', 'ci failure', { issue: workItem.issueIdentifier, workflow: event.workflow, action: action.kind });
  if (action.kind === 'fix') {
    await dispatchRun(project, await createRun(project, workItem, action.request));
    return;
  }
  if (action.kind === 'hand_over') {
    const text = ciHandOverText(event.workflow, event.url);
    await Promise.all([postActivity(workItem, { type: 'error', body: text }), replyInThread(project, workItem, text)]);
  }
};

// A factory PR merged or closed settles its work item; a person pushing to its branch counts against autonomy; a
// failed check on a delivered PR goes back to implement.
export const handleGitHubEvent = async (eventName: string, payload: unknown): Promise<void> => {
  const event = parseGitHubEvent(eventName, payload);
  if (!event) {
    return;
  }
  if (event.kind === 'ci_failed') {
    await handleCiFailure(event);
    return;
  }
  if (event.kind === 'human_push') {
    const pushed = await getDb()
      .update(workItems)
      .set({ humanPushes: sql`${workItems.humanPushes} + 1`, updatedAt: new Date() })
      .where(and(eq(workItems.repository, event.repository), eq(workItems.branch, event.branch)))
      .returning({ issue: workItems.issueIdentifier });
    if (pushed.length > 0) {
      log('info', 'human push recorded', {
        issues: pushed.map(({ issue }) => issue),
        login: event.login,
        commits: event.commits
      });
    }
    return;
  }
  const workItem = await findWorkItemForPr(event);
  const project = workItem && findProject(workItem.project);
  if (!workItem || !project) {
    return;
  }
  const stage = stageAfterPrClosed(workItem.stage, event.merged);
  if (stage) {
    await recordStage(workItem, stage, event.merged ? 'pr merged' : 'pr closed');
  }
  await replyInThread(project, workItem, prClosedText(event.number, event.merged));
  await stopForCause(project, workItem, { kind: 'pr_closed', number: event.number, merged: event.merged });
};
