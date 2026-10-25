import type { UsageSummary } from '@mb-factory/core';
import { orderQueue, summariseUsage } from '@mb-factory/core';
import { desc, eq, inArray, isNull } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { queue, runs, usageReadings, workItems } from '@/db/schema';

import type { Pause } from './pause';
import { currentPause } from './pause';
import { allProjects } from './projects';
import type { ConsoleUser } from './session';
import { requireConsoleUser } from './session';
import { latestReadings } from './usage';

export type HeldRun = {
  runId: string;
  priority: (typeof queue.$inferSelect)['priority'];
  reason: (typeof queue.$inferSelect)['reason'];
  releaseAt: Date | null;
  heldAt: Date;
  agent: (typeof runs.$inferSelect)['agent'];
  trigger: (typeof runs.$inferSelect)['trigger'];
  usageOverrideBy: string | null;
  issueIdentifier: string;
  issueUrl: string;
};

export type UsageView = {
  user: ConsoleUser;
  now: Date;
  pause: Pause | undefined;
  projects: { name: string; alias: string; maxRuns: number; summary: UsageSummary }[];
  activeRuns: number;
  held: HeldRun[];
  recent: (typeof usageReadings.$inferSelect)[];
};

// The Usage page's data. Checks the session first, so nothing here reaches a signed-out request.
export const loadUsageView = async (): Promise<UsageView> => {
  const user = await requireConsoleUser();
  const db = getDb();
  const [readings, pause, activeRuns, held, recent] = await Promise.all([
    latestReadings(),
    currentPause(),
    db.$count(runs, inArray(runs.status, ['dispatched', 'running'])),
    db
      .select({
        runId: queue.runId,
        priority: queue.priority,
        reason: queue.reason,
        releaseAt: queue.releaseAt,
        heldAt: queue.heldAt,
        agent: runs.agent,
        trigger: runs.trigger,
        usageOverrideBy: runs.usageOverrideBy,
        issueIdentifier: workItems.issueIdentifier,
        issueUrl: workItems.issueUrl
      })
      .from(queue)
      .innerJoin(runs, eq(queue.runId, runs.id))
      .innerJoin(workItems, eq(runs.workItemId, workItems.id))
      .where(isNull(queue.releasedAt)),
    db.select().from(usageReadings).orderBy(desc(usageReadings.takenAt)).limit(12)
  ]);
  const now = new Date();
  return {
    user,
    now,
    pause,
    projects: allProjects().map(({ name, alias, concurrency, usage }) => ({
      name,
      alias,
      maxRuns: concurrency.maxRuns,
      summary: summariseUsage({ policy: usage, readings, now })
    })),
    activeRuns,
    held: orderQueue(held),
    recent
  };
};
