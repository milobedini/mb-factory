import type { FactoryConfig, HealthInput, Job } from '@mb-factory/core';
import {
  HEALTH_JOB,
  healthReport,
  healthText,
  latestSlot,
  NEW_PROBLEM_DAYS,
  OPEN_RUN_STATUSES,
  PROBLEM_RETENTION_DAYS
} from '@mb-factory/core';
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, ne, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { consoleProblems, jobSlots, queue, runs, workItems } from '@/db/schema';

import { requireEnv } from './env';
import { postJobMessage } from './job-runs';
import { log } from './log';

const DAY_MS = 24 * 60 * 60 * 1000;

type Slot = Pick<Job, 'name' | 'at'>;

// The health check as a daily slot, when the project has one.
export const healthSlotOf = (project: FactoryConfig): Slot | undefined =>
  project.health && { name: HEALTH_JOB, at: project.health.at };

// A run belongs to the project through its work item, or directly when it's a job's.
const runProject = sql`coalesce(${runs.project}, ${workItems.project})`;
const runLabel = sql<string>`coalesce(${workItems.issueIdentifier}, ${runs.job}, 'unknown')`;

const loadProblems = async (since: Date): Promise<Pick<HealthInput, 'problems' | 'knownMessages'>> => {
  const [problems, known] = await Promise.all([
    getDb()
      .select({
        level: consoleProblems.level,
        message: consoleProblems.message,
        count: sql<number>`sum(${consoleProblems.count})::int`,
        lastAt: sql<Date>`max(${consoleProblems.lastAt})`.mapWith(consoleProblems.lastAt),
        fields: sql<unknown>`(array_agg(${consoleProblems.fields} order by ${consoleProblems.lastAt} desc))[1]`
      })
      .from(consoleProblems)
      .where(gt(consoleProblems.lastAt, since))
      .groupBy(consoleProblems.level, consoleProblems.message),
    getDb()
      .selectDistinct({ message: consoleProblems.message })
      .from(consoleProblems)
      .where(
        and(
          lte(consoleProblems.lastAt, since),
          gt(consoleProblems.lastAt, new Date(since.getTime() - NEW_PROBLEM_DAYS * DAY_MS))
        )
      )
  ]);
  return { problems, knownMessages: known.map(({ message }) => message) };
};

const loadRuns = async (project: FactoryConfig, now: Date): Promise<Pick<HealthInput, 'openRuns' | 'heldRuns'>> => {
  const [open, held] = await Promise.all([
    getDb()
      .select({
        label: runLabel,
        agent: runs.agent,
        status: runs.status,
        createdAt: runs.createdAt,
        dispatchedAt: runs.dispatchedAt,
        startedAt: runs.startedAt,
        held: sql<boolean>`exists (select 1 from ${queue} where ${queue.runId} = ${runs.id} and ${queue.releasedAt} is null)`
      })
      .from(runs)
      .leftJoin(workItems, eq(workItems.id, runs.workItemId))
      .where(and(inArray(runs.status, OPEN_RUN_STATUSES), sql`${runProject} = ${project.name}`)),
    getDb()
      .select({ label: runLabel, agent: runs.agent, releaseAt: queue.releaseAt })
      .from(queue)
      .innerJoin(runs, eq(runs.id, queue.runId))
      .leftJoin(workItems, eq(workItems.id, runs.workItemId))
      .where(
        and(
          isNull(queue.releasedAt),
          isNotNull(queue.releaseAt),
          lt(queue.releaseAt, now),
          sql`${runProject} = ${project.name}`
        )
      )
  ]);
  return {
    openRuns: open,
    heldRuns: held.flatMap(({ releaseAt, ...run }) => (releaseAt ? [{ ...run, releaseAt }] : []))
  };
};

const loadSlots = async (project: FactoryConfig, since: Date): Promise<HealthInput['slots']> => {
  return getDb()
    .select({ job: jobSlots.job, slotAt: jobSlots.slotAt, firedAt: jobSlots.createdAt })
    .from(jobSlots)
    .where(and(eq(jobSlots.project, project.name), gt(jobSlots.slotAt, new Date(since.getTime() - DAY_MS))));
};

// The previous check's moment, so each one covers what came after it; the first looks back a day.
const previousCheck = async (project: FactoryConfig, slotId: string, now: Date): Promise<Date> => {
  const [previous] = await getDb()
    .select({ firedAt: jobSlots.createdAt })
    .from(jobSlots)
    .where(and(eq(jobSlots.project, project.name), eq(jobSlots.job, HEALTH_JOB), ne(jobSlots.id, slotId)))
    .orderBy(desc(jobSlots.slotAt))
    .limit(1);
  return previous?.firedAt ?? new Date(now.getTime() - DAY_MS);
};

const pruneProblems = async (now: Date): Promise<void> => {
  await getDb()
    .delete(consoleProblems)
    .where(lt(consoleProblems.lastAt, new Date(now.getTime() - PROBLEM_RETENTION_DAYS * DAY_MS)));
};

// Fires the health check's latest slot once, like a job's, and runs it straight away: no Claude run and no governor,
// so it still reports while the factory is paused or throttled.
export const fireHealthCheck = async (project: FactoryConfig, now: Date): Promise<void> => {
  const slot = healthSlotOf(project);
  if (!slot) {
    return;
  }
  const slotAt = latestSlot(slot, now, project.timeZone);
  const [fired] = await getDb()
    .insert(jobSlots)
    .values({ project: project.name, job: HEALTH_JOB, slotAt })
    .onConflictDoNothing()
    .returning({ id: jobSlots.id });
  if (!fired) {
    return;
  }
  const since = await previousCheck(project, fired.id, now);
  const [problems, runState, slots] = await Promise.all([
    loadProblems(since),
    loadRuns(project, now),
    loadSlots(project, since)
  ]);
  const report = healthReport({
    now,
    since,
    timeZone: project.timeZone,
    ...problems,
    ...runState,
    jobs: [...project.jobs, slot],
    slots
  });
  await postJobMessage(
    project,
    slot,
    healthText(report, { now, since, timeZone: project.timeZone, consoleUrl: requireEnv('CONSOLE_URL') })
  );
  await pruneProblems(now);
  log('info', 'health check posted', {
    project: project.name,
    since: since.toISOString(),
    lines: Object.values(report).reduce((sum, lines) => sum + lines.length, 0)
  });
};
