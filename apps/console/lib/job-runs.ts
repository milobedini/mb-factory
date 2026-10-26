import type { FactoryConfig, Job, JobBrief } from '@mb-factory/core';
import { jobTitle, readJobReport } from '@mb-factory/core';
import { and, desc, eq, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { jobSlots, runs } from '@/db/schema';

import { log } from './log';
import { postSlackMessage } from './slack-api';

type Run = typeof runs.$inferSelect;

export const findJob = (project: FactoryConfig, name: string | null): Job | undefined =>
  project.jobs.find((job) => job.name === name);

// The newest commit on the default branch the job's last finished run covered, so the next one starts after it.
const lastHead = async (project: FactoryConfig, job: Job): Promise<string | undefined> => {
  const [latest] = await getDb()
    .select({ report: runs.report })
    .from(runs)
    .where(
      and(
        eq(runs.project, project.name),
        eq(runs.job, job.name),
        eq(runs.status, 'finished'),
        sql`${runs.report}->>'head' is not null`
      )
    )
    .orderBy(desc(runs.createdAt))
    .limit(1);
  return (latest && readJobReport(latest.report).head) ?? undefined;
};

// The slot a job's run fills; a run the console made outside a slot stands for the moment it was made.
export const slotOf = async (run: Run): Promise<Date> => {
  const [slot] = await getDb()
    .select({ slotAt: jobSlots.slotAt })
    .from(jobSlots)
    .where(eq(jobSlots.runId, run.id))
    .limit(1);
  return slot?.slotAt ?? run.createdAt;
};

export const jobBriefFor = async (project: FactoryConfig, job: Job, run: Run): Promise<JobBrief> => {
  const [slot, since] = await Promise.all([slotOf(run), lastHead(project, job)]);
  return { agent: run.agent, job: job.name, trigger: run.trigger, slot, since };
};

// A job has no thread: it says what it did in one top-level message in the project's channel.
export const postJobMessage = async (project: FactoryConfig, job: Job, text: string): Promise<void> => {
  if (!project.slack) {
    return;
  }
  try {
    await postSlackMessage({ channel: project.slack.channelId, text });
  } catch (error) {
    log('error', 'slack job message failed', {
      project: project.name,
      job: job.name,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

export const jobTitleOf = (job: Job): string => jobTitle(job.agent);
