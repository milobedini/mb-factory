import type { FactoryConfig, HomeCheck, HomeInput, Job } from '@mb-factory/core';
import {
  homeNotAllowedView,
  homeView,
  isAllowedSlackUser,
  jobTitle,
  nextSlot,
  OPEN_RUN_STATUSES,
  parseAppHomeOpened,
  summariseUsage,
  TERMINAL_STAGES
} from '@mb-factory/core';
import { and, count, countDistinct, desc, eq, gte, notInArray, sql, sum } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { consoleProblems, jobFindings, runs, stageChanges, workItems } from '@/db/schema';

import { loadCardInput } from './cards';
import { requireEnv } from './env';
import { log } from './log';
import { currentPause } from './pause';
import { allProjects } from './projects';
import { recentReadyList } from './ready';
import { publishHomeView } from './slack-api';
import { latestReadings } from './usage';

// The app's Home tab in Slack (core `homeView`), published for a person when they open it or tap one of its buttons.

const DAY_MS = 24 * 60 * 60 * 1000;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const loadCheck = async (project: FactoryConfig, job: Job, now: Date): Promise<HomeCheck> => {
  const db = getDb();
  const [latest] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.project, project.name), eq(runs.job, job.name)))
    .orderBy(desc(runs.createdAt))
    .limit(1);
  const [filed] = latest
    ? await db.select({ count: count() }).from(jobFindings).where(eq(jobFindings.runId, latest.id))
    : [];
  const filedCount = filed?.count ?? 0;
  const state: HomeCheck['state'] = !latest
    ? 'none'
    : OPEN_RUN_STATUSES.includes(latest.status)
      ? 'running'
      : latest.status === 'finished' && latest.outcome === 'done'
        ? filedCount > 0
          ? 'filed'
          : 'clean'
        : 'failed';
  return {
    title: jobTitle(job),
    state,
    filed: filedCount,
    lastAt: latest ? (latest.finishedAt ?? latest.createdAt) : null,
    nextAt: nextSlot(job, now, project.timeZone),
    runUrl: latest?.actionsRunUrl ?? null
  };
};

// Merged work, runs, failures and cost in the project over the last seven days.
const loadWeek = async (project: FactoryConfig, now: Date): Promise<HomeInput['week']> => {
  const db = getDb();
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const runProject = sql`coalesce(${runs.project}, ${workItems.project})`;
  const [[merged], [ran]] = await Promise.all([
    db
      .select({ count: countDistinct(stageChanges.workItemId) })
      .from(stageChanges)
      .innerJoin(workItems, eq(stageChanges.workItemId, workItems.id))
      .where(and(eq(workItems.project, project.name), eq(stageChanges.stage, 'done'), gte(stageChanges.at, since))),
    db
      .select({
        runs: count(),
        failed: count(sql`case when ${runs.outcome} in ('failed', 'blocked') then 1 end`),
        costUsd: sum(runs.costUsd).mapWith(Number)
      })
      .from(runs)
      .leftJoin(workItems, eq(runs.workItemId, workItems.id))
      .where(and(sql`${runProject} = ${project.name}`, gte(runs.createdAt, since)))
  ]);
  return {
    merged: merged?.count ?? 0,
    runs: ran?.runs ?? 0,
    failed: ran?.failed ?? 0,
    costUsd: ran?.costUsd ?? null
  };
};

export const loadHomeInput = async (project: FactoryConfig, now: Date): Promise<HomeInput> => {
  const db = getDb();
  const channelId = project.slack?.channelId ?? null;
  const [items, readings, pause, ready, checks, [problems], week] = await Promise.all([
    db
      .select()
      .from(workItems)
      .where(and(eq(workItems.project, project.name), notInArray(workItems.stage, TERMINAL_STAGES))),
    latestReadings(),
    currentPause(),
    recentReadyList(project, now)
      .then(({ ready: list }) => list)
      .catch((error: unknown) => {
        log('warn', 'ready list failed', { project: project.name, error: errorMessage(error) });
        return null;
      }),
    Promise.all(project.jobs.map((job) => loadCheck(project, job, now))),
    db
      .select({ count: sum(consoleProblems.count).mapWith(Number) })
      .from(consoleProblems)
      .where(gte(consoleProblems.lastAt, new Date(now.getTime() - DAY_MS))),
    loadWeek(project, now)
  ]);
  const cards = await Promise.all(
    items.map((item) => loadCardInput(item, project, item.slackChannelId ?? channelId ?? ''))
  );
  return {
    alias: project.alias,
    channelId,
    consoleUrl: requireEnv('CONSOLE_URL'),
    now,
    timeZone: project.timeZone,
    emojiPrefix: project.slack?.emojiPrefix ?? 'mbf',
    usage: summariseUsage({ policy: project.usage, readings, now }),
    paused: pause ? { by: pause.pausedBy, at: pause.pausedAt } : null,
    items: cards,
    ready,
    checks,
    problems: problems?.count ?? 0,
    week
  };
};

// The project whose Home tab a person sees: the first that lists them. Others see who can.
export const publishHome = async (userId: string): Promise<void> => {
  try {
    const withSlack = allProjects().filter((project) => project.slack);
    const project = withSlack.find((candidate) => isAllowedSlackUser(candidate, userId));
    const view = project
      ? homeView(await loadHomeInput(project, new Date()))
      : homeNotAllowedView(withSlack[0]?.alias ?? 'This');
    await publishHomeView(userId, view);
    log('info', 'slack home published', { user: userId, project: project?.name });
  } catch (error) {
    log('warn', 'slack home failed', { user: userId, error: errorMessage(error) });
  }
};

// Someone opened the Home tab: publish it fresh for them.
export const handleAppHomeOpened = async (payload: unknown): Promise<void> => {
  const opened = parseAppHomeOpened(payload);
  if (opened) {
    await publishHome(opened.userId);
  }
};
