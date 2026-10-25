import type { RunTotals } from '@mb-factory/core';
import { canRerun, runTotals } from '@mb-factory/core';
import { asc, desc, inArray } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { runs, workItems } from '@/db/schema';

import { findProject } from './projects';
import type { ConsoleUser } from './session';
import { requireConsoleUser } from './session';

export type RunRow = typeof runs.$inferSelect;

export type WorkItemRuns = {
  workItem: typeof workItems.$inferSelect;
  prUrl: string | null;
  runs: RunRow[];
  totals: RunTotals;
  // The latest run, when the console may re-run it.
  rerunnableId: string | null;
};

export type RunsView = { user: ConsoleUser; now: Date; workItems: WorkItemRuns[] };

const WORK_ITEM_LIMIT = 25;

// The Runs page's data: the most recently active work items, each with its runs oldest first. Checks the session first.
export const loadRunsView = async (): Promise<RunsView> => {
  const user = await requireConsoleUser();
  const db = getDb();
  const items = await db.select().from(workItems).orderBy(desc(workItems.updatedAt)).limit(WORK_ITEM_LIMIT);
  const itemRuns =
    items.length === 0
      ? []
      : await db
          .select()
          .from(runs)
          .where(
            inArray(
              runs.workItemId,
              items.map(({ id }) => id)
            )
          )
          .orderBy(asc(runs.createdAt));
  return {
    user,
    now: new Date(),
    workItems: items.map((workItem) => {
      const own = itemRuns.filter(({ workItemId }) => workItemId === workItem.id);
      const latest = own.at(-1);
      const project = findProject(workItem.project);
      const rerunnable =
        latest !== undefined &&
        project !== undefined &&
        canRerun(latest, {
          stage: workItem.stage,
          hasPr: workItem.prNumber !== null,
          reviewRounds: workItem.reviewRounds,
          maxReviewRounds: project.review.maxRounds
        });
      return {
        workItem,
        prUrl: workItem.prNumber ? `https://github.com/${workItem.repository}/pull/${workItem.prNumber}` : null,
        runs: own,
        totals: runTotals(own),
        rerunnableId: rerunnable ? latest.id : null
      };
    })
  };
};
