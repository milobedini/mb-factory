import type { RunTotals } from '@mb-factory/core';
import { canRerun, jobTitle, runTotals } from '@mb-factory/core';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { connection } from 'next/server';

import { getDb } from '@/db/client';
import { runs, workItems } from '@/db/schema';

import { allProjects, findProject } from './projects';
import { releaseQueueOnActivity } from './router';
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

// A scheduled job's latest runs, newest first.
export type JobRuns = { key: string; title: string; runs: RunRow[] };

export type RunsView = { user: ConsoleUser; now: Date; workItems: WorkItemRuns[]; jobs: JobRuns[] };

const WORK_ITEM_LIMIT = 25;
const JOB_RUN_LIMIT = 7;

const loadJobRuns = (): Promise<JobRuns[]> =>
  Promise.all(
    allProjects().flatMap((project) =>
      project.jobs.map(async (job) => ({
        key: `${project.name}:${job.name}`,
        title: `${jobTitle(job)} (${project.alias})`,
        runs: await getDb()
          .select()
          .from(runs)
          .where(and(eq(runs.project, project.name), eq(runs.job, job.name)))
          .orderBy(desc(runs.createdAt))
          .limit(JOB_RUN_LIMIT)
      }))
    )
  );

// The Runs page's data: the most recently active work items, each with its runs oldest first. Checks the session first.
export const loadRunsView = async (): Promise<RunsView> => {
  const user = await requireConsoleUser();
  // Before the reads, so the page shows what this released, and only on a real request: in a prerender (including
  // the one a prefetch runs, which has the cookies) the database driver's fetches are cut off.
  await connection();
  await releaseQueueOnActivity('runs page');
  const db = getDb();
  const [items, jobs] = await Promise.all([
    db.select().from(workItems).orderBy(desc(workItems.updatedAt)).limit(WORK_ITEM_LIMIT),
    loadJobRuns()
  ]);
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
    jobs,
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
