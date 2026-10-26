import { needsProbe } from '@mb-factory/core';

import { startGovernorProbe } from './github-api';
import { fireDueJobs } from './jobs';
import { log } from './log';
import { currentPause } from './pause';
import { strictestStaleAfterMinutes } from './projects';
import { releaseQueue } from './router';
import { countWaiting, latestReadings } from './usage';
import { bookNextWake } from './wake';

export type WakeResult = { waiting: number; probing: boolean; nextWake: string | null };

// One wake-up, from a delayed message, the daily cron or the governor job: start any job whose slot has come, release
// what's free, start a probe when held work would otherwise be judged on stale readings, and book the next wake-up.
// Safe to run any number of times.
export const wake = async (cause: string): Promise<WakeResult> => {
  await fireDueJobs(new Date());
  await releaseQueue();
  const [waiting, readings, pause] = await Promise.all([countWaiting(), latestReadings(), currentPause()]);
  // While paused only runs someone allowed once can go, and a probe can't change that.
  const probing =
    pause === undefined &&
    needsProbe({ readings, waiting, staleAfterMinutes: strictestStaleAfterMinutes(), now: new Date() });
  if (probing) {
    // The governor job probes, posts the readings and ticks, which releases on them.
    await startGovernorProbe().catch((error: unknown) =>
      log('error', 'wake probe dispatch failed', {
        cause,
        error: error instanceof Error ? error.message : String(error)
      })
    );
  }
  const next = await bookNextWake(cause);
  log('info', 'woke', { cause, waiting, probing, nextWake: next?.toISOString() });
  return { waiting, probing, nextWake: next?.toISOString() ?? null };
};
