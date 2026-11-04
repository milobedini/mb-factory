import {
  deriveKey,
  designRunLapsesAt,
  dispatchLapsesAt,
  isSignedWake,
  MERGE_WATCH_END_EVENT,
  MERGE_WATCH_EVENT,
  nextSlot,
  nextWake,
  probeMoments,
  readMergeWatch,
  signWake,
  WAKE_TOPIC,
  type WakeMessage,
  wakeBooking,
  wakeDelivery
} from '@mb-factory/core';
import { QueueClient } from '@vercel/queue';
import { and, eq, gt, inArray, isNull, lt } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { events, queue, runs, wakeBookings } from '@/db/schema';

import { requireEnv } from './env';
import { log } from './log';
import { allProjects } from './projects';

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// A booked moment is only needed until its wake-up has been delivered.
const WAKE_BOOKING_RETENTION_MS = 24 * 60 * 60 * 1000;

// Pinned to this deployment, as Queues delivers a pushed message only to the deployment that sent it: unpinned wake-ups
// (3 to 4 Nov) reached none. A deployment no longer in production passes each wake-up on (`forwardWake`), so old
// deployments don't keep chains of their own going (48 answered wakes on 3 Nov).
const { send } = new QueueClient();

const wakeKey = (): Uint8Array => deriveKey(requireEnv('TOKEN_ENCRYPTION_KEY'), 'scheduler-wake');

// Whether a delivered message is a wake-up the console booked itself.
export const isOwnWake = (message: unknown): message is WakeMessage => isSignedWake(message, wakeKey());

// The deployment serving production, as it says itself; undefined when it can't be asked.
const productionDeployment = async (): Promise<string | undefined> => {
  try {
    const response = await fetch(`${requireEnv('CONSOLE_URL')}/api/scheduler/deployment`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000)
    });
    const { deploymentId } = (await response.json()) as { deploymentId?: unknown };
    return typeof deploymentId === 'string' ? deploymentId : undefined;
  } catch (error) {
    log('warn', 'production deployment lookup failed', { error: errorMessage(error) });
    return undefined;
  }
};

// Passes a delivered wake-up to the deployment serving production when this one no longer is, and says whether it did.
// It goes out at once, signed as booked; a failed send throws, so Queues delivers the wake-up here again.
export const forwardWake = async (message: WakeMessage): Promise<boolean> => {
  const own = process.env.VERCEL_DEPLOYMENT_ID;
  const delivery = wakeDelivery(own, await productionDeployment());
  if (delivery.kind === 'wake') {
    return false;
  }
  const { messageId } = await new QueueClient({ deploymentId: delivery.to }).send(WAKE_TOPIC, message);
  log('info', 'wake forwarded', { at: message.at, from: own, to: delivery.to, messageId });
  return true;
};

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

// When each open watch after an auto-merge ends (router's `endMergeWatches`), in case its own booking was lost.
const mergeWatchEnds = async (now: Date): Promise<Date[]> => {
  const recorded = await getDb()
    .select({ deliveryId: events.deliveryId, type: events.type, payload: events.payload })
    .from(events)
    .where(
      and(
        inArray(events.type, [MERGE_WATCH_EVENT, MERGE_WATCH_END_EVENT]),
        gt(events.receivedAt, new Date(now.getTime() - WAKE_BOOKING_RETENTION_MS))
      )
    );
  const ended = new Set(
    recorded.filter(({ type }) => type === MERGE_WATCH_END_EVENT).map(({ deliveryId }) => deliveryId)
  );
  return recorded.flatMap(({ deliveryId, type, payload }) => {
    const watch = type === MERGE_WATCH_EVENT ? readMergeWatch(payload) : undefined;
    return watch && !ended.has(`${deliveryId}:end`) ? [new Date(watch.endsAt)] : [];
  });
};

// The next moment anything is due: the earliest release time of held work, the end of a watch after an auto-merge, the moment a dispatched run that hasn't
// started counts as lost or a design session that hasn't reported is ended, the next slot of a scheduled job, or the probe before it.
export const bookNextWake = async (cause: string): Promise<Date | undefined> => {
  const now = new Date();
  const [held, dispatched, designing, , watchEnds] = await Promise.all([
    getDb()
      .select({ releaseAt: queue.releaseAt })
      .from(queue)
      .where(and(isNull(queue.releasedAt), gt(queue.releaseAt, now))),
    getDb().select({ dispatchedAt: runs.dispatchedAt }).from(runs).where(eq(runs.status, 'dispatched')),
    getDb()
      .select({ startedAt: runs.startedAt })
      .from(runs)
      .where(and(eq(runs.status, 'running'), eq(runs.agent, 'design'))),
    getDb()
      .delete(wakeBookings)
      .where(lt(wakeBookings.at, new Date(now.getTime() - WAKE_BOOKING_RETENTION_MS))),
    mergeWatchEnds(now)
  ]);
  const slots = allProjects().flatMap((project) =>
    [...project.jobs, ...(project.health ? [project.health] : [])].map((slot) => nextSlot(slot, now, project.timeZone))
  );
  const next = nextWake(
    [
      ...held.map(({ releaseAt }) => releaseAt),
      ...dispatched.map(({ dispatchedAt }) => dispatchedAt && dispatchLapsesAt(dispatchedAt)),
      ...designing.map(({ startedAt }) => startedAt && designRunLapsesAt(startedAt)),
      ...slots,
      ...watchEnds,
      ...probeMoments(nextJobSlots(now))
    ],
    now
  );
  if (next) {
    await bookWake(next, cause);
  }
  return next;
};
