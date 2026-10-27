import { isReadOnlyDocument } from '@mb-factory/core';

import { requireEnv } from '@/lib/env';
import { forwardLinearQuery } from '@/lib/linear-api';
import { isLinearPass } from '@/lib/linear-pass';
import { log } from '@/lib/log';
import { findAnyRun } from '@/lib/runs';

// A question's GraphQL, read-only: the console sends a plain query on to Linear with the app's token, and refuses the
// rest. The pass is the one `/start` gave this run, and holds only while the run is running.
const MAX_BODY_BYTES = 20_000;

const bearer = (request: Request): string | undefined =>
  request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];

const readRequest = (text: string): { query: string; variables: Record<string, unknown> } | undefined => {
  try {
    const body: unknown = JSON.parse(text);
    if (typeof body !== 'object' || body === null) {
      return undefined;
    }
    const { query, variables = {} } = body as { query?: unknown; variables?: unknown };
    return typeof query === 'string' && typeof variables === 'object' && variables !== null && !Array.isArray(variables)
      ? { query, variables: variables as Record<string, unknown> }
      : undefined;
  } catch {
    return undefined;
  }
};

export const POST = async (request: Request, context: RouteContext<'/api/runs/[id]/linear'>) => {
  const { id } = await context.params;
  const pass = bearer(request);
  if (!pass || !isLinearPass(pass, id, new Date())) {
    log('warn', 'linear query rejected', { runId: id, reason: 'pass' });
    return new Response('invalid pass', { status: 401 });
  }
  const found = await findAnyRun(id);
  if (!found || found.run.agent !== 'ask' || found.run.status !== 'running') {
    log('warn', 'linear query rejected', { runId: id, reason: 'run', status: found?.run.status });
    return new Response('not a running question', { status: 403 });
  }
  const text = await request.text();
  const body = text.length <= MAX_BODY_BYTES ? readRequest(text) : undefined;
  if (!body) {
    return new Response('expected {"query": "...", "variables": {...}}', { status: 400 });
  }
  if (!isReadOnlyDocument(body.query)) {
    log('warn', 'linear query rejected', { runId: id, reason: 'not a query' });
    return new Response('only queries are forwarded: questions read Linear, never change it', { status: 400 });
  }
  return forwardLinearQuery(requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID'), body);
};
