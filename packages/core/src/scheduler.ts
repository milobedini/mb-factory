// The console wakes itself at the next moment anything is due, with a delayed message on this topic. `vercel.json`
// in the console names it too.
export const WAKE_TOPIC = 'scheduler-wake';

// Vercel Queues holds a message for at most 7 days; a later moment is reached by waking at the cap and booking again.
const MAX_DELAY_SECONDS = 7 * 24 * 60 * 60;
// Past the moment itself, so a usage window has reset by the time the governor looks.
const MARGIN_SECONDS = 30;
// How long an undelivered wake-up lingers after its moment before it's dropped: the daily backstop covers the rest.
const LINGER_SECONDS = 60 * 60;

// The earliest moment still to come, if any.
export const nextWake = (moments: (Date | null)[], now: Date): Date | undefined =>
  moments.reduce<Date | undefined>(
    (next, moment) => (moment && moment > now && (!next || moment < next) ? moment : next),
    undefined
  );

export type WakeBooking = { delaySeconds: number; retentionSeconds: number; idempotencyKey: string };

// The send options for a wake-up at `at`. The key names the moment, so booking it again is dropped as a duplicate.
export const wakeBooking = (at: Date, now: Date): WakeBooking => {
  const delaySeconds = Math.min(
    Math.max(Math.ceil((at.getTime() - now.getTime()) / 1000), 0) + MARGIN_SECONDS,
    MAX_DELAY_SECONDS
  );
  return {
    delaySeconds,
    retentionSeconds: Math.min(delaySeconds + LINGER_SECONDS, MAX_DELAY_SECONDS),
    idempotencyKey: `wake:${at.toISOString()}`
  };
};
