import type { RunSummary, StageRunClaims } from '@mb-factory/core';
import { and, eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { runs, usageReadings, workItems } from '@/db/schema';

import { findProject, repositoryOf } from './projects';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RunWithWorkItem = {
  run: typeof runs.$inferSelect;
  workItem: typeof workItems.$inferSelect;
};

// A run with its work item, or without one for a scheduled job's run.
export type FoundRun = {
  run: typeof runs.$inferSelect;
  workItem: typeof workItems.$inferSelect | null;
};

// Work-item runs only; `findAnyRun` also finds a job's.
export const findRun = async (runId: string): Promise<RunWithWorkItem | undefined> => {
  if (!UUID.test(runId)) {
    return undefined;
  }
  const [row] = await getDb()
    .select({ run: runs, workItem: workItems })
    .from(runs)
    .innerJoin(workItems, eq(runs.workItemId, workItems.id))
    .where(eq(runs.id, runId))
    .limit(1);
  return row;
};

export const findAnyRun = async (runId: string): Promise<FoundRun | undefined> => {
  if (!UUID.test(runId)) {
    return undefined;
  }
  const [row] = await getDb()
    .select({ run: runs, workItem: workItems })
    .from(runs)
    .leftJoin(workItems, eq(runs.workItemId, workItems.id))
    .where(eq(runs.id, runId))
    .limit(1);
  return row;
};

// The repository a run works in: its work item's, or its job's project's.
export const runRepository = ({ run, workItem }: FoundRun): string | undefined => {
  if (workItem) {
    return workItem.repository;
  }
  const project = run.project ? findProject(run.project) : undefined;
  return project && repositoryOf(project);
};

// Returns false when the run had already left `dispatched`, so a replayed start does nothing.
export const markRunStarted = async (runId: string, claims: StageRunClaims, now: Date): Promise<boolean> => {
  const updated = await getDb()
    .update(runs)
    .set({
      status: 'running',
      startedAt: now,
      actionsRunId: claims.run_id,
      actionsRunUrl: `https://github.com/${claims.repository}/actions/runs/${claims.run_id}`
    })
    .where(and(eq(runs.id, runId), eq(runs.status, 'dispatched')))
    .returning({ id: runs.id });
  return updated.length > 0;
};

export const recordRunReport = async (
  { run, workItem }: FoundRun,
  summary: RunSummary,
  now: Date
): Promise<boolean> => {
  const db = getDb();
  const updated = await db
    .update(runs)
    .set({
      status: summary.status,
      outcome: summary.outcome,
      summary: summary.summary,
      report: summary.report,
      inputTokens: summary.usage?.inputTokens,
      outputTokens: summary.usage?.outputTokens,
      cacheReadInputTokens: summary.usage?.cacheReadInputTokens,
      cacheCreationInputTokens: summary.usage?.cacheCreationInputTokens,
      costUsd: summary.usage?.costUsd,
      durationMs: summary.usage?.durationMs,
      numTurns: summary.usage?.numTurns,
      finishedAt: now
    })
    .where(and(eq(runs.id, run.id), eq(runs.status, 'running')))
    .returning({ id: runs.id });
  if (updated.length === 0) {
    return false;
  }

  const readings = summary.readings.map((reading) => ({
    ...reading,
    source: 'run' as const,
    runId: run.id,
    takenAt: now
  }));
  const branch = summary.report?.branch ?? workItem?.branch;
  const prNumber = summary.report?.pr ?? workItem?.prNumber;
  await Promise.all([
    readings.length > 0 ? db.insert(usageReadings).values(readings) : undefined,
    workItem && (branch !== workItem.branch || prNumber !== workItem.prNumber)
      ? db.update(workItems).set({ branch, prNumber, updatedAt: now }).where(eq(workItems.id, workItem.id))
      : undefined
  ]);
  return true;
};
