import type {
  FactoryConfig,
  GovernedDecision,
  RunRequest,
  RunStatus,
  SessionEvent,
  UsageReading,
  UsageWindow
} from '@mb-factory/core';
import {
  buildDispatchPayload,
  closingActivity,
  governDispatch,
  linearStatusFor,
  modelFor,
  orderQueue,
  parseSessionEvent,
  queuedThought,
  resumeRequestFor,
  runRequestFor,
  STOPPED_RESPONSE,
  shouldMoveIssue,
  shouldResume,
  slackFinishedText,
  slackStartedText,
  slackThreadText,
  stageForAgent,
  startedThought,
  USAGE_WINDOWS
} from '@mb-factory/core';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { queue, runs, usageReadings, workItems } from '@/db/schema';

import { requireEnv } from './env';
import { cancelActionsRun, sendStageDispatch } from './github-api';
import type { AgentActivityContent } from './linear-api';
import { createAgentActivity, hasClosingActivity, moveIssueToStatus } from './linear-api';
import { log } from './log';
import { findProject, findProjectByTeamKey, repositoryOf } from './projects';
import type { RunWithWorkItem } from './runs';
import { findRun } from './runs';
import { postSlackMessage } from './slack-api';

type WorkItem = typeof workItems.$inferSelect;
type Run = typeof runs.$inferSelect;

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

const postActivity = (workItem: WorkItem, content: AgentActivityContent) => {
  const { agentSessionId } = workItem;
  return agentSessionId
    ? attempt('linear activity', { issue: workItem.issueIdentifier, type: content.type }, () =>
        createAgentActivity(workItem.linearOrganizationId, agentSessionId, content)
      )
    : Promise.resolve();
};

const replyInThread = (project: FactoryConfig, workItem: WorkItem, text: string) => {
  const channel = workItem.slackChannelId ?? project.slack?.channelId;
  const threadTs = workItem.slackThreadTs;
  return channel && threadTs
    ? attempt('slack reply', { issue: workItem.issueIdentifier }, () => postSlackMessage({ channel, text, threadTs }))
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

const latestReadings = async (): Promise<Partial<Record<UsageWindow, UsageReading>>> => {
  const latest = await Promise.all(
    USAGE_WINDOWS.map(async (window) => {
      const [row] = await getDb()
        .select()
        .from(usageReadings)
        .where(eq(usageReadings.window, window))
        .orderBy(desc(usageReadings.takenAt))
        .limit(1);
      return row;
    })
  );
  return Object.fromEntries(
    latest
      .filter((row) => row !== undefined)
      .map(({ window, utilisation, resetsAt, takenAt, source }) => [
        window,
        { window, utilisation, resetsAt, takenAt, source }
      ])
  );
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
      branch: workItem.branch ?? undefined
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
    replyInThread(project, workItem, slackStartedText(run.agent)),
    stage ? db.update(workItems).set({ stage, updatedAt: now }).where(eq(workItems.id, workItem.id)) : undefined,
    stage
      ? attempt('linear status', { issue: workItem.issueIdentifier }, async () => {
          const move = await moveIssueToStatus(
            workItem.linearOrganizationId,
            workItem.linearIssueId,
            linearStatusFor(project, stage),
            shouldMoveIssue
          );
          log('info', 'linear status', { issue: workItem.issueIdentifier, stage, ...move });
        })
      : undefined
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
  const [readings, runningCount, busyCount] = await Promise.all([
    latestReadings(),
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
    workItemBusy: busyCount > 0
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

const createRun = async (
  project: FactoryConfig,
  workItem: WorkItem,
  request: RunRequest,
  parentRunId: string | null = null
): Promise<string> => {
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
  log('info', 'run created', { runId: run.id, issue: workItem.issueIdentifier, trigger: request.trigger });
  return run.id;
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
  const request = runRequestFor(event);
  const workItem = await upsertWorkItem(project, event, request);
  await openSlackThread(project, workItem, event.issue.title);
  await dispatchRun(project, await createRun(project, workItem, request));
};

const cancelRun = async (run: Run, workItem: WorkItem, now: Date): Promise<void> => {
  const db = getDb();
  const canceled = await db
    .update(runs)
    .set({ status: 'canceled', summary: 'Stopped from Linear.', finishedAt: now })
    .where(and(eq(runs.id, run.id), eq(runs.status, run.status)))
    .returning({ id: runs.id });
  if (canceled.length === 0) {
    return;
  }
  await db
    .update(queue)
    .set({ releasedAt: now })
    .where(and(eq(queue.runId, run.id), isNull(queue.releasedAt)));
  if (run.actionsRunId) {
    const actionsRunId = run.actionsRunId;
    await attempt('actions run cancel', { runId: run.id }, () => cancelActionsRun(workItem.repository, actionsRunId));
  }
  log('info', 'run canceled', { runId: run.id, issue: workItem.issueIdentifier, from: run.status });
};

const stopWorkItem = async (project: FactoryConfig, workItem: WorkItem): Promise<void> => {
  const open = await getDb()
    .select()
    .from(runs)
    .where(and(eq(runs.workItemId, workItem.id), inArray(runs.status, OPEN_STATUSES)));
  const now = new Date();
  await Promise.all(open.map((run) => cancelRun(run, workItem, now)));
  // Linear expects a final activity after a stop, whether or not anything was running.
  await Promise.all([
    postActivity(workItem, { type: 'response', body: STOPPED_RESPONSE }),
    replyInThread(project, workItem, 'Stopped from Linear.')
  ]);
  await releaseQueue();
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
  await dispatchRun(project, await createRun(project, workItem, runRequestFor(event)));
};

// After a run reports: close the session if the agent didn't, mirror to Slack, resume a limit-hit run, free its slot.
export const handleRunFinished = async (runId: string): Promise<void> => {
  const found = await findRun(runId);
  const project = found && findProject(found.workItem.project);
  if (!found || !project) {
    return;
  }
  const { run, workItem } = found;
  const resuming = shouldResume(run);
  const agentClosed =
    run.status === 'finished' && workItem.agentSessionId && run.startedAt
      ? await hasClosingActivity(workItem.linearOrganizationId, workItem.agentSessionId, run.startedAt).catch(
          (error: unknown) => {
            log('error', 'linear session check failed', { runId, error: errorMessage(error) });
            return true;
          }
        )
      : false;
  const closing = closingActivity(run, { agentClosed, resuming });
  const prUrl = workItem.prNumber ? `https://github.com/${workItem.repository}/pull/${workItem.prNumber}` : null;

  await Promise.all([
    closing ? postActivity(workItem, closing) : undefined,
    replyInThread(project, workItem, slackFinishedText({ ...run, prUrl, actionsRunUrl: run.actionsRunUrl }))
  ]);
  if (resuming) {
    await dispatchRun(project, await createRun(project, workItem, resumeRequestFor(run.agent), run.id));
  }
  await releaseQueue();
};
