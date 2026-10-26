import { deriveKey, isSignedWake, nextWake, signWake, WAKE_TOPIC, wakeBooking } from '@mb-factory/core';
import { send } from '@vercel/queue';
import { and, gt, isNull } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { queue } from '@/db/schema';

import { requireEnv } from './env';
import { log } from './log';

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const wakeKey = (): Uint8Array => deriveKey(requireEnv('TOKEN_ENCRYPTION_KEY'), 'scheduler-wake');

// Whether a delivered message is a wake-up the console booked itself.
export const isOwnWake = (message: unknown): boolean => isSignedWake(message, wakeKey());

// Books the console's own wake-up at `at`. A moment already booked is dropped by its idempotency key, and a failure is
// logged: the daily backstop books it again.
export const bookWake = async (at: Date, cause: string): Promise<void> => {
  const booking = wakeBooking(at, new Date());
  try {
    const { messageId } = await send(WAKE_TOPIC, signWake(at, wakeKey()), booking);
    log('info', 'wake booked', { at: at.toISOString(), cause, delaySeconds: booking.delaySeconds, messageId });
  } catch (error) {
    log('error', 'wake booking failed', { at: at.toISOString(), cause, error: errorMessage(error) });
  }
};

// The next moment anything is due: today, the earliest release time of held work.
export const bookNextWake = async (cause: string): Promise<Date | undefined> => {
  const now = new Date();
  const held = await getDb()
    .select({ releaseAt: queue.releaseAt })
    .from(queue)
    .where(and(isNull(queue.releasedAt), gt(queue.releaseAt, now)));
  const next = nextWake(
    held.map(({ releaseAt }) => releaseAt),
    now
  );
  if (next) {
    await bookWake(next, cause);
  }
  return next;
};
