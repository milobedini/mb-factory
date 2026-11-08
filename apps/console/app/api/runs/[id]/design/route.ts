import type { RunSummary } from '@mb-factory/core';
import {
  coAuthorFor,
  designCommitMessage,
  designFolder,
  readDesignFiles,
  readDesignReportBody,
  summariseRun,
  withDesignReviewNotes
} from '@mb-factory/core';
import { after } from 'next/server';

import { isDesignPass } from '@/lib/design-pass';
import { commitFiles } from '@/lib/github-api';
import { log } from '@/lib/log';
import { findProject } from '@/lib/projects';
import { designCriteria, handleRunFinished, startWorkBranch } from '@/lib/router';
import type { FoundRun } from '@/lib/runs';
import { findAnyRun, recordRunReport } from '@/lib/runs';

const failedWith = (summary: RunSummary, why: string): RunSummary => ({ ...summary, outcome: 'failed', summary: why });

// The hand-off sends the approved design's files with its report: the console commits them to the work's branch (the
// spec's, or on express one it starts), so the session needs no push access, and a hand-off whose files don't land is
// a failed run.
const commitHandOff = async ({ run, workItem }: FoundRun, raw: unknown, summary: RunSummary): Promise<RunSummary> => {
  if (run.trigger !== 'design_approved' || summary.outcome !== 'done' || !workItem) {
    return summary;
  }
  const files = readDesignFiles(raw);
  if (!files) {
    return failedWith(summary, 'The hand-off sent no design files the console could commit.');
  }
  const project = findProject(workItem.project);
  const folder = designFolder(workItem.issueIdentifier);
  try {
    // Express work has no spec branch yet: the boards start the work's own.
    const branch = workItem.branch ?? (await startWorkBranch(workItem));
    const sha = await commitFiles(
      workItem.repository,
      branch,
      files.map(({ name, content }) => ({ path: `${folder}/${name}`, base64: content })),
      designCommitMessage(
        workItem.issueIdentifier,
        project ? (coAuthorFor(project, workItem.assigneeEmail) ?? null) : null
      )
    );
    log('info', 'design committed', { runId: run.id, issue: workItem.issueIdentifier, sha, files: files.length });
    return summary;
  } catch (error) {
    log('error', 'design commit failed', {
      runId: run.id,
      issue: workItem.issueIdentifier,
      error: error instanceof Error ? error.message : String(error)
    });
    return failedWith(summary, 'The console couldn’t commit the design files to the work’s branch.');
  }
};

// A design run's report, from its claude.ai session, with the pass its brief carried.
export const POST = async (request: Request, context: RouteContext<'/api/runs/[id]/design'>) => {
  const { id } = await context.params;
  const pass = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const now = new Date();
  if (!isDesignPass(pass, id, now)) {
    log('warn', 'design report rejected', { runId: id, reason: 'pass' });
    return new Response('invalid pass', { status: 401 });
  }
  const found = await findAnyRun(id);
  if (found?.run.agent !== 'design' || !found.workItem) {
    return new Response('unknown run', { status: 404 });
  }
  const raw: unknown = await request.json().catch(() => undefined);
  const body = readDesignReportBody(raw);
  if (!body) {
    return new Response('invalid report body', { status: 400 });
  }
  if (found.run.status !== 'running') {
    return new Response(`run is ${found.run.status}, not running`, { status: 409 });
  }
  const reported = summariseRun({ conclusion: null, report: body.report, events: [] }, now);
  // A design ready for review gets the decisions it made and any acceptance criterion no board shows.
  const reviewed =
    reported.outcome === 'needs_input'
      ? withDesignReviewNotes(reported, await designCriteria(found.workItem))
      : reported;
  const summary = await commitHandOff(found, raw, reviewed);
  if (!(await recordRunReport(found, summary, now))) {
    return new Response(`run is ${found.run.status}, not running`, { status: 409 });
  }
  log('info', 'run reported', {
    runId: id,
    issue: found.workItem.issueIdentifier,
    status: summary.status,
    outcome: summary.outcome
  });
  after(async () => {
    try {
      await handleRunFinished(id);
    } catch (error) {
      log('error', 'run follow-up failed', {
        runId: id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  return Response.json({ status: summary.status, outcome: summary.outcome });
};
