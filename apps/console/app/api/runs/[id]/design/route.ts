import { readDesignReportBody, summariseRun } from '@mb-factory/core';
import { after } from 'next/server';

import { isDesignPass } from '@/lib/design-pass';
import { log } from '@/lib/log';
import { handleRunFinished } from '@/lib/router';
import { findAnyRun, recordRunReport } from '@/lib/runs';

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
  const body = readDesignReportBody(await request.json().catch(() => undefined));
  if (!body) {
    return new Response('invalid report body', { status: 400 });
  }
  const summary = summariseRun({ conclusion: null, report: body.report, events: [] }, now);
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
