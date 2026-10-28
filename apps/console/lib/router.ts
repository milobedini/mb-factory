import type {
  AgentRole,
  AskedQuestion,
  DependencyPr,
  DependencyWork,
  FactoryConfig,
  FiledIssue,
  Gate,
  GitHubEvent,
  GovernedDecision,
  NextIssue,
  Question,
  ReadyIssue,
  ReadyOutcome,
  ReviewFinding,
  RunOutcome,
  RunRequest,
  RunStatus,
  RunTrigger,
  SessionEvent,
  SlackAction,
  SlackMessage,
  Stage,
  StopCause,
  VerifyDecision
} from '@mb-factory/core';
import {
  ASK_TICKET_GONE,
  afterAnswers,
  alreadyStartedText,
  applyAnswer,
  approveRefusedText,
  askFailedText,
  askTicketIssue,
  BLOCKING_OUTCOMES,
  briefRound,
  buildDispatchPayload,
  CHANGES_QUESTION,
  canRerun,
  chosenFollowUps,
  ciHandOverText,
  clock,
  closedLine,
  closingActivity,
  coAuthorFor,
  conflictFixesSince,
  conflictHandOverText,
  connectGitHubMessage,
  consecutiveCiFixes,
  consoleRerunRequest,
  DEPENDABOT_LOGIN,
  decideCiFailure,
  decideConflict,
  decideIssueUpdate,
  decideVerify,
  delegateFailedText,
  dependencyIssue,
  dependencyTakenText,
  dispatchLapsesAt,
  emptyMentionText,
  escapeSlack,
  failedChecks,
  filedChoiceMessage,
  filedFollowUpsText,
  filedForLaterMessage,
  filedIssueClosedText,
  filedStartedMessage,
  findingsPrompt,
  formatReleaseAt,
  GATE_CHANGES_QUESTION,
  GATE_GONE,
  governDispatch,
  isAllowedSlackUser,
  isMajorBump,
  isOpenRun,
  isReadyRequest,
  keptText,
  latestSpecParts,
  linearSlackReplyText,
  linearStatusFor,
  MAX_READY_ROWS,
  mentioning,
  mergeButton,
  mergedLine,
  mergeNotSetUpText,
  mergeRefusal,
  mergeRefusedText,
  metEveryCriterion,
  modelFor,
  movedOnLine,
  neutraliseMarkdown,
  nextStepAfterRun,
  notAllowedText,
  notAllowedToStartText,
  nothingReadyText,
  notReadyText,
  notWaitingToMergeText,
  onlyAsksForChanges,
  onlyLockfilesChanged,
  orderQueue,
  parseGitHubEvent,
  parseIssueUpdate,
  parseSessionEvent,
  parseSlackAction,
  parseSlackMention,
  parseSlackThreadReply,
  partDescription,
  partsFiledText,
  personForGitHub,
  personForSlack,
  personName,
  prClosedText,
  QUESTION_GONE,
  questionElicitation,
  queuedAlready,
  queuedThought,
  READY_HEADING,
  READY_UNREADABLE,
  RERUN_GONE,
  readAskReport,
  readBeforeMerging,
  readBump,
  readFixableFindings,
  readGate,
  readNextIssues,
  readQuestions,
  resumeRequestFor,
  retryText,
  reverifiesOnRequest,
  reviewersFor,
  reviewThreadsToResolve,
  reviewVerdict,
  runRequestFor,
  SPEC_GATE_GONE,
  STOPPED_RESPONSE,
  settleReadyMessage,
  shouldMoveIssue,
  shouldResume,
  shouldRetry,
  slackAcceptedMessage,
  slackFindingsMessage,
  slackFindingsSettled,
  slackFinishedText,
  slackGateMessage,
  slackGateSettled,
  slackIssueFromRequest,
  slackMentionFor,
  slackMergeSettled,
  slackQuestionCard,
  slackReplyText,
  slackSpecGateMessage,
  slackSpecGateSettled,
  slackThreadText,
  specUrl,
  stageAfterPrClosed,
  stageForAgent,
  startedThought,
  startsReviewLoop,
  stoppedText,
  TERMINAL_STAGES,
  unblockedBy,
  unblockedHeading,
  withFindings,
  withRerunButton,
  wrongChannelText
} from '@mb-factory/core';
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { asks, events, questions, queue, runs, stageChanges, workItems } from '@/db/schema';

import {
  answerMessageFor,
  askContextFor,
  findAskById,
  findAskByRun,
  findAskByThread,
  refreshAskCard,
  runOf
} from './ask-runs';
import { requireEnv } from './env';
import { fileFollowUps, fileRequestedIssues } from './follow-ups';
import {
  approvePull,
  branchChecks,
  branchContains,
  cancelActionsRun,
  commentOnPullRequest,
  commitParents,
  commitRuns,
  compareFiles,
  defaultBranch,
  mergePull,
  openPullsWithHead,
  pullFiles,
  pullForMerge,
  pullHead,
  pullMergeState,
  pullRequestInfo,
  pullReviewThreads,
  requestReviewers,
  resolveReviewThread,
  sendStageDispatch
} from './github-api';
import { connectStartUrl, userGitHubToken } from './github-connect';
import { fileGuards } from './guards';
import { publishHome } from './home';
import { findJob, jobBriefFor, jobTitleOf, postJobMessage } from './job-runs';
import type { AgentActivityContent } from './linear-api';
import {
  createAgentActivity,
  createIssue,
  createSessionOnIssue,
  delegateIssue,
  fileSubIssues,
  findAppUserId,
  findUserIdByEmail,
  hasClosingActivity,
  issueAssigneeEmail,
  issueToStart,
  moveIssueToStatus,
  setBlockedLabel
} from './linear-api';
import { log } from './log';
import { currentPause, pauseFactory, resumeFactory } from './pause';
import { allProjects, findProject, findProjectBySlackChannel, findProjectByTeamKey, repositoryOf } from './projects';
import { loadReadyList, postReadyMessage, readyMessage } from './ready';
import { touchCard, withCards } from './redraw';
import type { RunWithWorkItem } from './runs';
import { findAnyRun, findRun } from './runs';
import {
  addSlackReaction,
  postSlackEphemeral,
  postSlackMessage,
  respondToSlack,
  slackPermalink,
  slackThreadMessage,
  slackUser,
  slackUserName,
  updateSlackMessage
} from './slack-api';
import { latestReadings } from './usage';
import { bookWake } from './wake';

type WorkItem = typeof workItems.$inferSelect;
type Run = typeof runs.$inferSelect;
type QuestionRow = typeof questions.$inferSelect;

const ACTIVE_STATUSES: RunStatus[] = ['dispatched', 'running'];
// Linear's state types for an issue that no longer blocks anything.
const FINISHED_STATE_TYPES = ['completed', 'canceled'];
const OPEN_STATUSES: RunStatus[] = ['queued', ...ACTIVE_STATUSES];

// Drizzle wraps a failed query in "Failed query: …" and keeps what went wrong in `cause`.
const errorMessage = (error: unknown): string =>
  error instanceof Error
    ? `${error.message}${error.cause instanceof Error ? ` (cause: ${error.cause.message})` : ''}`
    : String(error);

// Side effects that report on work (Linear, Slack) must not stop the work itself.
const attempt = async (label: string, fields: Record<string, unknown>, effect: () => Promise<unknown>) => {
  try {
    await effect();
  } catch (error) {
    log('error', `${label} failed`, { ...fields, error: errorMessage(error) });
  }
};

// For the dashboard's stage times. A repeat of the work item's latest stage is skipped, so a move the router made and
// then hears about again counts once. Never fails the step it records.
const recordStageChange = (workItem: Pick<WorkItem, 'id' | 'issueIdentifier'>, stage: Stage, cause: string) =>
  attempt('stage change', { issue: workItem.issueIdentifier, stage }, () =>
    getDb().execute(sql`
      insert into ${stageChanges} (work_item_id, stage, cause)
      select ${workItem.id}::uuid, ${stage}::text, ${cause}::text
      where (
        select latest.stage from ${stageChanges} as latest
        where latest.work_item_id = ${workItem.id}
        order by latest.at desc
        limit 1
      ) is distinct from ${stage}::text
    `)
  );

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
  // Anything worth saying in the thread changes what the card shows.
  touchCard(workItem.id);
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

// The person a work item waits on, mentioned so Slack notifies them: its Linear assignee, when the project lists their
// Slack ID.
const askingFor =
  (project: FactoryConfig, workItem: WorkItem) =>
  <M extends string | SlackMessage>(message: M): M =>
    mentioning(message, slackMentionFor(project, workItem.assigneeEmail));

const editInThread = (project: FactoryConfig, workItem: WorkItem, ts: string, message: SlackMessage) => {
  touchCard(workItem.id);
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
    touchCard(workItem.id);
  });
};

// Holds a run in the queue, books a wake-up for when the hold should lift, and says so once with `tell`: in the work
// item's session and thread, or a job's channel.
const holdRun = async (
  run: Run,
  decision: Extract<GovernedDecision, { kind: 'hold' }>,
  tell: () => Promise<unknown>
): Promise<void> => {
  touchCard(run.workItemId);
  const db = getDb();
  const held = await db
    .insert(queue)
    .values({ runId: run.id, priority: run.priority, reason: decision.reason, releaseAt: decision.releaseAt })
    .onConflictDoNothing()
    .returning({ id: queue.id });
  log('info', 'run held', { runId: run.id, workItemId: run.workItemId, job: run.job, reason: decision.reason });
  if (decision.releaseAt) {
    // Wakes the console when the hold should lift, whether or not anything else happens by then.
    await bookWake(decision.releaseAt, decision.reason);
  }
  if (held.length === 0) {
    // Already waiting: keep the reason current, and don't repeat the message.
    await db
      .update(queue)
      .set({ reason: decision.reason, releaseAt: decision.releaseAt ?? null })
      .where(and(eq(queue.runId, run.id), isNull(queue.releasedAt)));
    return;
  }
  await tell();
};

// The merge gate is the one that waits on GitHub, so its reviewers are asked there.
const requestMergeReview = (project: FactoryConfig, workItem: WorkItem) => {
  const reviewers = reviewersFor(project, workItem.repository);
  const { prNumber } = workItem;
  return prNumber && reviewers.length > 0
    ? attempt('github review request', { issue: workItem.issueIdentifier, pr: prNumber }, async () => {
        await requestReviewers(workItem.repository, prNumber, reviewers);
        log('info', 'github review requested', { issue: workItem.issueIdentifier, pr: prNumber, reviewers });
      })
    : undefined;
};

// When anything last landed on a branch, from the recorded push webhooks.
const branchMovedAt = async (repository: string, branch: string): Promise<Date | null> => {
  const [latest] = await getDb()
    .select({ at: events.receivedAt })
    .from(events)
    .where(
      and(
        eq(events.source, 'github'),
        eq(events.type, 'push'),
        sql`${events.payload}->'repository'->>'full_name' = ${repository}`,
        sql`${events.payload}->>'ref' = ${`refs/heads/${branch}`}`
      )
    )
    .orderBy(desc(events.receivedAt))
    .limit(1);
  return latest?.at ?? null;
};

type ConflictCheck = 'clean' | 'fixing' | 'handed_over' | 'left';

// A delivered PR that no longer merges goes back to implement, once for each state of its base branch, then to a
// person. A PR GitHub can't decide on yet counts as clean: the next push to the base branch or the gate asks again.
const checkConflict = async (project: FactoryConfig, workItem: WorkItem): Promise<ConflictCheck> => {
  const { prNumber } = workItem;
  if (!prNumber) {
    return 'clean';
  }
  const state = await pullMergeState(workItem.repository, prNumber).catch((error: unknown) => {
    log('warn', 'merge state check failed', { issue: workItem.issueIdentifier, error: errorMessage(error) });
    return undefined;
  });
  if (state?.mergeable === null) {
    log('warn', 'merge state unknown', { issue: workItem.issueIdentifier, pr: prNumber });
  }
  if (state?.mergeable !== false) {
    return 'clean';
  }
  const [history, movedAt] = await Promise.all([
    getDb()
      .select({ agent: runs.agent, trigger: runs.trigger, status: runs.status, createdAt: runs.createdAt })
      .from(runs)
      .where(eq(runs.workItemId, workItem.id)),
    branchMovedAt(workItem.repository, state.base)
  ]);
  const action = decideConflict(
    { branch: state.base },
    {
      stage: workItem.stage,
      openRuns: history.filter(({ status }) => OPEN_STATUSES.includes(status)).length,
      conflictFixes: conflictFixesSince(history, movedAt ?? new Date(0))
    }
  );
  log('info', 'merge conflict', { issue: workItem.issueIdentifier, base: state.base, action: action.kind });
  if (action.kind === 'fix') {
    await dispatchRun(project, await createRun(project, workItem, action.request));
    return 'fixing';
  }
  if (action.kind === 'hand_over') {
    const prUrl = `https://github.com/${workItem.repository}/pull/${prNumber}`;
    const text = conflictHandOverText(state.base, prUrl);
    await Promise.all([
      postActivity(workItem, { type: 'error', body: text }),
      replyInThread(project, workItem, askingFor(project, workItem)(text))
    ]);
    return 'handed_over';
  }
  return 'left';
};

// The review's threads, settled by the time nothing is left to decide, would otherwise hold the merge where the repo
// requires resolved conversations.
const resolveReviewThreads = (workItem: WorkItem) => {
  const { prNumber } = workItem;
  return prNumber
    ? attempt('resolve review threads', { issue: workItem.issueIdentifier, pr: prNumber }, async () => {
        const ids = reviewThreadsToResolve(await pullReviewThreads(workItem.repository, prNumber));
        await Promise.all(ids.map(resolveReviewThread));
        log('info', 'review threads resolved', { issue: workItem.issueIdentifier, pr: prNumber, count: ids.length });
      })
    : undefined;
};

// At the merge gate a PR that no longer merges goes back before anyone is asked to review it. With no question open,
// the review's threads are resolved; a question's thread waits for its answer. While review asks questions, merging the
// base waits for the answers (`keepReviewedPr`), since starting a run would close them unanswered.
const enterMergeGate = async (project: FactoryConfig, workItem: WorkItem, asking: boolean): Promise<void> => {
  if (
    !asking &&
    ((await checkConflict(project, workItem)) === 'fixing' || (await checkFailedChecks(project, workItem)) === 'fixing')
  ) {
    return;
  }
  if (!(await openRound(workItem))) {
    await resolveReviewThreads(workItem);
  }
  await requestMergeReview(project, workItem);
};

// Records the stage and moves the Linear issue to its status; a failed move is logged, not fatal. The merge gate's
// checks follow the move, since a conflict fix moves the work item on again.
const moveWorkItem = async (
  project: FactoryConfig,
  workItem: WorkItem,
  stage: Stage,
  { asking = false }: { asking?: boolean } = {}
): Promise<void> => {
  await moveTo(project, workItem, stage);
  if (stage === 'awaiting_merge') {
    await enterMergeGate(project, workItem, asking);
  }
};

const moveTo = async (project: FactoryConfig, workItem: WorkItem, stage: Stage): Promise<void> => {
  touchCard(workItem.id);
  await Promise.all([
    getDb().update(workItems).set({ stage, updatedAt: new Date() }).where(eq(workItems.id, workItem.id)),
    recordStageChange(workItem, stage, 'factory'),
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
  touchCard(workItem.id);
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
  touchCard(run.workItemId);
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

// Read fresh: the work item passed around may predate the accepted message.
const settleMovedOn = async (project: FactoryConfig, workItem: WorkItem, agent: AgentRole): Promise<void> => {
  const [current] = await getDb()
    .select({ mergeSlackTs: workItems.mergeSlackTs })
    .from(workItems)
    .where(eq(workItems.id, workItem.id));
  if (current?.mergeSlackTs) {
    await settleAcceptedMessage(project, { ...workItem, mergeSlackTs: current.mergeSlackTs }, movedOnLine(agent));
  }
};

const queuedRuns = (workItem: WorkItem) =>
  getDb()
    .select({ agent: runs.agent })
    .from(runs)
    .where(and(eq(runs.workItemId, workItem.id), eq(runs.status, 'queued')));

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
  const model = modelFor(project, run.agent, downshift, workItem.title);
  // Claim first: the stage workflow's start call only accepts a dispatched run.
  if (!(await claimRun(project, run, model, now))) {
    return 'not_claimed';
  }
  await db
    .update(queue)
    .set({ releasedAt: now })
    .where(and(eq(queue.runId, run.id), isNull(queue.releasedAt)));

  // Credits the person the work is for on its commits, and keeps who that is for the card and the Slack mention; a
  // lookup that fails only loses the credit, and keeps the last known assignee.
  const assigneeEmail =
    project.people.length > 0
      ? await issueAssigneeEmail(workItem.linearOrganizationId, workItem.linearIssueId).catch((error: unknown) => {
          log('warn', 'linear assignee lookup failed', {
            issue: workItem.issueIdentifier,
            error: errorMessage(error)
          });
          return undefined;
        })
      : undefined;
  const coAuthor = coAuthorFor(project, assigneeEmail ?? workItem.assigneeEmail);
  if (assigneeEmail !== undefined && assigneeEmail !== workItem.assigneeEmail) {
    await db.update(workItems).set({ assigneeEmail }).where(eq(workItems.id, workItem.id));
    touchCard(workItem.id);
  }
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
      round: briefRound(run, workItem.reviewRounds),
      coAuthor
    }
  });
  try {
    await sendStageDispatch(workItem.repository, payload);
  } catch (error) {
    await failDispatch(found, error, now);
    return 'skipped';
  }
  log('info', 'run dispatched', { runId: run.id, issue: workItem.issueIdentifier, model, downshift });

  // The card says what's running and why; a reply would notify everyone following the thread.
  touchCard(workItem.id);
  const stage = stageForAgent(run.agent);
  await Promise.all([
    postActivity(workItem, { type: 'thought', body: startedThought(run.agent) }),
    stage ? moveWorkItem(project, workItem, stage) : undefined
  ]);
  return 'started';
};

// A job's run has no session or work item: its brief names the slot, and nothing is posted until it reports.
const startJobRun = async (project: FactoryConfig, run: Run, now: Date): Promise<StartResult> => {
  const job = findJob(project, run.job);
  if (!job) {
    log('warn', 'run not dispatched: factory.yaml no longer has its job', { runId: run.id, job: run.job });
    return 'skipped';
  }
  // Jobs keep their configured model: the governor already holds them first whenever it would downshift.
  if (!(await claimRun(project, run, job.model, now))) {
    return 'not_claimed';
  }
  await getDb()
    .update(queue)
    .set({ releasedAt: now })
    .where(and(eq(queue.runId, run.id), isNull(queue.releasedAt)));
  const payload = buildDispatchPayload({
    runId: run.id,
    model: job.model,
    brief: await jobBriefFor(project, job, run)
  });
  try {
    await sendStageDispatch(repositoryOf(project), payload);
  } catch (error) {
    log('error', 'run dispatch failed', { runId: run.id, job: job.name, error: errorMessage(error) });
    await getDb()
      .update(runs)
      .set({ status: 'finished', outcome: 'failed', summary: 'GitHub rejected the stage dispatch.', finishedAt: now })
      .where(eq(runs.id, run.id));
    await postJobMessage(project, job, `*${jobTitleOf(job)}:* couldn’t start: GitHub rejected the dispatch.`);
    return 'skipped';
  }
  log('info', 'run dispatched', { runId: run.id, job: job.name, model: job.model });
  return 'started';
};

// A question's run: its brief is the question and who asked it; the card says it's being looked into.
const startAskRun = async (project: FactoryConfig, run: Run, now: Date): Promise<StartResult> => {
  const ask = await findAskByRun(run.id);
  if (!ask || !run.prompt) {
    log('warn', 'run not dispatched: no question for it', { runId: run.id });
    return 'skipped';
  }
  const model = modelFor(project, 'ask', false);
  if (!(await claimRun(project, run, model, now))) {
    return 'not_claimed';
  }
  await getDb()
    .update(queue)
    .set({ releasedAt: now })
    .where(and(eq(queue.runId, run.id), isNull(queue.releasedAt)));
  const asker = await slackUserName(ask.askerSlackId).catch(() => ask.askerSlackId);
  const payload = buildDispatchPayload({
    runId: run.id,
    model,
    brief: { agent: 'ask', trigger: run.trigger, question: run.prompt, asker, team: project.linear.teamKey }
  });
  try {
    await sendStageDispatch(repositoryOf(project), payload);
  } catch (error) {
    log('error', 'run dispatch failed', { runId: run.id, askId: ask.id, error: errorMessage(error) });
    await getDb()
      .update(runs)
      .set({ status: 'finished', outcome: 'failed', summary: 'GitHub rejected the stage dispatch.', finishedAt: now })
      .where(eq(runs.id, run.id));
    await attempt('slack reply', { askId: ask.id }, () =>
      postSlackMessage({
        channel: ask.slackChannelId,
        threadTs: ask.slackTs,
        text: askFailedText(ask.askerSlackId, 'GitHub rejected the run.', null)
      })
    );
    await refreshAskCard(project, ask);
    return 'skipped';
  }
  log('info', 'run dispatched', { runId: run.id, askId: ask.id, model });
  await refreshAskCard(project, ask);
  return 'started';
};

// Runs the governor for one queued run, then dispatches it or holds it in the queue.
export const dispatchRun = withCards(async (project: FactoryConfig, runId: string, retried = false): Promise<void> => {
  const found = await findAnyRun(runId);
  if (found?.run.status !== 'queued') {
    return;
  }
  const { run, workItem } = found;
  const db = getDb();
  const [readings, pause, runningCount, busyCount] = await Promise.all([
    latestReadings(),
    currentPause(),
    db.$count(runs, inArray(runs.status, ACTIVE_STATUSES)),
    workItem ? db.$count(runs, and(eq(runs.workItemId, workItem.id), inArray(runs.status, ACTIVE_STATUSES))) : 0
  ]);
  const now = new Date();
  const { decision, staleWindows } = governDispatch({
    policy: project.usage,
    readings,
    priority: run.priority,
    runningCount,
    maxRuns: project.concurrency.maxRuns,
    now,
    workItemBusy: busyCount > 0,
    paused: pause !== undefined,
    allowUsage: run.usageOverrideBy !== null
  });
  if (staleWindows.length > 0) {
    // No probe until Phase 1 step 4: decide on the readings there are, and say so.
    log('warn', 'governor decided on stale usage readings', { runId, staleWindows, decision: decision.kind });
  }
  const hold = (held: Extract<GovernedDecision, { kind: 'hold' }>) => {
    const text = queuedThought(held, now, project.timeZone);
    if (workItem) {
      return holdRun(run, held, () =>
        Promise.all([postActivity(workItem, { type: 'thought', body: text }), replyInThread(project, workItem, text)])
      );
    }
    if (run.agent === 'ask') {
      return holdRun(run, held, async () => {
        const ask = await findAskByRun(run.id);
        return ask ? refreshAskCard(project, ask) : undefined;
      });
    }
    const job = findJob(project, run.job);
    return holdRun(run, held, () =>
      job ? postJobMessage(project, job, `*${jobTitleOf(job)}:* ${text}`) : Promise.resolve()
    );
  };
  if (decision.kind === 'hold') {
    await hold(decision);
    return;
  }
  const started = workItem
    ? await startRun(project, { run, workItem }, decision.downshift, now)
    : run.agent === 'ask'
      ? await startAskRun(project, run, now)
      : await startJobRun(project, run, now);
  if (started === 'started') {
    // Wakes the console in case the run's workflow never reaches it, so the run isn't left dispatched.
    await bookWake(dispatchLapsesAt(now), 'run dispatched');
  }
  if (started !== 'not_claimed') {
    return;
  }
  // Another dispatch took the slot (or another run on this issue started) since the governor looked: decide again.
  if (!retried) {
    await dispatchRun(project, runId, true);
    return;
  }
  await hold({ kind: 'hold', state: decision.state, reason: 'concurrency' });
});

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
  await editInThread(
    project,
    workItem,
    ts,
    askingFor(project, workItem)(slackQuestionCard(asking.agent, round, workItem.issueUrl))
  );
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
  const ts = await replyInThread(project, workItem, askingFor(project, workItem)(card));
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
// Answers that keep a reviewed PR as it is start nothing: the decisions are recorded where people look, and the PR
// waits at the merge gate. The base branch is merged in now if the PR conflicts with it (held while the questions were
// open), and the round's findings, held back too, are offered to fix; only with neither is it ready to merge.
const keepReviewedPr = async (
  project: FactoryConfig,
  workItem: WorkItem,
  round: AskedQuestion[],
  from: ReplyFrom,
  review: { id: string; findings: ReviewFinding[]; beforeMerging: string | undefined }
): Promise<void> => {
  const text = keptText(round, from.via === 'slack' ? `by ${from.name} in Slack` : 'in Linear');
  const { prNumber } = workItem;
  log('info', 'review decisions kept the PR', { issue: workItem.issueIdentifier });
  const merging = (await checkConflict(project, workItem)) === 'fixing';
  // A failing check is only reported here: the answers may have been to merge with it.
  const failing = merging ? undefined : await headFailure(workItem);
  const offering = !merging && review.findings.length > 0;
  const next = merging
    ? 'The PR no longer merges cleanly, so I’m merging its base branch in first; review looks again after.'
    : failing
      ? `${escapeSlack(failing.workflow)} is failing on the PR (<${failing.url}|run>): reply here if you want it fixed.${offering ? ' Choose which of the round’s findings to fix below, or approve and merge.' : ''}`
      : offering
        ? 'Choose which of the round’s findings to fix below, or approve and merge.'
        : 'It’s ready for you to merge.';
  await Promise.all([
    replyInThread(project, workItem, askingFor(project, workItem)(`${text}\n${next}`)),
    postActivity(workItem, { type: 'response', body: text }),
    prNumber
      ? attempt('pr comment', { issue: workItem.issueIdentifier }, () =>
          commentOnPullRequest(workItem.repository, prNumber, text)
        )
      : undefined,
    resolveReviewThreads(workItem)
  ]);
  if (offering) {
    const notes = {
      beforeMerging: review.beforeMerging,
      mergeEffect: project.mergeEffect,
      findingsLeft: review.findings.length
    };
    const ts = await replyInThread(
      project,
      workItem,
      slackFindingsMessage(
        { id: review.id, round: workItem.reviewRounds },
        review.findings,
        { repository: workItem.repository, branch: workItem.branch },
        true,
        prNumber ? mergeButton(workItem.id, prNumber, notes, false) : undefined
      )
    );
    if (prNumber && ts) {
      await getDb().update(workItems).set({ mergeSlackTs: ts }).where(eq(workItems.id, workItem.id));
    }
  }
};

const answerQuestion = async (
  project: FactoryConfig,
  workItem: WorkItem,
  body: string,
  from: ReplyFrom
): Promise<boolean> => {
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
  // A review's questions say which answer keeps the PR as it is, in the review's own report.
  const [asking] = await getDb().select({ report: runs.report }).from(runs).where(eq(runs.id, open.runId)).limit(1);
  const after = afterAnswers(open.agent, answered, readQuestions(asking?.report));
  // The round's fixable findings were held back while its questions were open.
  const findings = open.agent === 'review' ? readFixableFindings(asking?.report) : [];
  // Answers that defer work to a follow-up file it, whatever else they decide.
  const followUps = open.agent === 'review' ? chosenFollowUps(answered, readQuestions(asking?.report)) : [];
  const filed = await fileFollowUps(project, workItem, followUps);
  if (filed.length > 0) {
    await Promise.all([
      replyInThread(project, workItem, filedFollowUpsText(filed)),
      postActivity(workItem, { type: 'thought', body: filedFollowUpsText(filed, 'markdown') })
    ]);
  }
  if (after.kind === 'keep') {
    await keepReviewedPr(project, workItem, answered, from, {
      id: open.runId,
      findings,
      beforeMerging: readBeforeMerging(asking?.report)
    });
    return true;
  }
  if (findings.length > 0) {
    await replyInThread(
      project,
      workItem,
      slackFindingsSettled(
        { round: workItem.reviewRounds },
        findings,
        { repository: workItem.repository, branch: workItem.branch },
        findings.map((_, index) => index),
        from.via === 'slack' ? from.name : 'Linear',
        true
      )
    );
  }
  const request = withFindings(after.request, workItem.reviewRounds, findings);
  await dispatchRun(project, await createRun(project, workItem, request, open.runId));
  return true;
};

// Takes the Blocked label off once the work moves on, when its latest run had put it there.
const clearBlocked = async (workItem: WorkItem): Promise<void> => {
  const [latest] = await getDb()
    .select({ status: runs.status, outcome: runs.outcome })
    .from(runs)
    .where(eq(runs.workItemId, workItem.id))
    .orderBy(desc(runs.createdAt))
    .limit(1);
  if (latest?.status === 'finished' && BLOCKING_OUTCOMES.includes(latest.outcome)) {
    await attempt('linear blocked label', { issue: workItem.issueIdentifier }, () =>
      setBlockedLabel(workItem.linearOrganizationId, workItem.linearIssueId, false)
    );
  }
};

const createRun = async (
  project: FactoryConfig,
  workItem: WorkItem,
  request: RunRequest,
  parentRunId: string | null = null
): Promise<string> => {
  touchCard(workItem.id);
  // New work on the item makes any questions still open moot, ends any wait on a person, and takes the PR away from an
  // earlier accepted review's Approve and merge.
  await Promise.all([
    closeOpenQuestions(project, workItem),
    clearBlocked(workItem),
    settleMovedOn(project, workItem, request.agent)
  ]);
  const [run] = await getDb()
    .insert(runs)
    .values({
      workItemId: workItem.id,
      parentRunId,
      agent: request.agent,
      model: modelFor(project, request.agent, false, workItem.title),
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
export const cancelRunFromConsole = withCards(async (runId: string, login: string): Promise<boolean> => {
  const found = await findAnyRun(runId);
  const projectName = found?.workItem?.project ?? found?.run.project;
  const project = projectName ? findProject(projectName) : undefined;
  if (!found || !project || !isOpenRun(found.run.status)) {
    return false;
  }
  const { run, workItem } = found;
  const text = stoppedText({ kind: 'console', login });
  // A job's run has no session or thread to tell; the Runs page shows it stopped, and a question's card says so.
  if (
    !(await cancelRun(run, { repository: workItem?.repository ?? repositoryOf(project), workItem }, text, new Date()))
  ) {
    return false;
  }
  if (workItem) {
    await Promise.all([
      postActivity(workItem, { type: 'response', body: text }),
      replyInThread(project, workItem, text)
    ]);
  }
  const ask = run.agent === 'ask' ? await findAskByRun(run.id) : undefined;
  if (ask) {
    await refreshAskCard(project, ask);
  }
  await releaseQueue();
  return true;
});

// Re-run from the Runs page: only a work item's latest run, and only when it ended badly (`canRerun`), so two stages
// never race and settled work isn't repeated.
export const rerunFromConsole = withCards(async (runId: string, login: string): Promise<boolean> => {
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
});

// "Allow once" from the console: the run skips usage holds and the pause from now on, even if the run caps hold it first.
export const allowRunOnce = withCards(async (runId: string, login: string): Promise<boolean> => {
  const [allowed] = await getDb()
    .update(runs)
    .set({ usageOverrideBy: login })
    .where(and(eq(runs.id, runId), eq(runs.status, 'queued')))
    .returning({ workItemId: runs.workItemId, project: runs.project });
  if (!allowed) {
    return false;
  }
  touchCard(allowed.workItemId);
  const [workItem] = allowed.workItemId
    ? await getDb().select().from(workItems).where(eq(workItems.id, allowed.workItemId)).limit(1)
    : [];
  const projectName = workItem?.project ?? allowed.project;
  const project = projectName ? findProject(projectName) : undefined;
  log('info', 'run allowed once', { runId, login, issue: workItem?.issueIdentifier });
  if (project) {
    await dispatchRun(project, runId);
  }
  return true;
});

// Releases held runs, highest priority first, for as long as the governor allows.
export const releaseQueue = withCards(async (): Promise<void> => {
  const waiting = await getDb()
    .select({
      runId: queue.runId,
      priority: queue.priority,
      heldAt: queue.heldAt,
      // A job's run names its project itself.
      project: sql<string>`coalesce(${workItems.project}, ${runs.project})`
    })
    .from(queue)
    .innerJoin(runs, eq(queue.runId, runs.id))
    .leftJoin(workItems, eq(runs.workItemId, workItems.id))
    .where(isNull(queue.releasedAt));
  await orderQueue(waiting).reduce(async (previous, entry) => {
    await previous;
    const project = findProject(entry.project);
    if (project) {
      await dispatchRun(project, entry.runId);
    }
  }, Promise.resolve());
});

// Held work whose reason may have cleared, released on any sign of activity: a webhook, a usage reading, a console
// page. A usage hold then lifts soon after its window resets whenever anything is going on, without a timer; quiet
// spells still wait for the governor job. Cheap when nothing is held, and never fails the request it rides on.
export const releaseQueueOnActivity = withCards(async (cause: string): Promise<void> => {
  try {
    await releaseQueue();
  } catch (error) {
    log('error', 'queue release on activity failed', { cause, error: errorMessage(error) });
  }
});

const upsertWorkItem = async (
  project: FactoryConfig,
  event: Extract<SessionEvent, { kind: 'created' }>,
  request: RunRequest
): Promise<WorkItem | undefined> => {
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
    // Claims the session: Linear also sends `created` for a session the factory opened itself, and whichever of the
    // two gets here second finds it taken and returns no row.
    .onConflictDoUpdate({
      target: workItems.linearIssueId,
      set: current,
      setWhere: sql`${workItems.agentSessionId} is distinct from ${event.sessionId}`
    })
    .returning();
  if (workItem) {
    await recordStageChange(workItem, workItem.stage, 'delegated');
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
  await startWork(project, event);
};

const startWork = async (project: FactoryConfig, event: Extract<SessionEvent, { kind: 'created' }>): Promise<void> => {
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
  if (!workItem) {
    log('info', 'agent session already started', { issue: event.issue.identifier });
    return;
  }
  await openSlackThread(project, workItem, event.issue.title);
  await dispatchRun(project, await createRun(project, workItem, request));
};

const cancelRun = async (
  run: Run,
  { repository, workItem }: { repository: string; workItem: WorkItem | null },
  summary: string,
  now: Date
): Promise<boolean> => {
  const db = getDb();
  const canceled = await db
    .update(runs)
    .set({ status: 'canceled', summary, finishedAt: now })
    .where(and(eq(runs.id, run.id), eq(runs.status, run.status)))
    .returning({ id: runs.id });
  if (canceled.length === 0) {
    return false;
  }
  touchCard(workItem?.id);
  await db
    .update(queue)
    .set({ releasedAt: now })
    .where(and(eq(queue.runId, run.id), isNull(queue.releasedAt)));
  if (run.actionsRunId) {
    const actionsRunId = run.actionsRunId;
    await attempt('actions run cancel', { runId: run.id }, () => cancelActionsRun(repository, actionsRunId));
  }
  log('info', 'run canceled', {
    runId: run.id,
    issue: workItem?.issueIdentifier,
    job: run.job,
    from: run.status,
    summary
  });
  return true;
};

// Cancels the work item's queued and active runs; returns how many it canceled.
const cancelOpenRuns = async (workItem: WorkItem, summary: string): Promise<number> => {
  const open = await getDb()
    .select()
    .from(runs)
    .where(and(eq(runs.workItemId, workItem.id), inArray(runs.status, OPEN_STATUSES)));
  const now = new Date();
  const canceled = await Promise.all(
    open.map((run) => cancelRun(run, { repository: workItem.repository, workItem }, summary, now))
  );
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
  touchCard(workItem.id);
  await Promise.all([
    getDb().update(workItems).set({ stage, updatedAt: new Date() }).where(eq(workItems.id, workItem.id)),
    recordStageChange(workItem, stage, cause)
  ]);
  log('info', 'work item stage followed', { issue: workItem.issueIdentifier, from: workItem.stage, to: stage, cause });
  if (TERMINAL_STAGES.includes(stage)) {
    await clearBlocked(workItem);
  }
  // Only a merge or a close should end the merge gate; anything else (a person, or an integration's automation) is
  // worth a look in the health check.
  if (workItem.stage === 'awaiting_merge' && stage !== 'awaiting_merge' && !TERMINAL_STAGES.includes(stage)) {
    log('warn', 'work item left awaiting merge without a merge', {
      issue: workItem.issueIdentifier,
      to: stage,
      cause
    });
  }
};

export const handleAgentSessionEvent = withCards(async (payload: unknown): Promise<void> => {
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
});

// `message` is the reply typed in the thread, acknowledged when it starts a run; a tapped button has none.
type ReplyFrom = { via: 'linear' } | { via: 'slack'; name: string; message?: { channel: string; ts: string } };

// The gate a stage reported last, read back from its run's report when the gate is answered.
const reportedGate = async (workItem: WorkItem): Promise<Gate | undefined> => {
  const [latest] = await getDb()
    .select({ report: runs.report })
    .from(runs)
    .where(and(eq(runs.workItemId, workItem.id), eq(runs.status, 'finished'), eq(runs.outcome, 'needs_input')))
    .orderBy(desc(runs.createdAt))
    .limit(1);
  return latest && readGate(latest.report);
};

// The open gate's message in the thread, once the gate is answered from anywhere.
const settleGate = async (
  project: FactoryConfig,
  workItem: WorkItem,
  body: string,
  request: RunRequest | undefined,
  from: ReplyFrom
): Promise<void> => {
  touchCard(workItem.id);
  const ts = workItem.gateSlackTs;
  if (!ts) {
    return;
  }
  const by = from.via === 'slack' ? `by ${from.name}` : 'in Linear';
  const gate = workItem.stage === 'spec_review' ? undefined : await reportedGate(workItem);
  const settled =
    workItem.stage === 'spec_review'
      ? slackSpecGateSettled(request?.trigger === 'spec_approved' ? 'approved' : 'changes', by, specUrl(workItem))
      : gate && slackGateSettled(gate, body, by);
  await Promise.all([
    settled ? editInThread(project, workItem, ts, settled) : undefined,
    getDb().update(workItems).set({ gateSlackTs: null }).where(eq(workItems.id, workItem.id))
  ]);
};

// A human's reply, from the Linear session or the Slack thread: mirrored to the other, then it answers the open
// question, or the spec gate, or goes to the agent for the work item's stage.
const handleReply = async (project: FactoryConfig, workItem: WorkItem, body: string, from: ReplyFrom) => {
  await (from.via === 'linear'
    ? replyInThread(project, workItem, slackReplyText(body, workItem.issueUrl))
    : postActivity(workItem, { type: 'thought', body: linearSlackReplyText(from.name, body) }));
  if (await answerQuestion(project, workItem, body, from)) {
    return;
  }
  const atReportedGate = workItem.gateSlackTs !== null && workItem.stage !== 'spec_review';
  const request = runRequestFor({ kind: 'prompted', body }, workItem.stage);
  await settleGate(project, workItem, body, request, from);
  if (atReportedGate && onlyAsksForChanges(body)) {
    // As at the spec gate: ask what to change rather than start a run that would only ask the same.
    await Promise.all([
      postActivity(workItem, { type: 'elicitation', body: GATE_CHANGES_QUESTION }),
      replyInThread(project, workItem, GATE_CHANGES_QUESTION)
    ]);
    return;
  }
  if (!request) {
    // The Change something option on its own: ask what to change, and keep waiting in Spec Review.
    await Promise.all([
      postActivity(workItem, { type: 'elicitation', body: CHANGES_QUESTION }),
      replyInThread(project, workItem, CHANGES_QUESTION)
    ]);
    return;
  }
  await dispatchRun(project, await createRun(project, workItem, request));
  if (from.via === 'slack' && from.message) {
    const { channel, ts } = from.message;
    // The card shows the run; the reaction shows this message started it.
    await attempt('slack reaction', { issue: workItem.issueIdentifier }, () => addSlackReaction(channel, ts, 'eyes'));
  }
  if (request.trigger === 'spec_approved') {
    await attempt('spec parts', { issue: workItem.issueIdentifier }, () => fileSpecParts(project, workItem));
  }
};

// A spec that split its work: once approved, its later parts become sub-issues, each posted to delegate when the one
// before it merges.
const fileSpecParts = async (project: FactoryConfig, workItem: WorkItem): Promise<void> => {
  const specs = await getDb()
    .select({ report: runs.report })
    .from(runs)
    .where(and(eq(runs.workItemId, workItem.id), eq(runs.agent, 'spec'), eq(runs.status, 'finished')))
    .orderBy(desc(runs.createdAt));
  const parts = latestSpecParts(specs.map(({ report }) => report));
  if (parts.length === 0) {
    return;
  }
  const parent = { identifier: workItem.issueIdentifier };
  const filed = await fileSubIssues(
    workItem.linearOrganizationId,
    workItem.linearIssueId,
    parts.map((part, index) => ({
      title: part.title,
      estimate: part.estimate,
      description: partDescription(parent, part, { number: index + 2, total: parts.length + 1 })
    }))
  );
  if (filed.length === 0) {
    return;
  }
  log('info', 'spec parts filed', { issue: workItem.issueIdentifier, parts: filed.map((part) => part.identifier) });
  await replyInThread(project, workItem, partsFiledText(parent, filed));
};

// A person's reply in a work item's thread steers the work like a reply in Linear, if they're on the allow-list.
export const handleSlackMessage = withCards(async (payload: unknown): Promise<void> => {
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
  await handleReply(project, workItem, reply.body, {
    via: 'slack',
    name,
    message: { channel: reply.channel, ts: reply.ts }
  });
});

// A top-level mention is a request: it's filed in Linear and worked on in the mention's thread. The work item exists,
// with that thread, before the session opens, so every message about the work lands there.
// The Linear member a Slack user is, matched by email, to own what they start from Slack.
const linearUserFor = async (organizationId: string, userId: string, email: string | null): Promise<string | null> => {
  const assigneeId = email
    ? await findUserIdByEmail(organizationId, email).catch((error: unknown) => {
        log('warn', 'linear user lookup failed', { user: userId, error: errorMessage(error) });
        return null;
      })
    : null;
  if (!assigneeId) {
    log('info', 'slack requester has no linear user', { user: userId, hasEmail: email !== null });
  }
  return assigneeId;
};

// `@app ready`: the Ready list, in the mention's thread, with the same buttons as the posted ones.
const answerReadyRequest = async (
  project: FactoryConfig,
  channel: string,
  ts: string,
  sayInThread: (text: string) => Promise<void>
): Promise<void> => {
  const list = await loadReadyList(project).catch((error: unknown) => {
    log('warn', 'ready list failed', { project: project.name, error: errorMessage(error) });
    return undefined;
  });
  log('info', 'slack ready request', { project: project.name, ready: list?.ready.length });
  if (!list) {
    await sayInThread('I couldn’t read Linear just now. Try again in a minute.');
    return;
  }
  if (list.ready.length === 0) {
    await sayInThread(nothingReadyText(requireEnv('CONSOLE_URL'), list.needsSize));
    return;
  }
  await attempt('slack ready message', { channel }, () =>
    postReadyMessage(project, READY_HEADING, list.ready, { threadTs: ts, needsSize: list.needsSize })
  );
};

type SlackThread = { channel: string; threadTs: string };

// Files a request made in Slack, unassigned, and asks in its thread whether to start it now or leave it for later.
// Nothing starts without a tap; whoever taps Start owns it. Left unassigned, it can show in the Ready list.
const fileAndOffer = async (
  project: FactoryConfig,
  requesterId: string,
  filing: { title: string; description: string },
  thread: SlackThread
): Promise<void> => {
  const say = (message: string | SlackMessage) =>
    attempt('slack reply', { channel: thread.channel }, () =>
      postSlackMessage({
        channel: thread.channel,
        threadTs: thread.threadTs,
        ...(typeof message === 'string' ? { text: message } : message)
      })
    );
  const organizationId = requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID');
  const issue = await createIssue(organizationId, {
    teamKey: project.linear.teamKey,
    ...filing,
    assigneeId: null
  }).catch((error: unknown) => {
    log('error', 'linear issue for a slack request failed', { project: project.name, error: errorMessage(error) });
    return undefined;
  });
  if (!issue) {
    await say('I couldn’t file this in Linear, so nothing has started. The details are in the console log.');
    return;
  }
  log('info', 'slack request filed', { issue: issue.identifier, user: requesterId });
  await say(filedChoiceMessage(issue));
};

type StartFiled = 'started' | 'already' | 'failed';

// Starts an issue filed from Slack in the thread it was filed in, as a mention used to straight away: the work item
// exists, with that thread, before the session opens, so every message about the work lands there. `announce` says
// so before the session's own events can. An issue that already has a work item has started elsewhere. Whoever starts
// it owns it, as Delegate makes the tapper the assignee.
const startFiledIssue = async (
  project: FactoryConfig,
  issue: FiledIssue & { title: string },
  thread: SlackThread,
  starter: { name: string; assigneeId: string | null },
  announce: () => Promise<void>
): Promise<StartFiled> => {
  const requester = starter.name;
  const organizationId = requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID');
  const [claimed] = await getDb()
    .insert(workItems)
    .values({
      project: project.name,
      repository: repositoryOf(project),
      linearOrganizationId: organizationId,
      linearIssueId: issue.id,
      issueIdentifier: issue.identifier,
      issueUrl: issue.url,
      title: issue.title,
      origin: 'slack',
      requester,
      slackChannelId: thread.channel,
      slackThreadTs: thread.threadTs,
      stage: 'researching'
    })
    .onConflictDoNothing({ target: workItems.linearIssueId })
    .returning({ id: workItems.id });
  if (!claimed) {
    return 'already';
  }
  try {
    await announce();
    const sessionId = await createSessionOnIssue(organizationId, issue.id);
    await startWork(project, {
      kind: 'created',
      organizationId,
      sessionId,
      issue: { ...issue, teamKey: project.linear.teamKey },
      requester
    });
  } catch (error) {
    log('error', 'starting a slack request failed', { issue: issue.identifier, error: errorMessage(error) });
    // A claim that never became a session would sit on the Inbox as work that never starts.
    await attempt('filed claim release', { issue: issue.identifier }, () =>
      getDb()
        .delete(workItems)
        .where(
          and(
            eq(workItems.id, claimed.id),
            sql`not exists (select 1 from ${runs} where ${runs.workItemId} = ${workItems.id})`
          )
        )
    );
    await attempt('slack reply', { issue: issue.identifier }, () =>
      postSlackMessage({
        channel: thread.channel,
        threadTs: thread.threadTs,
        text: `I filed <${issue.url}|${issue.identifier}> but couldn’t start on it. Delegate it to @${project.alias} in Linear to start.`
      })
    );
    return 'failed';
  }
  // Shows in Linear who's working on it, and lets undelegating stop the work as it does for any other issue.
  await attempt('linear delegate', { issue: issue.identifier }, async () =>
    delegateIssue(organizationId, issue.id, await findAppUserId(organizationId), starter.assigneeId)
  );
  await getDb().update(asks).set({ ticketStarted: true }).where(eq(asks.ticketIssueId, issue.id));
  return 'started';
};

// `@app <request>` in a question's thread: the request, with the question and answer as its context.
const fileFromQuestionThread = async (
  project: FactoryConfig,
  mention: { channel: string; threadTs: string; userId: string; request: string },
  tellThem: (text: string) => Promise<void>
): Promise<void> => {
  const ask = await findAskByThread(mention.channel, mention.threadTs);
  if (!ask) {
    return;
  }
  const [name, context] = await Promise.all([
    slackUserName(mention.userId).catch(() => mention.userId),
    askContextFor(ask, await runOf(ask))
  ]);
  const titled = slackIssueFromRequest(mention.request, { name, permalink: context.permalink });
  if (!titled) {
    await tellThem(emptyMentionText(project));
    return;
  }
  const filing = askTicketIssue({ title: titled.title, request: mention.request }, context);
  await fileAndOffer(
    project,
    mention.userId,
    { title: filing.title, description: `${filing.description}\n\n---\n\nAsked for by ${name} in Slack.` },
    { channel: mention.channel, threadTs: mention.threadTs }
  );
};

export const handleSlackMention = withCards(async (payload: unknown): Promise<void> => {
  const mention = parseSlackMention(payload);
  if (!mention) {
    return;
  }
  const { channel, ts, threadTs, userId } = mention;
  // In a work item's thread the mention is a reply to the work, which its `message` event already handled.
  if (threadTs) {
    const [workItem] = await getDb()
      .select({ id: workItems.id })
      .from(workItems)
      .where(and(eq(workItems.slackChannelId, channel), eq(workItems.slackThreadTs, threadTs)))
      .limit(1);
    if (workItem) {
      return;
    }
  }
  const tellThem = (text: string) =>
    attempt('slack ephemeral', { channel, user: userId }, () =>
      postSlackEphemeral({ channel, user: userId, text, threadTs: threadTs ?? undefined })
    );
  const sayInThread = (text: string) =>
    attempt('slack reply', { channel }, () => postSlackMessage({ channel, threadTs: ts, text }));
  const project = findProjectBySlackChannel(channel);
  if (!project) {
    if (!threadTs) {
      const channels = allProjects().flatMap(({ slack }) => (slack ? [`<#${slack.channelId}>`] : []));
      await tellThem(wrongChannelText(channels));
    }
    return;
  }
  if (!isAllowedSlackUser(project, userId)) {
    log('info', 'slack request from someone not allowed', { project: project.name, user: userId });
    await tellThem(notAllowedToStartText(project));
    return;
  }
  if (threadTs) {
    await fileFromQuestionThread(project, { channel, threadTs, userId, request: mention.request }, tellThem);
    return;
  }
  if (isReadyRequest(mention.request)) {
    await answerReadyRequest(project, channel, ts, sayInThread);
    return;
  }
  const [name, permalink] = await Promise.all([
    slackUserName(userId).catch(() => userId),
    slackPermalink(channel, ts).catch((error: unknown) => {
      log('warn', 'slack permalink failed', { channel, ts, error: errorMessage(error) });
      return null;
    })
  ]);
  const filing = slackIssueFromRequest(mention.request, { name, permalink });
  if (!filing) {
    await tellThem(emptyMentionText(project));
    return;
  }
  await fileAndOffer(project, userId, filing, { channel, threadTs: ts });
});

type Tapper = { name: string; assigneeId: string | null };

// Claims a ready issue's work item for one tap, so a second tap (a row's button after "Delegate all", or a double tap)
// can't open a second session while the first is starting: the tap's token goes in only if no one else's has since.
// Linear's own `created` event for the session, and `startWork`, both take the work item from the token as usual.
const claimReadyIssue = async (
  project: FactoryConfig,
  issue: ReadyIssue,
  tapper: Tapper,
  token: string
): Promise<boolean> => {
  const [existing] = await getDb()
    .select({ id: workItems.id, agentSessionId: workItems.agentSessionId })
    .from(workItems)
    .where(eq(workItems.linearIssueId, issue.id))
    .limit(1);
  if (existing) {
    const [open] = await getDb()
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.workItemId, existing.id), inArray(runs.status, OPEN_STATUSES)))
      .limit(1);
    if (open) {
      return false;
    }
  }
  const [claimed] = await getDb()
    .insert(workItems)
    .values({
      project: project.name,
      repository: repositoryOf(project),
      linearOrganizationId: requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID'),
      linearIssueId: issue.id,
      issueIdentifier: issue.identifier,
      issueUrl: issue.url,
      title: issue.title,
      origin: 'linear',
      requester: tapper.name,
      agentSessionId: token,
      stage: 'researching'
    })
    .onConflictDoUpdate({
      target: workItems.linearIssueId,
      set: { agentSessionId: token, updatedAt: new Date() },
      setWhere: sql`${workItems.agentSessionId} is not distinct from ${existing?.agentSessionId ?? null}`
    })
    .returning({ id: workItems.id });
  return claimed !== undefined;
};

// Starts a ready issue the way a Slack request starts: the session opens, the work starts, then the issue is delegated
// and assigned to whoever tapped, so Linear shows it as theirs.
const delegateReadyIssue = async (
  project: FactoryConfig,
  issue: ReadyIssue,
  tapper: Tapper,
  token: string
): Promise<'delegated' | 'not_ready' | 'failed'> => {
  const organizationId = requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID');
  try {
    if (!(await claimReadyIssue(project, issue, tapper, token))) {
      return 'not_ready';
    }
    const sessionId = await createSessionOnIssue(organizationId, issue.id);
    await startWork(project, {
      kind: 'created',
      organizationId,
      sessionId,
      issue: {
        id: issue.id,
        identifier: issue.identifier,
        url: issue.url,
        title: issue.title,
        teamKey: project.linear.teamKey
      },
      requester: tapper.name
    });
  } catch (error) {
    log('error', 'starting a ready issue failed', { issue: issue.identifier, error: errorMessage(error) });
    // A claim that never became a session would sit on the Inbox as work that never starts.
    await attempt('ready claim release', { issue: issue.identifier }, () =>
      getDb()
        .delete(workItems)
        .where(
          and(
            eq(workItems.linearIssueId, issue.id),
            eq(workItems.agentSessionId, token),
            sql`not exists (select 1 from ${runs} where ${runs.workItemId} = ${workItems.id})`
          )
        )
    );
    return 'failed';
  }
  await attempt('linear delegate', { issue: issue.identifier }, async () =>
    delegateIssue(organizationId, issue.id, await findAppUserId(organizationId), tapper.assigneeId)
  );
  return 'delegated';
};

// A tap on a ready message's Delegate or "Delegate all". Each issue is checked against Linear again, since the message
// may be hours old; the message is then redrawn with what happened, and the tapper told about anything left.
const handleDelegateTap = async (
  action: Extract<SlackAction, { kind: 'delegate' }>,
  tellTapper: (text: string) => Promise<void>
): Promise<void> => {
  // A tap in the App Home has no channel, and a slash command's reply may sit in any channel: the issues' team says
  // whose they are.
  const teamKey = action.identifiers[0]?.split('-')[0] ?? '';
  const project =
    (action.channelId ? findProjectBySlackChannel(action.channelId) : undefined) ?? findProjectByTeamKey(teamKey);
  if (!project) {
    return;
  }
  if (!isAllowedSlackUser(project, action.userId)) {
    log('info', 'slack delegate tap from someone not allowed', { project: project.name, user: action.userId });
    await tellTapper(notAllowedToStartText(project));
    return;
  }
  const organizationId = requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID');
  const [list, { name, email }] = await Promise.all([
    loadReadyList(project).catch((error: unknown) => {
      log('warn', 'ready list failed', { project: project.name, error: errorMessage(error) });
      return undefined;
    }),
    slackUser(action.userId).catch(() => ({ name: action.userId, email: null }))
  ]);
  if (!list) {
    await tellTapper(READY_UNREADABLE);
    return;
  }
  log('info', 'slack delegate tap', { user: action.userId, issues: action.identifiers });
  const tapper = { name, assigneeId: await linearUserFor(organizationId, action.userId, email) };
  const results = await Promise.all(
    action.identifiers.map(async (identifier) => {
      const issue = list.ready.find((candidate) => candidate.identifier === identifier);
      const result = issue
        ? await delegateReadyIssue(project, issue, tapper, `slack:${action.actionTs}`)
        : ('not_ready' as const);
      return { identifier, result };
    })
  );
  const now = new Date();
  const outcomes = results.flatMap(({ identifier, result }): ReadyOutcome[] =>
    result === 'delegated'
      ? [{ identifier, kind: 'delegated', by: name, at: now }]
      : result === 'not_ready'
        ? [{ identifier, kind: 'not_ready' }]
        : []
  );
  const withResult = (wanted: string) =>
    results.filter(({ result }) => result === wanted).map(({ identifier }) => identifier);
  const [notReady, failed] = [withResult('not_ready'), withResult('failed')];
  const { message, channelId, responseUrl } = action;
  const [card] =
    message && channelId
      ? await getDb()
          .select({ id: workItems.id, nextReady: workItems.nextReady })
          .from(workItems)
          .where(and(eq(workItems.slackChannelId, channelId), eq(workItems.slackThreadTs, message.ts)))
          .limit(1)
      : [];
  await Promise.all([
    card && outcomes.length > 0 ? settleNextOnCard(card, outcomes) : undefined,
    // Slack doesn't send an ephemeral message back, so it's redrawn from the list it was drawn from.
    action.ephemeral && responseUrl && outcomes.length > 0
      ? attempt('slack ephemeral edit', { issues: action.identifiers }, () => {
          const reply = readyMessage(project, READY_HEADING, list.ready, list.needsSize);
          return respondToSlack(
            responseUrl,
            { ...reply, blocks: settleReadyMessage(reply.blocks, outcomes, project.timeZone) },
            true
          );
        })
      : undefined,
    !card && message && channelId && outcomes.length > 0
      ? attempt('slack edit', { issues: action.identifiers }, () =>
          updateSlackMessage({
            channel: channelId,
            ts: message.ts,
            text: message.text,
            blocks: settleReadyMessage(message.blocks, outcomes, project.timeZone)
          })
        )
      : undefined,
    notReady.length > 0 ? tellTapper(notReadyText(notReady)) : undefined,
    failed.length > 0 ? tellTapper(delegateFailedText(failed, project.alias)) : undefined
  ]);
};

// The Next rows a Delegate tap settled on a work item's card: who delegated each, or that it wasn't ready any more.
const settleNextOnCard = async (card: { id: string; nextReady: unknown }, outcomes: ReadyOutcome[]): Promise<void> => {
  const next = readNextIssues(card.nextReady).map((issue): NextIssue => {
    const outcome = outcomes.find(({ identifier }) => identifier === issue.identifier);
    if (!outcome) {
      return issue;
    }
    return outcome.kind === 'delegated'
      ? { ...issue, delegatedBy: outcome.by, delegatedAt: outcome.at.toISOString() }
      : { ...issue, notReady: true };
  });
  await getDb().update(workItems).set({ nextReady: next }).where(eq(workItems.id, card.id));
  touchCard(card.id);
};

// An issue finishing (done or canceled) can unblock others, each offered with a Delegate button so the news arrives
// when it happens rather than with the next morning's list: on the finished work item's card when it has one,
// otherwise in a message of their own.
const announceUnblocked = async (teamKey: string, identifier: string, canceled: boolean): Promise<void> => {
  const project = findProjectByTeamKey(teamKey);
  if (!project?.slack) {
    return;
  }
  const unblocked = unblockedBy(await loadReadyList(project), identifier);
  if (unblocked.length === 0) {
    return;
  }
  const issues = unblocked.map((issue) => issue.identifier);
  const [finished] = await getDb()
    .select({ id: workItems.id })
    .from(workItems)
    .where(
      and(
        eq(workItems.project, project.name),
        eq(workItems.issueIdentifier, identifier),
        isNotNull(workItems.slackThreadTs)
      )
    )
    .limit(1);
  if (finished) {
    const next = unblocked.slice(0, MAX_READY_ROWS).map(
      ({ identifier: id, title, url, size, project, projectUrl, milestone }): NextIssue => ({
        identifier: id,
        title,
        url,
        size,
        project,
        projectUrl,
        milestone
      })
    );
    await getDb().update(workItems).set({ nextReady: next }).where(eq(workItems.id, finished.id));
    touchCard(finished.id);
    log('info', 'ready issues offered on the card', { after: identifier, issues });
    return;
  }
  await postReadyMessage(project, unblockedHeading(identifier, canceled, unblocked.length), unblocked);
  log('info', 'ready issues announced', { after: identifier, issues });
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

// A failed run's Re-run button: the same as Re-run in the console, with the same rules.
const handleRerunTap = async (
  runId: string,
  userId: string,
  tellTapper: (text: string) => Promise<void>
): Promise<void> => {
  const found = await findRun(runId);
  const project = found && findProject(found.workItem.project);
  if (!found || !project) {
    return;
  }
  if (!isAllowedSlackUser(project, userId)) {
    log('info', 'slack re-run tap from someone not allowed', { issue: found.workItem.issueIdentifier, user: userId });
    await tellTapper(notAllowedText(project));
    return;
  }
  const name = await slackUserName(userId).catch(() => userId);
  if (!(await rerunFromConsole(runId, `${name} in Slack`))) {
    await tellTapper(RERUN_GONE);
  }
};

// A tap on a question's or the spec gate's button, or a ready message's. Only the current question and a spec still in
// review take an answer; the messages themselves are redrawn by the answer, wherever it came from.
export const handleSlackAction = withCards(async (payload: unknown): Promise<void> => {
  const action = parseSlackAction(payload);
  if (!action) {
    return;
  }
  const { responseUrl } = action;
  // A tap in the App Home has no response URL, so the answer goes to the app's messages with the tapper.
  const tellTapper = (message: string | SlackMessage) => {
    const content = typeof message === 'string' ? { text: message } : message;
    return attempt('slack action response', { user: action.userId }, () =>
      responseUrl
        ? respondToSlack(responseUrl, content)
        : postSlackMessage({ channel: action.userId, ...content }).then(() => undefined)
    );
  };
  try {
    await handleTap(action, tellTapper);
  } finally {
    if (action.fromHome) {
      await publishHome(action.userId);
    }
  }
});

const handleHomeTap = async (
  action: Extract<SlackAction, { kind: 'home' }>,
  tellTapper: (text: string) => Promise<void>
): Promise<void> => {
  if (action.action === 'refresh') {
    return;
  }
  const project = allProjects().find((candidate) => isAllowedSlackUser(candidate, action.userId));
  if (!project) {
    await tellTapper('Only the factory’s people can pause or resume it.');
    return;
  }
  if (action.action === 'pause') {
    await pauseFromSlack(action.userId);
    return;
  }
  await resumeFromSlack(action.userId);
};

// Pausing and resuming from the hub or the slash command, as the console's Usage page does, recorded under the person's
// Slack name. Resuming releases the queue straight away.
export const pauseFromSlack = async (userId: string): Promise<void> => {
  const by = `${await slackUserName(userId).catch(() => userId)} in Slack`;
  await pauseFactory(by);
  log('info', 'factory paused', { login: by });
};

export const resumeFromSlack = withCards(async (userId: string): Promise<boolean> => {
  const by = `${await slackUserName(userId).catch(() => userId)} in Slack`;
  if (!(await resumeFactory(by))) {
    return false;
  }
  log('info', 'factory resumed', { login: by });
  await releaseQueue();
  return true;
});

const GITHUB_UNREACHABLE = 'I couldn’t reach GitHub, so nothing was merged. Try again in a minute.';

// Approve and merge, from the card, review's accepted message or the Home tab: the PR is approved and merged on GitHub
// as the person who tapped, with their own connection, and only at the commit review accepted. Anything that stops it
// is said to them alone; the PR's merge webhook does the rest (the card, the message, Linear).
const handleMergeTap = async (
  action: Extract<SlackAction, { kind: 'merge' }>,
  tellTapper: (message: string | SlackMessage) => Promise<void>
): Promise<void> => {
  const workItem = await findWorkItemById(action.workItemId);
  const project = workItem && findProject(workItem.project);
  if (!workItem || !project) {
    return;
  }
  const issue = workItem.issueIdentifier;
  if (!isAllowedSlackUser(project, action.userId)) {
    log('info', 'slack tap from someone not allowed', { issue, user: action.userId });
    await tellTapper(notAllowedText(project));
    return;
  }
  log('info', 'slack tap', { issue, user: action.userId, kind: action.kind });
  const githubUserId = personForSlack(project, action.userId)?.github;
  if (!githubUserId) {
    await tellTapper(mergeNotSetUpText(project.alias));
    return;
  }
  const connection = await userGitHubToken(githubUserId);
  if (connection.kind !== 'connected') {
    await tellTapper(connectGitHubMessage(connectStartUrl(), connection.kind === 'expired'));
    return;
  }
  const { prNumber, repository, branch } = workItem;
  if (workItem.stage !== 'awaiting_merge' || !prNumber || !branch) {
    await tellTapper(notWaitingToMergeText(issue));
    return;
  }
  try {
    const [pull, accepted, checks] = await Promise.all([
      pullForMerge(repository, prNumber),
      acceptedHead(workItem),
      branchChecks(repository, branch)
    ]);
    const refusal = mergeRefusal(prNumber, { pull, acceptedHead: accepted, checks });
    if (refusal !== undefined || accepted === null) {
      log('info', 'merge from slack refused', { issue, login: connection.login, refusal });
      await tellTapper(refusal ?? notWaitingToMergeText(issue));
      return;
    }
    const approved = await approvePull(connection.token, repository, prNumber, accepted);
    if (!approved.ok) {
      log('warn', 'github approve refused', { issue, login: connection.login, message: approved.message });
      await tellTapper(approveRefusedText(prNumber, approved.message));
      return;
    }
    const merged = await mergePull(connection.token, repository, prNumber, accepted);
    if (!merged.ok) {
      log('warn', 'github merge refused', { issue, login: connection.login, message: merged.message });
      await tellTapper(mergeRefusedText(prNumber, merged.message));
      return;
    }
  } catch (error) {
    log('error', 'merge from slack failed', { issue, error: errorMessage(error) });
    await tellTapper(GITHUB_UNREACHABLE);
    return;
  }
  log('info', 'pr merged from slack', { issue, login: connection.login, pr: prNumber });
  const name = await slackUserName(action.userId).catch(() => connection.login);
  await postActivity(workItem, { type: 'thought', body: `${name} approved and merged PR #${prNumber} from Slack.` });
};

const FINDINGS_GONE = 'That review has moved on, so nothing changed.';
const NOTHING_TICKED = 'Nothing is ticked: tick a finding to fix, or choose Approve and merge.';

// Fix ticked or Merge as it is, under the findings of the review the PR waits on: the ticked ones go to an implement
// run as a revision would, and the next review round checks them. Only while nothing has run since that review.
const handleFindingsTap = async (
  action: Extract<SlackAction, { kind: 'findings' }>,
  tellTapper: (text: string) => Promise<void>
): Promise<void> => {
  const found = await findRun(action.runId);
  const workItem = found?.workItem;
  const project = workItem && findProject(workItem.project);
  if (!found || !workItem || !project || found.run.agent !== 'review') {
    return;
  }
  if (!isAllowedSlackUser(project, action.userId)) {
    log('info', 'slack tap from someone not allowed', { issue: workItem.issueIdentifier, user: action.userId });
    await tellTapper(notAllowedText(project));
    return;
  }
  log('info', 'slack tap', { issue: workItem.issueIdentifier, user: action.userId, kind: action.kind });
  const [latest] = await getDb()
    .select({ id: runs.id })
    .from(runs)
    .where(eq(runs.workItemId, workItem.id))
    .orderBy(desc(runs.createdAt))
    .limit(1);
  if (latest?.id !== found.run.id || workItem.stage !== 'awaiting_merge') {
    await tellTapper(FINDINGS_GONE);
    return;
  }
  const findings = readFixableFindings(found.run.report);
  const ticked = findings.flatMap((_, index) => (action.unticked.includes(index) ? [] : [index]));
  const fixing = action.choice === 'fix' ? ticked : null;
  if (fixing?.length === 0) {
    await tellTapper(NOTHING_TICKED);
    return;
  }
  const name = await slackUserName(action.userId).catch(() => action.userId);
  const round = workItem.reviewRounds;
  const place = { repository: workItem.repository, branch: workItem.branch };
  await Promise.all([
    action.messageTs
      ? editInThread(
          project,
          workItem,
          action.messageTs,
          slackFindingsSettled({ round }, findings, place, fixing, name)
        )
      : undefined,
    // Settled here, so the PR moving on doesn't add its line to this message too.
    action.messageTs && workItem.mergeSlackTs === action.messageTs
      ? getDb().update(workItems).set({ mergeSlackTs: null }).where(eq(workItems.id, workItem.id))
      : undefined,
    postActivity(workItem, {
      type: 'thought',
      body: fixing
        ? `${name} chose ${fixing.length} of the review’s ${findings.length} findings to fix, in Slack.`
        : `${name} left the review’s findings as they are, in Slack.`
    })
  ]);
  if (fixing) {
    const chosen = findings.filter((_, index) => fixing.includes(index));
    const request: RunRequest = {
      agent: 'implement',
      trigger: 'review_findings',
      priority: 'in_flight',
      prompt: findingsPrompt(round, chosen)
    };
    await dispatchRun(project, await createRun(project, workItem, request, found.run.id));
  }
};

// Start now, Leave for later, or Start TAS-n, under an issue filed from Slack. The issue is read again first, since the
// message may be days old.
const handleFiledTap = async (
  action: Extract<SlackAction, { kind: 'filed' }>,
  tellTapper: (text: string) => Promise<void>
): Promise<void> => {
  const { channelId, messageTs, threadTs } = action;
  const project = channelId ? findProjectBySlackChannel(channelId) : undefined;
  if (!project || !channelId || !messageTs || !threadTs) {
    return;
  }
  if (!isAllowedSlackUser(project, action.userId)) {
    log('info', 'slack filed tap from someone not allowed', { project: project.name, user: action.userId });
    await tellTapper(notAllowedToStartText(project));
    return;
  }
  const issue = await issueToStart(requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID'), action.issueId).catch(
    (error: unknown) => {
      log('warn', 'linear issue lookup failed', { issueId: action.issueId, error: errorMessage(error) });
      return null;
    }
  );
  if (!issue) {
    await tellTapper(READY_UNREADABLE);
    return;
  }
  log('info', 'slack filed tap', { issue: issue.identifier, user: action.userId, choice: action.choice });
  const edit = (message: SlackMessage) =>
    attempt('slack edit', { issue: issue.identifier }, () =>
      updateSlackMessage({ channel: channelId, ts: messageTs, ...message })
    );
  if (action.choice === 'later') {
    await edit(filedForLaterMessage(issue, project.alias));
    return;
  }
  if (FINISHED_STATE_TYPES.includes(issue.stateType)) {
    await tellTapper(filedIssueClosedText(issue.identifier));
    return;
  }
  const { name, email } = await slackUser(action.userId).catch(() => ({ name: action.userId, email: null }));
  const starter = {
    name,
    assigneeId: await linearUserFor(requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID'), action.userId, email)
  };
  const result = await startFiledIssue(project, issue, { channel: channelId, threadTs }, starter, () =>
    edit(filedStartedMessage(issue))
  );
  if (result === 'already') {
    await tellTapper(alreadyStartedText(issue.identifier));
  }
};

// File and start, or File for later, under a question's answer: its suggested ticket, filed once whoever taps.
const handleAskTicketTap = async (
  action: Extract<SlackAction, { kind: 'ask_ticket' }>,
  tellTapper: (text: string) => Promise<void>
): Promise<void> => {
  const ask = await findAskById(action.askId);
  const project = ask && findProject(ask.project);
  const run = ask && (await runOf(ask));
  const ticket = run && readAskReport(run.report)?.ticket;
  if (!ask || !project || !run || !ticket || !ask.slackTs) {
    return;
  }
  if (!isAllowedSlackUser(project, action.userId)) {
    log('info', 'slack ticket tap from someone not allowed', { project: project.name, user: action.userId });
    await tellTapper(notAllowedToStartText(project));
    return;
  }
  const { name, email } = await slackUser(action.userId).catch(() => ({ name: action.userId, email: null }));
  const now = new Date();
  const started = action.choice === 'start';
  // Claimed before Linear is asked, so a second tap, here or anywhere, files nothing.
  const [claimed] = await getDb()
    .update(asks)
    .set({ ticketFiledBy: name, ticketFiledAt: now, ticketStarted: started })
    .where(and(eq(asks.id, ask.id), isNull(asks.ticketFiledAt)))
    .returning();
  if (!claimed) {
    await tellTapper(ASK_TICKET_GONE);
    return;
  }
  const organizationId = requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID');
  // The agent wrote the request from public repo and Linear text, so it's made inert like a job's findings.
  const filing = askTicketIssue(
    { title: ticket.title, request: neutraliseMarkdown(ticket.request) },
    await askContextFor(ask, run)
  );
  // Unassigned like any Slack request: whoever starts it owns it. Sized by the agent that suggested it.
  const issue = await createIssue(organizationId, {
    teamKey: project.linear.teamKey,
    ...filing,
    assigneeId: null,
    estimate: ticket.estimate
  }).catch((error: unknown) => {
    log('error', 'linear issue for a question failed', { askId: ask.id, error: errorMessage(error) });
    return undefined;
  });
  if (!issue) {
    await getDb()
      .update(asks)
      .set({ ticketFiledBy: null, ticketFiledAt: null, ticketStarted: null })
      .where(eq(asks.id, ask.id));
    await tellTapper('I couldn’t file this in Linear, so nothing was filed. Try again in a minute.');
    return;
  }
  log('info', 'question ticket filed', { askId: ask.id, issue: issue.identifier, started });
  const filed = { ...claimed, ticketIssueId: issue.id, ticketIdentifier: issue.identifier, ticketUrl: issue.url };
  await getDb()
    .update(asks)
    .set({ ticketIssueId: issue.id, ticketIdentifier: issue.identifier, ticketUrl: issue.url })
    .where(eq(asks.id, ask.id));
  const answer = answerMessageFor(project, filed, run, {
    identifier: issue.identifier,
    url: issue.url,
    by: name,
    at: now,
    started
  });
  const { answerSlackTs } = ask;
  if (answer && answerSlackTs) {
    await attempt('slack edit', { askId: ask.id }, () =>
      updateSlackMessage({ channel: ask.slackChannelId, ts: answerSlackTs, ...answer })
    );
  }
  const thread = { channel: ask.slackChannelId, threadTs: ask.slackTs };
  const say = (message: SlackMessage) =>
    attempt('slack reply', { askId: ask.id }, () => postSlackMessage({ ...thread, ...message }));
  if (!started) {
    await say(filedForLaterMessage(issue, project.alias));
    await refreshAskCard(project, filed);
    return;
  }
  const starter = { name, assigneeId: await linearUserFor(organizationId, action.userId, email) };
  await startFiledIssue(project, issue, thread, starter, () => say(filedStartedMessage(issue)));
};

const handleTap = async (
  action: SlackAction,
  tellTapper: (message: string | SlackMessage) => Promise<void>
): Promise<void> => {
  if (action.kind === 'home') {
    await handleHomeTap(action, tellTapper);
    return;
  }
  if (action.kind === 'delegate') {
    await handleDelegateTap(action, tellTapper);
    return;
  }
  if (action.kind === 'rerun') {
    await handleRerunTap(action.runId, action.userId, tellTapper);
    return;
  }
  if (action.kind === 'findings') {
    await handleFindingsTap(action, tellTapper);
    return;
  }
  if (action.kind === 'merge') {
    await handleMergeTap(action, tellTapper);
    return;
  }
  if (action.kind === 'ask_ticket') {
    await handleAskTicketTap(action, tellTapper);
    return;
  }
  if (action.kind === 'filed') {
    await handleFiledTap(action, tellTapper);
    return;
  }
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
  if (action.kind === 'gate' && (workItem.gateSlackTs === null || workItem.stage === 'spec_review')) {
    await tellTapper(GATE_GONE);
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

// A branch's head as of a moment: the last push to it GitHub told us about before then.
const branchHeadBefore = async (repository: string, branch: string, before: Date): Promise<string | null> => {
  const [push] = await getDb()
    .select({ head: sql<string | null>`${events.payload}->>'after'` })
    .from(events)
    .where(
      and(
        eq(events.source, 'github'),
        eq(events.type, 'push'),
        sql`${events.payload}->'repository'->>'full_name' = ${repository}`,
        sql`${events.payload}->>'ref' = ${`refs/heads/${branch}`}`,
        lt(events.receivedAt, before)
      )
    )
    .orderBy(desc(events.receivedAt))
    .limit(1);
  return push?.head ?? null;
};

// The commit the merge gate waits on: the branch's head when the last review started (what it checked out), or, after
// a conflict fix that changed only lockfiles, when that fix finished. Null when it can't be told, so nothing merges.
const acceptedHead = async (workItem: WorkItem): Promise<string | null> => {
  const { repository, branch } = workItem;
  const [latest] = await getDb()
    .select({ agent: runs.agent, trigger: runs.trigger, createdAt: runs.createdAt, finishedAt: runs.finishedAt })
    .from(runs)
    .where(eq(runs.workItemId, workItem.id))
    .orderBy(desc(runs.createdAt))
    .limit(1);
  if (!branch || !latest) {
    return null;
  }
  if (latest.agent === 'review') {
    return branchHeadBefore(repository, branch, latest.createdAt);
  }
  return latest.agent === 'implement' && latest.trigger === 'conflict' && latest.finishedAt
    ? branchHeadBefore(repository, branch, latest.finishedAt)
    : null;
};

// After a run reports: close the session if the agent didn't, mirror to Slack, start the next stage or resume a
// limit-hit run, free its slot.
const LOCKFILE_GATE_TEXT = 'Only lockfiles conflicted, so it’s back at the merge gate without another review.';

// Whether a conflict fix changed only lockfiles, from GitHub's record rather than the run's report: the PR's last
// review accepted it, the PR still targets the default branch, the new head merges a commit already on it into exactly the commit that review saw
// (the branch's last push before it, from the webhooks), and apart from lockfiles the PR's changes are the reviewed
// ones. A lockfile's contents aren't checked here: its manifest is, and CI installs from it.
const lockfileOnlyMerge = async (
  run: { agent: AgentRole; trigger: RunTrigger; createdAt: Date },
  workItem: WorkItem
): Promise<boolean> => {
  const { prNumber, branch, repository } = workItem;
  if (run.agent !== 'implement' || run.trigger !== 'conflict' || !prNumber || !branch) {
    return false;
  }
  const [review] = await getDb()
    .select({ report: runs.report, createdAt: runs.createdAt })
    .from(runs)
    .where(
      and(
        eq(runs.workItemId, workItem.id),
        eq(runs.agent, 'review'),
        eq(runs.status, 'finished'),
        lt(runs.createdAt, run.createdAt)
      )
    )
    .orderBy(desc(runs.createdAt))
    .limit(1);
  if (!review || reviewVerdict(review.report) !== 'accepted') {
    return false;
  }
  const reviewed = await branchHeadBefore(repository, branch, review.createdAt);
  if (!reviewed) {
    return false;
  }
  try {
    const [pull, mainBranch] = await Promise.all([pullHead(repository, prNumber), defaultBranch(repository)]);
    const { head } = pull;
    const [firstParent, base, ...more] = await commitParents(repository, head);
    // Factory PRs target the default branch, and the merged-in parent must already be on it, or code in it would never
    // be compared. A PR retargeted elsewhere is reviewed.
    if (
      pull.base !== mainBranch ||
      firstParent !== reviewed ||
      !base ||
      more.length > 0 ||
      !(await branchContains(repository, mainBranch, base))
    ) {
      return false;
    }
    const [before, after] = await Promise.all([
      compareFiles(repository, base, reviewed),
      compareFiles(repository, base, head)
    ]);
    return before !== undefined && after !== undefined && onlyLockfilesChanged(before, after);
  } catch (error) {
    log('warn', 'lockfile-only check failed', { issue: workItem.issueIdentifier, error: errorMessage(error) });
    return false;
  }
};

// When an earlier verify run on the work item met every criterion, as the thread shows the time.
// Only the latest verify run counts: one that met everything before a later run found something not met proves nothing.
const verifiedAt = async (project: FactoryConfig, workItemId: string): Promise<string | undefined> => {
  const [latest] = await getDb()
    .select({ report: runs.report, finishedAt: runs.finishedAt })
    .from(runs)
    .where(
      and(
        eq(runs.workItemId, workItemId),
        eq(runs.agent, 'verify'),
        eq(runs.status, 'finished'),
        eq(runs.outcome, 'done')
      )
    )
    .orderBy(desc(runs.finishedAt))
    .limit(1);
  return latest?.finishedAt && metEveryCriterion(latest.report)
    ? formatReleaseAt(latest.finishedAt, new Date(), project.timeZone)
    : undefined;
};

// Whether a delivered PR is verified, from GitHub's list of its files, the implement run's report and, for a revision
// that fixes review findings, the last verify run: any other revision (a reply asking for a change, a CI or conflict
// fix) is verified again. When GitHub can't say, it's verified: a run spent for nothing costs less than a change nobody
// looked at.
const needsVerify = async (
  project: FactoryConfig,
  run: { agent: AgentRole; trigger: RunTrigger; status: RunStatus; outcome: RunOutcome | null; report: unknown },
  workItem: WorkItem
): Promise<VerifyDecision> => {
  const { prNumber, repository } = workItem;
  if (
    !project.verify ||
    run.agent !== 'implement' ||
    run.status !== 'finished' ||
    run.outcome !== 'done' ||
    !prNumber
  ) {
    return { verify: false };
  }
  try {
    const [files, verified] = await Promise.all([
      pullFiles(repository, prNumber),
      reverifiesOnRequest(run.trigger) ? verifiedAt(project, workItem.id) : undefined
    ]);
    return decideVerify(project.verify.paths, files, run.report, verified);
  } catch (error) {
    log('warn', 'verify check failed', { issue: workItem.issueIdentifier, pr: prNumber, error: errorMessage(error) });
    return { verify: true };
  }
};

export const handleRunFinished = withCards(async (runId: string): Promise<void> => {
  const found = await findRun(runId);
  const project = found && findProject(found.workItem.project);
  if (!found || !project) {
    return;
  }
  const { run, workItem } = found;
  touchCard(workItem.id);
  const resuming = shouldResume(run);
  const [parent] = run.parentRunId
    ? await getDb()
        .select({
          agent: runs.agent,
          status: runs.status,
          outcome: runs.outcome,
          report: runs.report,
          costUsd: runs.costUsd
        })
        .from(runs)
        .where(eq(runs.id, run.parentRunId))
        .limit(1)
    : [];
  // A run whose agent never started is tried once more by itself; nobody need be watching.
  const retrying = shouldRetry(run, parent);
  const verifying = await needsVerify(project, run, workItem);
  const next = nextStepAfterRun(run, {
    hasPr: workItem.prNumber !== null,
    lockfileOnlyMerge: await lockfileOnlyMerge(run, workItem),
    verify: verifying.verify,
    verifyPrompt: verifying.again ? `Verify again, as the implement run asked: ${verifying.again}` : null,
    reviewRounds: workItem.reviewRounds,
    maxReviewRounds: project.review.maxRounds
  });
  // Reported questions and gates are the run's last word: the router posts them instead of closing the session.
  const agentClosed =
    !next.questions && !next.gate && run.status === 'finished' && workItem.agentSessionId && run.startedAt
      ? await hasClosingActivity(workItem.linearOrganizationId, workItem.agentSessionId, run.startedAt).catch(
          (error: unknown) => {
            log('error', 'linear session check failed', { runId, error: errorMessage(error) });
            return true;
          }
        )
      : false;
  const closing =
    next.questions || retrying
      ? undefined
      : next.gate
        ? ({ type: 'elicitation', body: next.gate.body } as const)
        : closingActivity(run, { agentClosed, resuming });
  const prUrl = workItem.prNumber ? `https://github.com/${workItem.repository}/pull/${workItem.prNumber}` : null;
  const skippedReview = run.agent === 'implement' && next.stage === 'awaiting_merge';
  const finishedText = [
    slackFinishedText(
      { ...run, prUrl, actionsRunUrl: run.actionsRunUrl },
      { questions: next.questions?.length, specReview: next.stage === 'spec_review', gate: next.gate !== undefined }
    ),
    ...(skippedReview ? [LOCKFILE_GATE_TEXT] : []),
    // Said where people look, so a wrong call can be challenged: review sees the same reason in the PR's Evidence.
    ...(verifying.skipped ? [`Skipped verify: ${escapeSlack(verifying.skipped)}`] : []),
    ...(verifying.again ? [`Verifying again: ${escapeSlack(verifying.again)}`] : [])
  ].join('\n');
  const rerunnable =
    run.status === 'finished' &&
    run.outcome === 'failed' &&
    canRerun(run, {
      stage: workItem.stage,
      hasPr: workItem.prNumber !== null,
      reviewRounds: workItem.reviewRounds,
      maxReviewRounds: project.review.maxRounds
    });
  const waitsOnPerson = run.status === 'finished' && BLOCKING_OUTCOMES.includes(run.outcome) && !retrying;
  // Questions and gates mention the person in their own messages, which follow this one.
  const mentionFinished = waitsOnPerson || (next.stage === 'awaiting_merge' && !next.questions && !next.gate);
  const asking = askingFor(project, workItem);
  const mentionIf = <M extends string | SlackMessage>(message: M): M => (mentionFinished ? asking(message) : message);
  if (next.reviewRounds !== undefined) {
    // Recorded before the revision dispatches, so its brief names the round it's fixing.
    await getDb()
      .update(workItems)
      .set({ reviewRounds: next.reviewRounds, updatedAt: new Date() })
      .where(eq(workItems.id, workItem.id));
  }

  // Ready to merge: the message carries Approve and merge, and is settled once the PR is merged or closed.
  const readyToMerge =
    next.stage === 'awaiting_merge' && !next.questions && !next.gate && !retrying && !rerunnable && workItem.prNumber;
  // Review findings nobody has to decide on: chosen with a tap when the PR waits at the merge gate, listed when the next
  // round takes them. Beside questions, they wait for the answers, so the round's decisions settle in one revision.
  const findings = run.agent === 'review' && run.outcome === 'done' ? readFixableFindings(run.report) : [];
  const listingFindings =
    findings.length > 0 && !next.questions && (next.stage === 'awaiting_merge' || next.stage === 'building');
  // Chosen with Approve and merge beside Fix ticked, under the findings rather than on the message above.
  const mergeNotes = {
    beforeMerging: run.agent === 'review' ? readBeforeMerging(run.report) : undefined,
    mergeEffect: project.mergeEffect,
    findingsLeft: readyToMerge && listingFindings ? findings.length : undefined
  };
  const reply = retrying
    ? retryText(run.agent, run.actionsRunUrl)
    : rerunnable
      ? mentionIf(withRerunButton(finishedText, run.id))
      : readyToMerge && prUrl
        ? mentionIf(
            slackAcceptedMessage(finishedText, {
              workItemId: workItem.id,
              prNumber: readyToMerge,
              prUrl,
              ...mergeNotes
            })
          )
        : mentionIf(finishedText);
  const [, replyTs] = await Promise.all([
    closing ? postActivity(workItem, closing, next.gate?.options) : undefined,
    replyInThread(project, workItem, reply),
    waitsOnPerson
      ? attempt('linear blocked label', { issue: workItem.issueIdentifier }, () =>
          setBlockedLabel(workItem.linearOrganizationId, workItem.linearIssueId, true)
        )
      : undefined,
    next.stage
      ? moveWorkItem(project, workItem, next.stage, { asking: Boolean(next.questions || next.gate) })
      : undefined
  ]);
  // Filed before any gate or question below, so the thread's last message is still the one waiting on a person.
  const requested = await fileRequestedIssues(project, found);
  if (requested.length > 0) {
    await Promise.all([
      replyInThread(project, workItem, filedFollowUpsText(requested)),
      postActivity(workItem, { type: 'thought', body: filedFollowUpsText(requested, 'markdown') })
    ]);
  }
  if (readyToMerge && replyTs && !mergeNotes.findingsLeft) {
    await getDb().update(workItems).set({ mergeSlackTs: replyTs }).where(eq(workItems.id, workItem.id));
  }
  if (next.questions) {
    await startQuestions(project, workItem, run, next.questions);
  }
  if (next.stage === 'spec_review') {
    const gate = slackSpecGateMessage(workItem.id, {
      specUrl: specUrl(workItem),
      prUrl,
      issueUrl: workItem.issueUrl
    });
    const ts = await replyInThread(project, workItem, asking(gate));
    await getDb()
      .update(workItems)
      .set({ gateSlackTs: ts ?? null })
      .where(eq(workItems.id, workItem.id));
  }
  if (next.gate) {
    const ts = await replyInThread(
      project,
      workItem,
      asking(slackGateMessage(workItem.id, next.gate, workItem.issueUrl))
    );
    await getDb()
      .update(workItems)
      .set({ gateSlackTs: ts ?? null })
      .where(eq(workItems.id, workItem.id));
  }
  if (listingFindings) {
    const findingsTs = await replyInThread(
      project,
      workItem,
      slackFindingsMessage(
        { id: run.id, round: next.reviewRounds ?? workItem.reviewRounds },
        findings,
        { repository: workItem.repository, branch: workItem.branch },
        next.stage === 'awaiting_merge',
        readyToMerge && mergeNotes.findingsLeft ? mergeButton(workItem.id, readyToMerge, mergeNotes, false) : undefined
      )
    );
    if (readyToMerge && mergeNotes.findingsLeft && findingsTs) {
      await getDb().update(workItems).set({ mergeSlackTs: findingsTs }).where(eq(workItems.id, workItem.id));
    }
  }
  if (next.request && queuedAlready(next.request, await queuedRuns(workItem))) {
    log('info', 'next run already queued', { runId, issue: workItem.issueIdentifier, agent: next.request.agent });
  } else if (next.request) {
    await dispatchRun(project, await createRun(project, workItem, next.request, run.id));
  }
  if (resuming) {
    await dispatchRun(project, await createRun(project, workItem, resumeRequestFor(run.agent), run.id));
  }
  if (retrying) {
    log('info', 'run never started, retrying', { runId, issue: workItem.issueIdentifier, agent: run.agent });
    const again = { agent: run.agent, trigger: run.trigger, priority: run.priority, prompt: run.prompt };
    await dispatchRun(project, await createRun(project, workItem, again, run.id));
  }
  await fileGuards(project, found);
  await releaseQueue();
});

// A human's status change or undelegation in Linear, and what an issue finishing unblocks. Issues the factory never
// worked on have no work item.
export const handleIssueUpdate = withCards(async (payload: unknown): Promise<void> => {
  const update = parseIssueUpdate(payload);
  if (!update || update.organizationId !== requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID')) {
    return;
  }
  const { state, teamKey } = update;
  if (state && teamKey && FINISHED_STATE_TYPES.includes(state.type)) {
    await attempt('ready announcement', { issue: update.identifier }, () =>
      announceUnblocked(teamKey, update.identifier, state.type === 'canceled')
    );
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
  const linearFields = {
    estimate: update.estimate,
    projectName: update.project?.name ?? null,
    projectUrl: update.project?.url ?? null,
    milestoneName: update.milestone
  };
  if (Object.entries(linearFields).some(([field, value]) => workItem[field as keyof typeof linearFields] !== value)) {
    await getDb().update(workItems).set(linearFields).where(eq(workItems.id, workItem.id));
    touchCard(workItem.id);
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
});

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
  // A deployment's checks name the commit; the PR is the open one whose head it still is.
  const prNumbers =
    event.prNumbers.length === 0 && event.headSha
      ? await openPullsWithHead(event.repository, event.headSha).catch((error: unknown) => {
          log('warn', 'pulls for commit failed', { sha: event.headSha, error: errorMessage(error) });
          return [];
        })
      : event.prNumbers;
  if (prNumbers.length === 0) {
    return;
  }
  const [workItem] = await getDb()
    .select()
    .from(workItems)
    .where(and(eq(workItems.repository, event.repository), inArray(workItems.prNumber, prNumbers)))
    .limit(1);
  if (!workItem) {
    await takeOnFailedDependencyPr({ ...event, prNumbers });
    return;
  }
  const project = findProject(workItem.project);
  if (!project) {
    return;
  }
  // Starting a fix would close a review's questions unanswered; the answers check the PR's head again.
  if (await openRound(workItem)) {
    log('info', 'ci failure held for questions', { issue: workItem.issueIdentifier, workflow: event.workflow });
    return;
  }
  await startCiFix(project, workItem, event);
};

// A failed check on a delivered PR goes back to implement, within the rules of `decideCiFailure`.
const startCiFix = async (
  project: FactoryConfig,
  workItem: WorkItem,
  failure: { workflow: string; url: string | null }
): Promise<'fixing' | 'handed_over' | 'left'> => {
  const history = await getDb()
    .select({ agent: runs.agent, trigger: runs.trigger, status: runs.status })
    .from(runs)
    .where(eq(runs.workItemId, workItem.id))
    .orderBy(desc(runs.createdAt));
  const action = decideCiFailure(failure, {
    stage: workItem.stage,
    openRuns: history.filter(({ status }) => OPEN_STATUSES.includes(status)).length,
    ciFixes: consecutiveCiFixes(history)
  });
  log('info', 'ci failure', { issue: workItem.issueIdentifier, workflow: failure.workflow, action: action.kind });
  if (action.kind === 'fix') {
    await dispatchRun(project, await createRun(project, workItem, action.request));
    return 'fixing';
  }
  if (action.kind === 'hand_over') {
    const text = ciHandOverText(failure.workflow, failure.url);
    await Promise.all([
      postActivity(workItem, { type: 'error', body: text }),
      replyInThread(project, workItem, askingFor(project, workItem)(text))
    ]);
    return 'handed_over';
  }
  return 'left';
};

// A check failing on the PR's head now, if any.
const headFailure = async (workItem: WorkItem): Promise<{ workflow: string; url: string } | undefined> => {
  const { prNumber, repository } = workItem;
  if (!prNumber) {
    return undefined;
  }
  try {
    const { head } = await pullHead(repository, prNumber);
    return failedChecks(await commitRuns(repository, head))[0];
  } catch (error) {
    log('warn', 'head checks failed to load', { issue: workItem.issueIdentifier, error: errorMessage(error) });
    return undefined;
  }
};

// At the merge gate, a check that failed on the PR's head while a run was going (and so was left then) gets its fix.
const checkFailedChecks = async (project: FactoryConfig, workItem: WorkItem): Promise<'fixing' | 'clean'> => {
  const failed = await headFailure(workItem);
  if (!failed) {
    return 'clean';
  }
  const [current] = await getDb().select().from(workItems).where(eq(workItems.id, workItem.id));
  return (await startCiFix(project, current ?? workItem, failed)) === 'fixing' ? 'fixing' : 'clean';
};

// A Dependabot PR that needs work becomes a work item on its branch, filed in Linear with what to do, and starts the
// way a Slack request does: the work item exists before the session opens, so whichever of the console and Linear's
// session event claims the session starts the same implement run, which reads its instructions from the issue.
const takeOnDependencyPr = async (pr: DependencyPr, work: DependencyWork): Promise<void> => {
  const project = allProjects().find((candidate) => repositoryOf(candidate) === pr.repository);
  if (!project) {
    return;
  }
  const [existing] = await getDb()
    .select({ id: workItems.id })
    .from(workItems)
    .where(and(eq(workItems.repository, pr.repository), eq(workItems.prNumber, pr.number)))
    .limit(1);
  if (existing) {
    return;
  }
  const organizationId = requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID');
  const filing = dependencyIssue(pr, work);
  const issue = await createIssue(organizationId, {
    teamKey: project.linear.teamKey,
    ...filing,
    assigneeId: null
  }).catch((error: unknown) => {
    log('error', 'linear issue for a dependency pr failed', { pr: pr.number, error: errorMessage(error) });
    return undefined;
  });
  if (!issue) {
    return;
  }
  log('info', 'dependency pr taken on', { pr: pr.number, issue: issue.identifier, work: work.kind });
  const [workItem] = await getDb()
    .insert(workItems)
    .values({
      project: project.name,
      repository: pr.repository,
      linearOrganizationId: organizationId,
      linearIssueId: issue.id,
      issueIdentifier: issue.identifier,
      issueUrl: issue.url,
      title: issue.title,
      origin: 'dependabot',
      requester: 'Dependabot',
      stage: 'building',
      branch: pr.branch,
      prNumber: pr.number
    })
    .returning();
  if (!workItem) {
    return;
  }
  await recordStageChange(workItem, workItem.stage, 'dependabot');
  await openSlackThread(project, workItem, issue.title);
  const [threaded] = await getDb().select().from(workItems).where(eq(workItems.id, workItem.id)).limit(1);
  await replyInThread(project, threaded ?? workItem, dependencyTakenText(pr, work, issue));
  try {
    const sessionId = await createSessionOnIssue(organizationId, issue.id);
    await startWork(project, {
      kind: 'created',
      organizationId,
      sessionId,
      issue: { ...issue, teamKey: project.linear.teamKey },
      requester: 'Dependabot'
    });
  } catch (error) {
    log('error', 'starting a dependency pr failed', { issue: issue.identifier, error: errorMessage(error) });
    await replyInThread(
      project,
      threaded ?? workItem,
      `I couldn’t start on it. Delegate <${issue.url}|${issue.identifier}> to @${project.alias} in Linear to start.`
    );
    return;
  }
  await attempt('linear delegate', { issue: issue.identifier }, async () =>
    delegateIssue(organizationId, issue.id, await findAppUserId(organizationId))
  );
};

// A major version needs real work; anything else waits for CI to say whether it does.
const handleDependencyPrOpened = async (pr: DependencyPr): Promise<void> => {
  const bump = readBump(pr.title);
  if (bump && isMajorBump(bump)) {
    await takeOnDependencyPr(pr, { kind: 'major', bump });
  }
};

// CI failed on a PR the factory isn't working on: if Dependabot opened it, the factory fixes it.
const takeOnFailedDependencyPr = async (event: Extract<GitHubEvent, { kind: 'ci_failed' }>): Promise<void> => {
  const [number] = event.prNumbers;
  if (number === undefined || event.prNumbers.length > 1) {
    return;
  }
  const pull = await pullRequestInfo(event.repository, number).catch((error: unknown) => {
    log('warn', 'pull request lookup failed', { pr: number, error: errorMessage(error) });
    return undefined;
  });
  if (pull?.author !== DEPENDABOT_LOGIN || pull.headRepository !== event.repository) {
    return;
  }
  await takeOnDependencyPr(
    { repository: event.repository, number, branch: pull.branch, title: pull.title, url: pull.url },
    { kind: 'ci_failed', workflow: event.workflow, runUrl: event.url }
  );
};

// Something landed on the default branch: every delivered PR into it may conflict now.
const handleDefaultBranchMoved = async (event: Extract<GitHubEvent, { kind: 'default_branch_moved' }>) => {
  const delivered = await getDb()
    .select()
    .from(workItems)
    .where(
      and(
        eq(workItems.repository, event.repository),
        inArray(workItems.stage, ['in_review', 'awaiting_merge']),
        isNotNull(workItems.prNumber)
      )
    );
  await Promise.all(
    delivered.map(async (workItem) => {
      const project = findProject(workItem.project);
      return project ? checkConflict(project, workItem) : undefined;
    })
  );
};

// A factory PR merged or closed settles its work item; a person pushing to its branch counts against autonomy; a
// failed check on a delivered PR, or one that stops merging, goes back to implement.
export const handleGitHubEvent = withCards(async (eventName: string, payload: unknown): Promise<void> => {
  const event = parseGitHubEvent(eventName, payload);
  if (!event) {
    return;
  }
  if (event.kind === 'ci_failed') {
    await handleCiFailure(event);
    return;
  }
  if (event.kind === 'default_branch_moved') {
    await handleDefaultBranchMoved(event);
    return;
  }
  if (event.kind === 'dependency_pr_opened') {
    await handleDependencyPrOpened(event);
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
  if (stage && workItem.origin === 'dependabot') {
    // Linear's GitHub integration links a PR by the issue ID in its branch or text, which Dependabot's don't carry.
    await moveTo(project, workItem, stage);
  }
  // The accepted message says it in place of a reply, so nobody following the thread is notified again.
  if (!(await settleMergeMessage(project, workItem, event))) {
    await replyInThread(project, workItem, prClosedText(event.number, event.merged));
  }
  await stopForCause(project, workItem, { kind: 'pr_closed', number: event.number, merged: event.merged });
});

// Review's accepted message, once its PR is merged or closed: the buttons go, and it says who merged it and when.
const settleMergeMessage = async (
  project: FactoryConfig,
  workItem: WorkItem,
  event: Extract<GitHubEvent, { kind: 'pr_closed' }>
): Promise<boolean> => {
  const person = event.mergedBy ? personForGitHub(project, event.mergedBy.id) : undefined;
  const line = event.merged
    ? mergedLine({
        by: person ? personName(person) : (event.mergedBy?.login ?? null),
        time: clock(new Date(), project.timeZone),
        repository: workItem.repository,
        sha: event.mergeCommitSha
      })
    : closedLine(event.number);
  return settleAcceptedMessage(project, workItem, line);
};

// The buttons come off review's accepted message, and a line says why. Its `ts` is forgotten once settled.
const settleAcceptedMessage = async (project: FactoryConfig, workItem: WorkItem, line: string): Promise<boolean> => {
  const channel = workItem.slackChannelId ?? project.slack?.channelId;
  const { mergeSlackTs: ts, slackThreadTs: threadTs } = workItem;
  if (!channel || !ts || !threadTs) {
    return false;
  }
  try {
    const message = await slackThreadMessage(channel, threadTs, ts);
    if (!message) {
      return false;
    }
    await updateSlackMessage({
      channel,
      ts,
      text: `${message.text}\n${line}`,
      blocks: slackMergeSettled(message.blocks, line)
    });
    await getDb().update(workItems).set({ mergeSlackTs: null }).where(eq(workItems.id, workItem.id));
    touchCard(workItem.id);
    return true;
  } catch (error) {
    log('warn', 'slack merge settle failed', { issue: workItem.issueIdentifier, error: errorMessage(error) });
    return false;
  }
};
