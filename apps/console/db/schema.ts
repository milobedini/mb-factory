import {
  AGENT_ROLES,
  HOLD_REASONS,
  PRIORITIES,
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
    linearProjectId: text(),
    agentSessionId: text(),
    origin: text({ enum: WORK_ORIGINS }).notNull(),
    slackChannelId: text(),
    slackThreadTs: text(),
    requester: text(),
    stage: text({ enum: STAGES }).notNull(),
    reviewRounds: integer().notNull().default(0),
    branch: text(),
    prNumber: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('work_items_agent_session_idx').on(table.agentSessionId)]
);

export const runs = pgTable(
  'runs',
  {
    id: uuid().primaryKey().defaultRandom(),
    workItemId: uuid()
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
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
    index('runs_active_idx').on(table.status).where(sql`${table.status} in ('dispatched', 'running')`)
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
