import type { FactoryConfig, Job, JobBrief } from '@mb-factory/core';
import { coveredHead, jobTitle, readJobReport } from '@mb-factory/core';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { jobFindings, jobSlots, runs } from '@/db/schema';

import { log } from './log';
import { postSlackMessage } from './slack-api';

type Run = typeof runs.$inferSelect;

export const findJob = (project: FactoryConfig, name: string | null): Job | undefined =>
  project.jobs.find((job) => job.name === name);

// How far back a check looks for a run whose findings all reached Linear: over a week of daily checks.
const COVERED_RUNS = 10;

// The newest commit on the default branch the job's runs covered, so the next one starts after it; held back past a
// run whose findings Linear refused, so the next check finds them again.
const lastHead = async (project: FactoryConfig, job: Job): Promise<string | undefined> => {
  const recent = await getDb()
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
    .limit(COVERED_RUNS);
  const covered = recent.flatMap(({ report }) => {
    const { head, findings } = readJobReport(report, job.agent);
    return head ? [{ head, fingerprints: findings.map(({ fingerprint }) => fingerprint) }] : [];
  });
  const fingerprints = covered.flatMap((run) => run.fingerprints);
  // Any job's filing counts, as when filing: the weekly pass and the daily check find the same things.
  const filed =
    fingerprints.length === 0
      ? []
      : await getDb()
          .selectDistinct({ fingerprint: jobFindings.fingerprint })
          .from(jobFindings)
          .where(and(eq(jobFindings.project, project.name), inArray(jobFindings.fingerprint, fingerprints)));
  const head = coveredHead(covered, new Set(filed.map(({ fingerprint }) => fingerprint)));
  if (head !== covered[0]?.head) {
    log('warn', 'job range held back for unfiled findings', { project: project.name, job: job.name, since: head });
  }
  return head;
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
  const [slot, since] = await Promise.all([slotOf(run), job.scope === 'repo' ? undefined : lastHead(project, job)]);
  return { agent: run.agent, job: job.name, trigger: run.trigger, slot, scope: job.scope, since };
};

// A job has no thread: it says what it did in one top-level message in the project's channel.
export const postJobMessage = async (project: FactoryConfig, job: Pick<Job, 'name'>, text: string): Promise<void> => {
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

export const jobTitleOf = (job: Job): string => jobTitle(job);
