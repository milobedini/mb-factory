import { createHmac, timingSafeEqual } from 'node:crypto';

// The console wakes itself at the next moment anything is due, with a delayed message on this topic. `vercel.json`
// in the console names it too.
export const WAKE_TOPIC = 'scheduler-wake';

// Vercel Queues holds a message for at most 7 days; a later moment is reached by waking at the cap and booking again.
const MAX_DELAY_SECONDS = 7 * 24 * 60 * 60;
// Past the moment itself, so a usage window has reset by the time the governor looks.
const MARGIN_SECONDS = 30;
// How long an undelivered wake-up lingers after its moment before it’s dropped: the hourly backstop covers the rest.
const LINGER_SECONDS = 60 * 60;

// The earliest moment still to come, if any.
export const nextWake = (moments: (Date | null)[], now: Date): Date | undefined =>
  moments.reduce<Date | undefined>(
    (next, moment) => (moment && moment > now && (!next || moment < next) ? moment : next),
    undefined
  );

// How long before a scheduled job's slot the console probes stale usage: the governor job posts readings within about a
// minute, and they're still fresh at the slot.
const PROBE_LEAD_MS = 8 * 60 * 1000;

// The wake-ups that probe before each job's slot.
export const probeMoments = (slots: Date[]): Date[] => slots.map((slot) => new Date(slot.getTime() - PROBE_LEAD_MS));

// The job slot that comes within the lead, if any, so a wake-up then probes readings that will be stale by that slot.
export const jobSlotSoon = (slots: Date[], now: Date): Date | undefined =>
  slots
    .filter((slot) => slot > now && slot.getTime() - now.getTime() <= PROBE_LEAD_MS)
    .reduce<Date | undefined>((soonest, slot) => (soonest === undefined || slot < soonest ? slot : soonest), undefined);

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

export type WakeMessage = { at: string; signature: string };

const signatureOf = (at: string, key: Uint8Array): string =>
  createHmac('sha256', key).update(`wake:${at}`).digest('hex');

// A wake-up's message is signed, because a push delivery runs the handler on the request body before the queue
// service is asked about it: an unsigned or forged one is ignored.
export const signWake = (at: Date, key: Uint8Array): WakeMessage => {
  const iso = at.toISOString();
  return { at: iso, signature: signatureOf(iso, key) };
};

export const isSignedWake = (message: unknown, key: Uint8Array): message is WakeMessage => {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  const { at, signature } = message as Partial<Record<keyof WakeMessage, unknown>>;
  if (typeof at !== 'string' || typeof signature !== 'string') {
    return false;
  }
  const expected = Buffer.from(signatureOf(at, key), 'hex');
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
};

export type WakeDelivery = { kind: 'wake' } | { kind: 'forward'; to: string };

// Where a delivered wake-up runs. Queues hands a wake-up back to the deployment that booked it, so one no longer serving
// production passes it to the one that is, rather than running its own older code. When either deployment is unknown
// (in development, or the lookup failed) it wakes where it is: a missed moment costs more than old code running once.
export const wakeDelivery = (own: string | undefined, production: string | undefined): WakeDelivery =>
  own && production && own !== production ? { kind: 'forward', to: production } : { kind: 'wake' };
