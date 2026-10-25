import { needsProbe } from '@mb-factory/core';

import { rejectUnlessGovernor } from '@/lib/github-oidc';
import { log } from '@/lib/log';
import { currentPause } from '@/lib/pause';
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
  const [waiting, readings, pause] = await Promise.all([countWaiting(), latestReadings(), currentPause()]);
  const paused = pause !== undefined;
  const now = new Date();
  // While paused, only runs someone allowed once can go, and a probe can't change that.
  if (!probed && !paused && needsProbe({ readings, waiting, staleAfterMinutes: strictestStaleAfterMinutes(), now })) {
    log('info', 'governor tick asked for a probe', { waiting });
    return Response.json({ probe: true, waiting });
  }
  await releaseQueue();
  const stillWaiting = await countWaiting();
  log('info', 'governor tick released the queue', { waiting, stillWaiting, probed, paused });
  return Response.json({ probe: false, waiting: stillWaiting, paused });
};
