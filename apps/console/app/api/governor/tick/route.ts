import { needsProbe } from '@mb-factory/core';

import { rejectUnlessGovernor } from '@/lib/github-oidc';
import { log } from '@/lib/log';
import { strictestStaleAfterMinutes } from '@/lib/projects';
import { releaseQueue } from '@/lib/router';
import { countWaiting, latestReadings } from '@/lib/usage';

// Called every 15 minutes by the governor workflow. Answers `probe: true` instead of releasing when held work
// would be released on stale readings; the workflow then probes, posts the readings and calls again with `probed`.
export const POST = async (request: Request) => {
  const rejection = await rejectUnlessGovernor(request, 'governor tick');
  if (rejection) {
    return rejection;
  }
  const body = (await request.json().catch(() => undefined)) as { probed?: unknown } | undefined;
  const probed = body?.probed === true;
  const [waiting, readings] = await Promise.all([countWaiting(), latestReadings()]);
  const now = new Date();
  if (!probed && needsProbe({ readings, waiting, staleAfterMinutes: strictestStaleAfterMinutes(), now })) {
    log('info', 'governor tick asked for a probe', { waiting });
    return Response.json({ probe: true, waiting });
  }
  await releaseQueue();
  const stillWaiting = await countWaiting();
  log('info', 'governor tick released the queue', { waiting, stillWaiting, probed });
  return Response.json({ probe: false, waiting: stillWaiting });
};
