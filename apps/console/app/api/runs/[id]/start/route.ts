import { checkStageRunClaims, coAuthorFor } from '@mb-factory/core';
import { after } from 'next/server';

import { findAskByRun, refreshAskCard } from '@/lib/ask-runs';
import { defaultBranch } from '@/lib/github-api';
import { verifyGitHubOidc } from '@/lib/github-oidc';
import { getLinearAccessToken } from '@/lib/linear-api';
import { linearPass } from '@/lib/linear-pass';
import { log } from '@/lib/log';
import { findProject } from '@/lib/projects';
import { findAnyRun, markRunStarted, runRepository } from '@/lib/runs';

// Long enough to outlast the stage workflow's 60-minute timeout.
const RUN_TOKEN_VALIDITY_MS = 90 * 60 * 1000;

export const POST = async (request: Request, context: RouteContext<'/api/runs/[id]/start'>) => {
  const { id } = await context.params;
  const verification = await verifyGitHubOidc(request);
  if (!verification.ok) {
    log('warn', 'run start rejected', { runId: id, reason: verification.reason });
    return new Response('invalid token', { status: 401 });
  }

  const found = await findAnyRun(id);
  const repository = found && runRepository(found);
  if (!found || !repository) {
    return new Response('unknown run', { status: 404 });
  }
  const check = checkStageRunClaims({ claims: verification.claims, repository, actionsRunId: null });
  if (!check.ok) {
    log('warn', 'run start rejected', { runId: id, reason: check.reason });
    return new Response('token does not match this run', { status: 403 });
  }
  const { workItem } = found;
  if (workItem && !workItem.agentSessionId) {
    return new Response('work item has no agent session', { status: 409 });
  }
  if (!(await markRunStarted(id, check.claims, new Date()))) {
    return new Response(`run is ${found.run.status}, not dispatched`, { status: 409 });
  }
  if (!workItem && found.run.agent === 'ask') {
    // A question reads Linear but has no session to report to; its card now says how long it's been looking.
    after(async () => {
      const ask = await findAskByRun(id);
      const project = ask && findProject(ask.project);
      if (ask && project) {
        await refreshAskCard(project, ask);
      }
    });
    log('info', 'run started', { runId: id, actionsRunId: check.claims.run_id, agent: 'ask' });
    // It only reads Linear, so it gets no token that could write: a pass for `/linear`, which forwards queries only.
    return Response.json({
      agent: found.run.agent,
      linearAccessToken: null,
      linearPass: linearPass(id, new Date(Date.now() + RUN_TOKEN_VALIDITY_MS)),
      agentSessionId: null
    });
  }
  if (!workItem) {
    // A job, or a size run (its brief has the issue's text), reports only to the console, so it gets no Linear token.
    log('info', 'run started', {
      runId: id,
      actionsRunId: check.claims.run_id,
      job: found.run.job ?? undefined,
      agent: found.run.agent
    });
    return Response.json({ agent: found.run.agent, linearAccessToken: null, agentSessionId: null });
  }

  const linearAccessToken = await getLinearAccessToken(workItem.linearOrganizationId, {
    minValidityMs: RUN_TOKEN_VALIDITY_MS
  });
  log('info', 'run started', { runId: id, actionsRunId: check.claims.run_id, issue: workItem.issueIdentifier });
  // A conflict fix first tries merging the base branch in without the agent, which works when only lockfiles conflict.
  const { prNumber, branch } = workItem;
  const project = findProject(workItem.project);
  const merge =
    found.run.agent === 'implement' && found.run.trigger === 'conflict' && prNumber && branch && project
      ? {
          pr: prNumber,
          branch,
          base: await defaultBranch(workItem.repository).catch(() => null),
          coAuthor: coAuthorFor(project, workItem.assigneeEmail) ?? null
        }
      : null;
  // The stage workflow gives only implement runs the project app's token, which can push workflow files.
  return Response.json({
    agent: found.run.agent,
    linearAccessToken,
    agentSessionId: workItem.agentSessionId,
    merge: merge?.base ? merge : null
  });
};
