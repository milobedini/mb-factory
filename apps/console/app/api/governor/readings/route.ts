import { readingsFromEvents, runReportSchema } from '@mb-factory/core';

import { rejectUnlessGovernor } from '@/lib/github-oidc';
import { log } from '@/lib/log';
import { recordReadings } from '@/lib/usage';

const probeSchema = runReportSchema.pick({ events: true });

// The governor workflow's probe: the `rate_limit_event` and `result` events of one tiny `claude -p` call.
export const POST = async (request: Request) => {
  const rejection = await rejectUnlessGovernor(request, 'probe readings');
  if (rejection) {
    return rejection;
  }
  const body = probeSchema.safeParse(await request.json().catch(() => undefined));
  if (!body.success) {
    return new Response('invalid body', { status: 400 });
  }
  const now = new Date();
  const readings = readingsFromEvents(body.data.events, now);
  await recordReadings(readings, 'probe', now);
  log('info', 'probe readings recorded', {
    readings: readings.map(({ window, utilisation }) => ({ window, utilisation })),
    result: body.data.events.find((event) => (event as { type?: string } | null)?.type === 'result')
  });
  return Response.json({ readings: readings.length });
};
