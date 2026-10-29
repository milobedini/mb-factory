import {
  deriveKey,
  dispatchLapsesAt,
  isSignedWake,
  nextSlot,
  nextWake,
  probeMoments,
  signWake,
  WAKE_TOPIC,
  wakeBooking
} from '@mb-factory/core';
import { send } from '@vercel/queue';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { queue, runs, wakeBookings } from '@/db/schema';

import { requireEnv } from './env';
import { log } from './log';
import { allProjects } from './projects';

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// A booked moment is only needed until its wake-up has been delivered.
const WAKE_BOOKING_RETENTION_MS = 24 * 60 * 60 * 1000;

const wakeKey = (): Uint8Array => deriveKey(requireEnv('TOKEN_ENCRYPTION_KEY'), 'scheduler-wake');

// Whether a delivered message is a wake-up the console booked itself.
export const isOwnWake = (message: unknown): boolean => isSignedWake(message, wakeKey());

// Books the console's own wake-up at `at`, once: a moment already booked is skipped, and a failure is logged and frees
// the moment, so the next wake-up or the hourly backstop books it again.
export const bookWake = async (at: Date, cause: string): Promise<void> => {
  const booking = wakeBooking(at, new Date());
  try {
    const [claimed] = await getDb()
      .insert(wakeBookings)
      .values({ at })
      .onConflictDoNothing()
      .returning({ at: wakeBookings.at });
    if (!claimed) {
      return;
    }
    const { messageId } = await send(WAKE_TOPIC, signWake(at, wakeKey()), booking).catch(async (error: unknown) => {
      await getDb().delete(wakeBookings).where(eq(wakeBookings.at, at));
      throw error;
    });
    log('info', 'wake booked', { at: at.toISOString(), cause, delaySeconds: booking.delaySeconds, messageId });
  } catch (error) {
    log('error', 'wake booking failed', { at: at.toISOString(), cause, error: errorMessage(error) });
  }
};

// Each scheduled job's next slot, across projects; the health check isn't one, as it runs no agent.
export const nextJobSlots = (now: Date): Date[] =>
  allProjects().flatMap((project) => project.jobs.map((job) => nextSlot(job, now, project.timeZone)));

// The next moment anything is due: the earliest release time of held work, the moment a dispatched run that hasn't
// started counts as lost, the next slot of a scheduled job, or the probe before it.
export const bookNextWake = async (cause: string): Promise<Date | undefined> => {
  const now = new Date();
  const [held, dispatched] = await Promise.all([
    getDb()
      .select({ releaseAt: queue.releaseAt })
      .from(queue)
      .where(and(isNull(queue.releasedAt), gt(queue.releaseAt, now))),
    getDb().select({ dispatchedAt: runs.dispatchedAt }).from(runs).where(eq(runs.status, 'dispatched')),
    getDb()
      .delete(wakeBookings)
      .where(lt(wakeBookings.at, new Date(now.getTime() - WAKE_BOOKING_RETENTION_MS)))
  ]);
  const slots = allProjects().flatMap((project) =>
    [...project.jobs, ...(project.health ? [project.health] : [])].map((slot) => nextSlot(slot, now, project.timeZone))
  );
  const next = nextWake(
    [
      ...held.map(({ releaseAt }) => releaseAt),
      ...dispatched.map(({ dispatchedAt }) => dispatchedAt && dispatchLapsesAt(dispatchedAt)),
      ...slots,
      ...probeMoments(nextJobSlots(now))
    ],
    now
  );
  if (next) {
    await bookWake(next, cause);
  }
  return next;
};
