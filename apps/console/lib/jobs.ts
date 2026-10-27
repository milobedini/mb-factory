import type { CheckIssue, CheckResult, FactoryConfig, FilingFinding, Finding, Job } from '@mb-factory/core';
import {
  decideFiling,
  dispatchLapsedBefore,
  groupFindings,
  groupIssue,
  jobCheckText,
  jobLabels,
  latestSlot,
  readJobReport,
  slotDay
} from '@mb-factory/core';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { jobFindings, jobSlots, queue, runs } from '@/db/schema';

import { requireEnv } from './env';
import { fireHealthCheck } from './health';
import { findJob, jobTitleOf, postJobMessage, slotOf } from './job-runs';
import { fileTriageIssue, issueStateType } from './linear-api';
import { log } from './log';
import { allProjects, findProject, repositoryOf } from './projects';
import { dispatchRun, handleRunFinished, releaseQueue } from './router';
import { findAnyRun } from './runs';

type Run = typeof runs.$inferSelect;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// A run still held when the next slot fires is out of date: the new one covers the same commits and more.
const replaceHeldRuns = async (project: FactoryConfig, job: Job, day: string, now: Date): Promise<void> => {
  const replaced = await getDb()
    .update(runs)
    .set({ status: 'canceled', summary: `Replaced by the ${day} run.`, finishedAt: now })
    .where(and(eq(runs.project, project.name), eq(runs.job, job.name), eq(runs.status, 'queued')))
    .returning({ id: runs.id });
  await Promise.all(
    replaced.map(({ id }) =>
      getDb()
        .update(queue)
        .set({ releasedAt: now })
        .where(and(eq(queue.runId, id), isNull(queue.releasedAt)))
    )
  );
  if (replaced.length > 0) {
    log('info', 'held job runs replaced', { project: project.name, job: job.name, count: replaced.length });
  }
};

// Fires the job's latest slot unless it already fired: the slot's row is inserted first, so only one wake wins it.
const fireJob = async (project: FactoryConfig, job: Job, now: Date): Promise<void> => {
  const slotAt = latestSlot(job, now, project.timeZone);
  const [slot] = await getDb()
    .insert(jobSlots)
    .values({ project: project.name, job: job.name, slotAt })
    .onConflictDoNothing()
    .returning({ id: jobSlots.id });
  if (!slot) {
    return;
  }
  await replaceHeldRuns(project, job, slotDay(slotAt, project.timeZone), now);
  const [run] = await getDb()
    .insert(runs)
    .values({
      project: project.name,
      job: job.name,
      agent: job.agent,
      model: job.model,
      trigger: 'scheduled',
      priority: 'scheduled',
      status: 'queued'
    })
    .returning({ id: runs.id });
  if (!run) {
    throw new Error('Inserting the run returned no row');
  }
  await getDb().update(jobSlots).set({ runId: run.id }).where(eq(jobSlots.id, slot.id));
  log('info', 'job slot fired', { project: project.name, job: job.name, slotAt: slotAt.toISOString(), runId: run.id });
  await dispatchRun(project, run.id);
};

// Starts every job whose latest slot hasn't fired yet, so a slot missed while nothing woke the console runs late; the
// health check fires the same way.
export const fireDueJobs = async (now: Date): Promise<void> => {
  await Promise.all(
    allProjects().flatMap((project) => [
      ...project.jobs.map((job) =>
        fireJob(project, job, now).catch((error: unknown) =>
          log('error', 'job slot failed', { project: project.name, job: job.name, error: errorMessage(error) })
        )
      ),
      fireHealthCheck(project, now).catch((error: unknown) =>
        log('error', 'health check failed', { project: project.name, error: errorMessage(error) })
      )
    ])
  );
};

type Filed =
  | { kind: 'filed'; issue: CheckIssue }
  | { kind: 'known'; issue: CheckIssue }
  | { kind: 'failed'; title: string };

type Decided = { kind: 'file'; item: FilingFinding } | Exclude<Filed, { kind: 'filed' }>;

// Whether a finding needs an issue: not while an earlier one for it is still open, or after it was declined.
const decideFinding = async (project: FactoryConfig, finding: Finding): Promise<Decided> => {
  const organizationId = requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID');
  try {
    const [before] = await getDb()
      .select()
      .from(jobFindings)
      .where(
        // Any job's filing counts: the weekly pass and the daily check find the same things.
        and(eq(jobFindings.project, project.name), eq(jobFindings.fingerprint, finding.fingerprint))
      )
      .orderBy(desc(jobFindings.filedAt))
      .limit(1);
    const previous = before && {
      identifier: before.issueIdentifier,
      url: before.issueUrl,
      stateType: await issueStateType(organizationId, before.linearIssueId).catch((error: unknown) => {
        log('warn', 'linear issue state lookup failed', { issue: before.issueIdentifier, error: errorMessage(error) });
        return null;
      })
    };
    const filing = decideFiling(previous);
    if (filing.kind === 'known') {
      log('info', 'job finding already filed', {
        fingerprint: finding.fingerprint,
        issue: filing.previous.identifier,
        why: filing.why
      });
      return { kind: 'known', issue: filing.previous };
    }
    return { kind: 'file', item: { finding, previous: filing.kind === 'refile' ? filing.previous : undefined } };
  } catch (error) {
    log('error', 'job finding filing failed', { fingerprint: finding.fingerprint, error: errorMessage(error) });
    return { kind: 'failed', title: finding.title };
  }
};

// One issue for findings one change fixes (or a finding on its own), with a row per fingerprint so each is known later.
const fileGroup = async (
  project: FactoryConfig,
  job: Job,
  run: Run,
  group: FilingFinding[],
  head: string | null,
  day: string
): Promise<Filed[]> => {
  const fingerprints = group.map(({ finding }) => finding.fingerprint);
  try {
    const issue = groupIssue(group, {
      jobTitle: jobTitleOf(job),
      repository: repositoryOf(project),
      head,
      runUrl: run.actionsRunUrl,
      day
    });
    const created = await fileTriageIssue(requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID'), {
      teamKey: project.linear.teamKey,
      ...issue,
      // Created on the team if they don't exist yet.
      labels: jobLabels(job.agent)
    });
    await getDb()
      .insert(jobFindings)
      .values(
        fingerprints.map((fingerprint) => ({
          project: project.name,
          job: job.name,
          fingerprint,
          linearIssueId: created.id,
          issueIdentifier: created.identifier,
          issueUrl: created.url,
          runId: run.id
        }))
      );
    log('info', 'job finding filed', { fingerprints, issue: created.identifier });
    return [{ kind: 'filed', issue: created }];
  } catch (error) {
    log('error', 'job finding filing failed', { fingerprints, error: errorMessage(error) });
    return group.map(({ finding }) => ({ kind: 'failed', title: finding.title }));
  }
};

// Groups are filed one after another, so two of them can't race to create the same missing label.
const fileFindings = async (
  project: FactoryConfig,
  job: Job,
  run: Run,
  findings: Finding[],
  head: string | null,
  day: string
): Promise<Filed[]> => {
  const decided = await Promise.all(findings.map((finding) => decideFinding(project, finding)));
  const toFile = decided.flatMap((result) => (result.kind === 'file' ? [result.item] : []));
  const filed = await groupFindings(toFile).reduce<Promise<Filed[]>>(
    async (done, group) => [...(await done), ...(await fileGroup(project, job, run, group, head, day))],
    Promise.resolve([])
  );
  return [...decided.flatMap((result) => (result.kind === 'file' ? [] : [result])), ...filed];
};

const checkResult = async (project: FactoryConfig, job: Job, run: Run, day: string): Promise<CheckResult> => {
  if (run.status === 'limit_hit') {
    return { kind: 'failed', summary: 'It hit the usage limit; the next check covers the same commits.' };
  }
  if (run.outcome !== 'done') {
    return { kind: 'failed', summary: run.summary ?? 'The run ended without a summary.' };
  }
  const report = readJobReport(run.report, job.agent);
  if (report.dropped > 0) {
    log('warn', 'job findings dropped', { runId: run.id, dropped: report.dropped });
  }
  if (report.findings.length === 0) {
    return { kind: 'clean', commits: report.commits, gaps: report.gaps };
  }
  const filed = await fileFindings(project, job, run, report.findings, report.head, day);
  return {
    kind: 'filed',
    commits: report.commits,
    gaps: report.gaps,
    filed: filed.flatMap((result) => (result.kind === 'filed' ? [result.issue] : [])),
    // Findings filed together share an issue: list it once.
    known: filed
      .flatMap((result) => (result.kind === 'known' ? [result.issue] : []))
      .filter((issue, index, all) => all.findIndex(({ identifier }) => identifier === issue.identifier) === index),
    unfiled: filed.flatMap((result) => (result.kind === 'failed' ? [result.title] : []))
  };
};

// After a job's run reports: file what it found, say so in the channel, free its slot.
export const handleJobRunFinished = async (runId: string): Promise<void> => {
  const found = await findAnyRun(runId);
  const project = found?.run.project ? findProject(found.run.project) : undefined;
  const job = found && project ? findJob(project, found.run.job) : undefined;
  if (!found || !project || !job) {
    return;
  }
  const { run } = found;
  const day = slotDay(await slotOf(run), project.timeZone);
  const result = await checkResult(project, job, run, day);
  log('info', 'job run finished', { runId, job: job.name, result: result.kind });
  await postJobMessage(project, job, jobCheckText(jobTitleOf(job), day, result, run.actionsRunUrl));
  await releaseQueue();
};

// A dispatched run that never called `/start` is ended as failed with no report, which reads as a run that never
// started: a stage run is tried once more by itself, and a job's run says in the channel that it failed.
export const endLapsedDispatches = async (now: Date): Promise<void> => {
  const lapsed = await getDb()
    .update(runs)
    .set({
      status: 'finished',
      outcome: 'failed',
      summary: 'Its workflow failed before it reached the console.',
      finishedAt: now
    })
    .where(and(eq(runs.status, 'dispatched'), lt(runs.dispatchedAt, dispatchLapsedBefore(now))))
    .returning({ id: runs.id, workItemId: runs.workItemId });
  await Promise.all(
    lapsed.map(async ({ id, workItemId }) => {
      log('warn', 'dispatched run never started', { runId: id });
      try {
        await (workItemId ? handleRunFinished(id) : handleJobRunFinished(id));
      } catch (error) {
        log('error', 'run follow-up failed', { runId: id, error: errorMessage(error) });
      }
    })
  );
};
