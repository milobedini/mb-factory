import type { IssueUpdate } from '@mb-factory/core';
import { modelFor, needsSizing, readSizeReport, sizedComment, unsizedComment } from '@mb-factory/core';
import { and, eq, gt, inArray, or } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { runs } from '@/db/schema';

import { requireEnv } from './env';
import { commentOnIssue, issueToSize, sizeIssue } from './linear-api';
import { log } from './log';
import { findProjectByTeamKey } from './projects';
import { dispatchRun, releaseQueue } from './router';
import { findAnyRun } from './runs';

// A size run has no work item: its prompt is the Linear issue it sizes, whose text is read when it's dispatched.

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// Moving an issue back and forth doesn't size it again soon after.
const RESIZE_AFTER_MS = 60 * 60 * 1000;

// Accepting an unsized issue out of Triage (or moving one into Backlog or Todo) sizes it, once: not while a size run is
// open for it, nor within the hour of the last.
export const sizeOnAccept = async (update: IssueUpdate, appUserId: string): Promise<void> => {
  const project = update.teamKey ? findProjectByTeamKey(update.teamKey) : undefined;
  if (!project || !needsSizing(update, appUserId)) {
    return;
  }
  const db = getDb();
  const [recent] = await db
    .select({ id: runs.id })
    .from(runs)
    .where(
      and(
        eq(runs.agent, 'size'),
        eq(runs.prompt, update.issueId),
        or(
          inArray(runs.status, ['queued', 'dispatched', 'running']),
          gt(runs.createdAt, new Date(Date.now() - RESIZE_AFTER_MS))
        )
      )
    )
    .limit(1);
  if (recent) {
    log('info', 'size run already made', { issue: update.identifier, runId: recent.id });
    return;
  }
  const [run] = await db
    .insert(runs)
    .values({
      project: project.name,
      agent: 'size',
      model: modelFor(project, 'size', false),
      trigger: 'accepted',
      // Nobody's waiting on it, so it gives way to work in flight.
      priority: 'scheduled',
      prompt: update.issueId,
      status: 'queued'
    })
    .returning({ id: runs.id });
  if (!run) {
    throw new Error('Inserting the run returned no row');
  }
  log('info', 'size run made', { issue: update.identifier, runId: run.id });
  await dispatchRun(project, run.id);
};

// After a size run reports: the estimate and a comment on the issue, unless someone sized it meanwhile.
export const handleSizeRunFinished = async (runId: string): Promise<void> => {
  const found = await findAnyRun(runId);
  const run = found?.run;
  if (!run?.prompt) {
    return;
  }
  const report = run.status === 'finished' ? readSizeReport(run.report) : undefined;
  const organizationId = requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID');
  try {
    const issue = await issueToSize(organizationId, run.prompt);
    if (!report) {
      log('warn', 'size run gave no size', { runId, status: run.status, outcome: run.outcome, summary: run.summary });
      if (issue && issue.estimate === null) {
        await commentOnIssue(organizationId, run.prompt, unsizedComment(run.summary, run.actionsRunUrl));
      }
    } else if (!issue || issue.estimate !== null) {
      log('info', 'size run not applied', {
        runId,
        issue: issue?.identifier,
        why: issue ? 'already sized' : 'no issue'
      });
    } else {
      await sizeIssue(organizationId, run.prompt, {
        estimate: report.estimate,
        comment: sizedComment(report, run.actionsRunUrl)
      });
      log('info', 'issue sized', { runId, issue: issue.identifier, size: report.size });
    }
  } catch (error) {
    log('error', 'sizing failed', { runId, error: errorMessage(error) });
  }
  await releaseQueue();
};
