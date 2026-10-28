import { describe, expect, it } from 'vitest';

import { isSignedWake, jobSlotSoon, nextWake, probeMoments, signWake, wakeBooking } from './scheduler';

const now = new Date('2026-10-26T12:00:00Z');
const later = (minutes: number): Date => new Date(now.getTime() + minutes * 60_000);

describe('nextWake', () => {
  it('picks the earliest moment still to come', () => {
    expect(nextWake([later(90), null, later(30), later(-5)], now)).toEqual(later(30));
  });

  it('has nothing to wake for when every moment has passed', () => {
    expect(nextWake([later(-5), null], now)).toBeUndefined();
    expect(nextWake([], now)).toBeUndefined();
  });
});

describe('wakeBooking', () => {
  it('wakes just after the moment, keyed on it, and lingers an hour', () => {
    expect(wakeBooking(later(30), now)).toEqual({
      delaySeconds: 30 * 60 + 30,
      retentionSeconds: 30 * 60 + 30 + 3600,
      idempotencyKey: 'wake:2026-10-26T12:30:00.000Z'
    });
  });

  it('caps the delay and the retention at 7 days', () => {
    const booking = wakeBooking(later(9 * 24 * 60), now);
    expect(booking.delaySeconds).toBe(604_800);
    expect(booking.retentionSeconds).toBe(604_800);
  });

  it('wakes straight away for a moment that has passed', () => {
    expect(wakeBooking(later(-5), now).delaySeconds).toBe(30);
  });
});

describe('signWake', () => {
  const key = new Uint8Array(32).fill(7);

  it('accepts its own signature and nothing else', () => {
    const message = signWake(later(30), key);
    expect(message.at).toBe('2026-10-26T12:30:00.000Z');
    expect(isSignedWake(message, key)).toBe(true);
    expect(isSignedWake({ ...message, at: later(31).toISOString() }, key)).toBe(false);
    expect(isSignedWake(message, new Uint8Array(32).fill(8))).toBe(false);
    expect(isSignedWake({ at: message.at, signature: 'abc' }, key)).toBe(false);
    expect(isSignedWake({ cause: 'hold' }, key)).toBe(false);
    expect(isSignedWake(null, key)).toBe(false);
  });
});

describe('probing before a job', () => {
  const slot = new Date('2026-10-28T06:00:00Z');

  it('wakes eight minutes before each slot', () => {
    expect(probeMoments([slot])).toEqual([new Date('2026-10-28T05:52:00Z')]);
  });

  // The 06:00 and 06:30 checks, 28 Oct, dispatched on readings from the night before.
  it('counts a slot as soon from its probe wake-up until it comes', () => {
    expect(jobSlotSoon([slot], new Date('2026-10-28T05:52:30Z'))).toBe(true);
    expect(jobSlotSoon([slot], new Date('2026-10-28T05:50:00Z'))).toBe(false);
    expect(jobSlotSoon([slot], new Date('2026-10-28T06:00:30Z'))).toBe(false);
  });
});
