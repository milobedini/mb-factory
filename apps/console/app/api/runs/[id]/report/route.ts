import { checkStageRunClaims, runReportSchema, summariseRun } from '@mb-factory/core';
import { after } from 'next/server';

import { verifyGitHubOidc } from '@/lib/github-oidc';
import { handleJobRunFinished } from '@/lib/jobs';
import { log } from '@/lib/log';
import { handleRunFinished } from '@/lib/router';
import { findAnyRun, recordRunReport, runRepository } from '@/lib/runs';

export const POST = async (request: Request, context: RouteContext<'/api/runs/[id]/report'>) => {
  const { id } = await context.params;
  const verification = await verifyGitHubOidc(request);
  if (!verification.ok) {
    log('warn', 'run report rejected', { runId: id, reason: verification.reason });
    return new Response('invalid token', { status: 401 });
  }

  const found = await findAnyRun(id);
  const repository = found && runRepository(found);
  if (!found || !repository) {
    return new Response('unknown run', { status: 404 });
  }
  const check = checkStageRunClaims({ claims: verification.claims, repository, actionsRunId: found.run.actionsRunId });
  if (!check.ok || found.run.actionsRunId === null) {
    log('warn', 'run report rejected', { runId: id, reason: check.ok ? 'run never started' : check.reason });
    return new Response('token does not match this run', { status: 403 });
  }

  const body = runReportSchema.safeParse(await request.json().catch(() => undefined));
  if (!body.success) {
    return new Response('invalid report body', { status: 400 });
  }
  const now = new Date();
  const summary = summariseRun(body.data, now);
  if (!(await recordRunReport(found, summary, now))) {
    return new Response(`run is ${found.run.status}, not running`, { status: 409 });
  }

  log('info', 'run reported', {
    runId: id,
    issue: found.workItem?.issueIdentifier,
    job: found.run.job ?? undefined,
    status: summary.status,
    outcome: summary.outcome,
    costUsd: summary.usage?.costUsd
  });
  after(async () => {
    try {
      await (found.workItem ? handleRunFinished(id) : handleJobRunFinished(id));
    } catch (error) {
      log('error', 'run follow-up failed', {
        runId: id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  return Response.json({ status: summary.status, outcome: summary.outcome });
};
