import type { FactoryConfig, HomeCheck, HomeInput, Job } from '@mb-factory/core';
import {
  checkState,
  homeNotAllowedView,
  homeView,
  isAllowedSlackUser,
  jobTitle,
  nextSlot,
  OPEN_RUN_STATUSES,
  parseAppHomeOpened,
  readJobReport,
  summariseUsage,
  TERMINAL_STAGES
} from '@mb-factory/core';
import { and, count, countDistinct, desc, eq, gte, inArray, notInArray, sql, sum } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { consoleProblems, jobFindings, runs, stageChanges, workItems } from '@/db/schema';

import { loadCardInput } from './cards';
import { requireEnv } from './env';
import { log } from './log';
import { currentPause } from './pause';
import { allProjects, findProject } from './projects';
import { recentReadyList } from './ready';
import { publishHomeView } from './slack-api';
import { latestReadings } from './usage';

// The app's Home tab in Slack (core `homeView`), published for a person when they open it or tap one of its buttons.

const DAY_MS = 24 * 60 * 60 * 1000;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// A check's latest run, read as its message in the channel was: issues filed, findings Linear refused (unless another run
// has filed them since), and what it couldn't check.
const loadCheck = async (project: FactoryConfig, job: Job, now: Date): Promise<HomeCheck> => {
  const db = getDb();
  const [latest] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.project, project.name), eq(runs.job, job.name)))
    .orderBy(desc(runs.createdAt))
    .limit(1);
  const report = latest ? readJobReport(latest.report, job.agent) : undefined;
  const fingerprints = report?.findings.map(({ fingerprint }) => fingerprint) ?? [];
  // Any job's filing counts, as when filing: the weekly pass and the daily check find the same things.
  const [onLinear, [filed]] = await Promise.all([
    fingerprints.length === 0
      ? []
      : db
          .selectDistinct({ fingerprint: jobFindings.fingerprint })
          .from(jobFindings)
          .where(and(eq(jobFindings.project, project.name), inArray(jobFindings.fingerprint, fingerprints))),
    latest
      ? db
          .select({ count: countDistinct(jobFindings.issueIdentifier) })
          .from(jobFindings)
          .where(eq(jobFindings.runId, latest.id))
      : []
  ]);
  const reached = new Set(onLinear.map(({ fingerprint }) => fingerprint));
  const counts = {
    filed: filed?.count ?? 0,
    unfiled: new Set(fingerprints.filter((fingerprint) => !reached.has(fingerprint))).size
  };
  return {
    title: jobTitle(job),
    state: checkState(
      latest && { status: latest.status, outcome: latest.outcome, open: OPEN_RUN_STATUSES.includes(latest.status) },
      counts
    ),
    ...counts,
    gaps: report?.gaps.length ?? 0,
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

const withSlack = (): FactoryConfig[] => allProjects().filter((project) => project.slack);

// The project whose Home tab a person sees: the first that lists them. Others see who can.
const homeProjectOf = (userId: string): FactoryConfig | undefined =>
  withSlack().find((candidate) => isAllowedSlackUser(candidate, userId));

export const publishHome = async (userId: string): Promise<void> => {
  try {
    const project = homeProjectOf(userId);
    const view = project
      ? homeView(await loadHomeInput(project, new Date()))
      : homeNotAllowedView(withSlack()[0]?.alias ?? 'This');
    await publishHomeView(userId, view);
    log('info', 'slack home published', { user: userId, project: project?.name });
  } catch (error) {
    log('warn', 'slack home failed', { user: userId, error: errorMessage(error) });
  }
};

// Work in a project changed: redraw the Home tab of everyone who sees that project there, drawn once for all of them.
// Never throws, like a card's redraw.
export const republishHome = async (projectName: string): Promise<void> => {
  const project = findProject(projectName);
  const people = (project?.slack?.allowedUserIds ?? []).filter((userId) => homeProjectOf(userId)?.name === projectName);
  if (!project || people.length === 0) {
    return;
  }
  try {
    const view = homeView(await loadHomeInput(project, new Date()));
    await Promise.all(people.map((userId) => publishHomeView(userId, view)));
    log('info', 'slack home republished', { project: project.name, people: people.length });
  } catch (error) {
    log('warn', 'slack home failed', { project: project.name, error: errorMessage(error) });
  }
};

// Someone opened the Home tab: publish it fresh for them.
export const handleAppHomeOpened = async (payload: unknown): Promise<void> => {
  const opened = parseAppHomeOpened(payload);
  if (opened) {
    await publishHome(opened.userId);
  }
};
