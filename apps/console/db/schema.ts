import {
  AGENT_ROLES,
  ANSWER_SOURCES,
  HOLD_REASONS,
  PRIORITIES,
  PROBLEM_LEVELS,
  RUN_OUTCOMES,
  RUN_STATUSES,
  RUN_TRIGGERS,
  STAGES,
  USAGE_SOURCES,
  USAGE_STATUSES,
  USAGE_WINDOWS,
  WORK_ORIGINS
} from '@mb-factory/core';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

export const linearInstallations = pgTable('linear_installations', {
  id: uuid().primaryKey().defaultRandom(),
  organizationId: text().notNull().unique(),
  organizationName: text().notNull(),
  appUserId: text().notNull(),
  accessToken: text().notNull(),
  refreshToken: text().notNull(),
  accessTokenExpiresAt: timestamp({ withTimezone: true }).notNull(),
  scopes: text().array().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
});

// A person's GitHub connection through the factory's GitHub App, so a tap in Slack can approve and merge as them.
// Tokens are AES-256-GCM encrypted; the access token lasts 8 hours and the refresh token, which rotates, 6 months.
export const githubConnections = pgTable('github_connections', {
  githubUserId: integer().primaryKey(),
  login: text().notNull(),
  accessToken: text().notNull(),
  // Null when the app's tokens don't expire, so there's nothing to refresh.
  accessTokenExpiresAt: timestamp({ withTimezone: true }),
  refreshToken: text(),
  refreshTokenExpiresAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
});

export const events = pgTable(
  'events',
  {
    id: uuid().primaryKey().defaultRandom(),
    source: text({ enum: ['linear', 'slack', 'github'] }).notNull(),
    deliveryId: text().notNull(),
    type: text().notNull(),
    action: text(),
    payload: jsonb().notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex('events_source_delivery_idx').on(table.source, table.deliveryId)]
);

export const workItems = pgTable(
  'work_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    project: text().notNull(),
    repository: text().notNull(),
    linearOrganizationId: text().notNull(),
    linearIssueId: text().notNull().unique(),
    issueIdentifier: text().notNull(),
    issueUrl: text().notNull(),
    // The issue's title when it was last delegated, for the console.
    title: text(),
    linearProjectId: text(),
    agentSessionId: text(),
    origin: text({ enum: WORK_ORIGINS }).notNull(),
    slackChannelId: text(),
    slackThreadTs: text(),
    // The open gate's message in the thread, edited once it's answered: the spec approval while Spec Review waits, or a
    // gate a stage reported, such as slicing approval. The column keeps its first name.
    gateSlackTs: text('spec_gate_slack_ts'),
    requester: text(),
    stage: text({ enum: STAGES }).notNull(),
    reviewRounds: integer().notNull().default(0),
    branch: text(),
    prNumber: integer(),
    // Pushes by people to the work item's branch: a merged PR with none counts as autonomous.
    humanPushes: integer().notNull().default(0),
    // Linear's estimate (1, 2, 3, 5 or 8), as triage set it, for usage by PR size.
    estimate: integer(),
    // The issue's project and milestone in Linear, from its updates, for the Slack card.
    projectName: text(),
    projectUrl: text(),
    milestoneName: text(),
    // The Linear assignee's email when a stage last started, for the card's name and the Slack mention.
    assigneeEmail: text(),
    // Issues this one's finishing made ready, offered on its Slack card (core `NextIssue`).
    nextReady: jsonb(),
    // Review's "accepted" message in the thread, with Approve and merge, settled once the PR is merged or closed.
    mergeSlackTs: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('work_items_agent_session_idx').on(table.agentSessionId),
    index('work_items_repository_branch_idx').on(table.repository, table.branch)
  ]
);

export const runs = pgTable(
  'runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    // Empty for a scheduled job's run, which belongs to `project` and `job` instead, and for a question's (`ask`), which
    // belongs to `project` and its row in `asks`.
    workItemId: uuid().references(() => workItems.id, { onDelete: 'cascade' }),
    project: text(),
    job: text(),
    parentRunId: uuid().references((): AnyPgColumn => runs.id, { onDelete: 'set null' }),
    agent: text({ enum: AGENT_ROLES }).notNull(),
    model: text().notNull(),
    trigger: text({ enum: RUN_TRIGGERS }).notNull(),
    priority: text({ enum: PRIORITIES }).notNull(),
    // The human's message for a prompted run, held until the brief is rendered at dispatch.
    prompt: text(),
    status: text({ enum: RUN_STATUSES }).notNull(),
    // GitHub login of whoever chose "allow once": the run then skips usage holds and the pause, not the run caps.
    usageOverrideBy: text(),
    outcome: text({ enum: RUN_OUTCOMES }),
    summary: text(),
    report: jsonb(),
    actionsRunId: text(),
    actionsRunUrl: text(),
    transcriptUrl: text(),
    inputTokens: integer(),
    outputTokens: integer(),
    cacheReadInputTokens: integer(),
    cacheCreationInputTokens: integer(),
    // API-equivalent cost from the run's result event: a comparison metric, not a bill.
    costUsd: doublePrecision(),
    durationMs: integer(),
    numTurns: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp({ withTimezone: true }),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true })
  },
  (table) => [
    index('runs_work_item_idx').on(table.workItemId, table.createdAt),
    index('runs_active_idx').on(table.status).where(sql`${table.status} in ('dispatched', 'running')`),
    index('runs_job_idx').on(table.project, table.job, table.createdAt).where(sql`${table.job} is not null`),
    check(
      'runs_work_item_job_or_question',
      sql`(${table.workItemId} is not null)::int + (${table.job} is not null)::int + (${table.agent} = 'ask')::int = 1`
    ),
    check('runs_without_work_item_have_project', sql`${table.workItemId} is not null or ${table.project} is not null`)
  ]
);

// Every stage a work item entered, with when: its own moves and the ones it followed from Linear or GitHub. Stage times
// on the dashboard come from here.
export const stageChanges = pgTable(
  'stage_changes',
  {
    id: uuid().primaryKey().defaultRandom(),
    workItemId: uuid()
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
    stage: text({ enum: STAGES }).notNull(),
    cause: text().notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('stage_changes_work_item_idx').on(table.workItemId, table.at)]
);

// One row per scheduled slot that fired: inserting it is what fires the slot, so it runs once however many wakes
// arrive.
export const jobSlots = pgTable(
  'job_slots',
  {
    id: uuid().primaryKey().defaultRandom(),
    project: text().notNull(),
    job: text().notNull(),
    slotAt: timestamp({ withTimezone: true }).notNull(),
    runId: uuid().references(() => runs.id, { onDelete: 'set null' }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex('job_slots_slot_idx').on(table.project, table.job, table.slotAt)]
);

// Each Linear issue a job filed, by the finding's fingerprint, so the same finding isn't filed twice.
export const jobFindings = pgTable(
  'job_findings',
  {
    id: uuid().primaryKey().defaultRandom(),
    project: text().notNull(),
    job: text().notNull(),
    fingerprint: text().notNull(),
    linearIssueId: text().notNull(),
    issueIdentifier: text().notNull(),
    issueUrl: text().notNull(),
    runId: uuid().references(() => runs.id, { onDelete: 'set null' }),
    filedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('job_findings_fingerprint_idx').on(table.project, table.job, table.fingerprint, table.filedAt)]
);

// Questions a stage reported, which the router asks one at a time; the answers go back to the stage in one run.
// Closed when something else happened to the work item before they were all answered.
export const questions = pgTable(
  'questions',
  {
    id: uuid().primaryKey().defaultRandom(),
    // The run that asked.
    runId: uuid()
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    position: integer().notNull(),
    prompt: text().notNull(),
    // A few words naming the decision, for the list of questions still to come.
    topic: text(),
    // Why it matters, shown under the question.
    why: text(),
    // The suggested option first.
    options: text().array().notNull(),
    answer: text(),
    answerSource: text({ enum: ANSWER_SOURCES }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    askedAt: timestamp({ withTimezone: true }),
    answeredAt: timestamp({ withTimezone: true }),
    closedAt: timestamp({ withTimezone: true }),
    // The round's message in the work item's Slack thread, edited as it's answered; the same on every row of a round.
    slackTs: text()
  },
  (table) => [
    uniqueIndex('questions_run_position_idx').on(table.runId, table.position),
    index('questions_open_idx').on(table.runId).where(sql`${table.answeredAt} is null and ${table.closedAt} is null`)
  ]
);

export const usageReadings = pgTable(
  'usage_readings',
  {
    id: uuid().primaryKey().defaultRandom(),
    window: text({ enum: USAGE_WINDOWS }).notNull(),
    utilisation: doublePrecision().notNull(),
    resetsAt: timestamp({ withTimezone: true }).notNull(),
    status: text({ enum: USAGE_STATUSES }),
    source: text({ enum: USAGE_SOURCES }).notNull(),
    runId: uuid().references(() => runs.id, { onDelete: 'set null' }),
    takenAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('usage_readings_window_taken_idx').on(table.window, table.takenAt.desc())]
);

export const queue = pgTable(
  'queue',
  {
    id: uuid().primaryKey().defaultRandom(),
    runId: uuid()
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    priority: text({ enum: PRIORITIES }).notNull(),
    reason: text({ enum: HOLD_REASONS }).notNull(),
    releaseAt: timestamp({ withTimezone: true }),
    heldAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp({ withTimezone: true })
  },
  (table) => [
    index('queue_waiting_idx').on(table.heldAt).where(sql`${table.releasedAt} is null`),
    uniqueIndex('queue_one_hold_per_run_idx').on(table.runId).where(sql`${table.releasedAt} is null`)
  ]
);

// The console's pause switch: one row per pause, open while `resumedAt` is null.
export const pauses = pgTable(
  'pauses',
  {
    id: uuid().primaryKey().defaultRandom(),
    pausedBy: text().notNull(),
    pausedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    resumedBy: text(),
    resumedAt: timestamp({ withTimezone: true })
  },
  (table) => [uniqueIndex('pauses_one_open_idx').on(sql`(true)`).where(sql`${table.resumedAt} is null`)]
);

// The console's warnings and errors, kept for the daily health check because Vercel keeps logs for 30 minutes.
// One row per message an hour, counted, so a flood of rejected requests can't grow the table.
export const consoleProblems = pgTable(
  'console_problems',
  {
    id: uuid().primaryKey().defaultRandom(),
    hour: timestamp({ withTimezone: true }).notNull(),
    level: text({ enum: PROBLEM_LEVELS }).notNull(),
    message: text().notNull(),
    count: integer().notNull().default(1),
    // The latest line's fields.
    fields: jsonb(),
    lastAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('console_problems_hour_idx').on(table.hour, table.level, table.message),
    index('console_problems_last_idx').on(table.lastAt)
  ]
);

// A question asked with the slash command. The app posts it in the project's channel as a card (`slackTs`), its `ask`
// run answers in the card's thread, and a ticket filed from the answer is kept here so it's filed once.
export const asks = pgTable(
  'asks',
  {
    id: uuid().primaryKey().defaultRandom(),
    project: text().notNull(),
    runId: uuid().references(() => runs.id, { onDelete: 'set null' }),
    askerSlackId: text().notNull(),
    question: text().notNull(),
    slackChannelId: text().notNull(),
    slackTs: text(),
    answerSlackTs: text(),
    // Set when someone taps File and start or File for later, before Linear is asked, so a second tap files nothing.
    ticketFiledBy: text(),
    ticketFiledAt: timestamp({ withTimezone: true }),
    ticketStarted: boolean(),
    ticketIssueId: text(),
    ticketIdentifier: text(),
    ticketUrl: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('asks_thread_idx').on(table.slackChannelId, table.slackTs), index('asks_run_idx').on(table.runId)]
);
