import { checkStageRunClaims } from '@mb-factory/core';

import { verifyGitHubOidc } from '@/lib/github-oidc';
import { getLinearAccessToken } from '@/lib/linear-api';
import { log } from '@/lib/log';
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
  if (!workItem) {
    // A job reports only to the console, so its run gets no Linear token.
    log('info', 'run started', { runId: id, actionsRunId: check.claims.run_id, job: found.run.job });
    return Response.json({ linearAccessToken: null, agentSessionId: null });
  }

  const linearAccessToken = await getLinearAccessToken(workItem.linearOrganizationId, {
    minValidityMs: RUN_TOKEN_VALIDITY_MS
  });
  log('info', 'run started', { runId: id, actionsRunId: check.claims.run_id, issue: workItem.issueIdentifier });
  return Response.json({ linearAccessToken, agentSessionId: workItem.agentSessionId });
};
