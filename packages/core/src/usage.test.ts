import { describe, expect, it } from 'vitest';

import type { UsagePolicy } from './config';
import type { UsageReading } from './governor';
import { formatDuration, needsProbe, readingsFromStatusLine, summariseUsage } from './usage';

const now = new Date('2026-10-25T08:00:00Z');
const epoch = (date: Date) => date.getTime() / 1000;
const hoursFromNow = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

describe('readingsFromStatusLine', () => {
  it('turns the status line’s percentages into utilisation readings', () => {
    expect(
      readingsFromStatusLine(
        {
          five_hour: { used_percentage: 42.5, resets_at: epoch(hoursFromNow(3)) },
          seven_day: { used_percentage: 12, resets_at: epoch(hoursFromNow(100)) }
        },
        now
      )
    ).toEqual([{ window: 'sevenDay', utilisation: 0.12, resetsAt: hoursFromNow(100), status: null }]);
  });

  it('ignores a 5-hour window, and caps utilisation at 1', () => {
    expect(
      readingsFromStatusLine({ seven_day: { used_percentage: 130, resets_at: epoch(hoursFromNow(1)) } }, now)
    ).toEqual([{ window: 'sevenDay', utilisation: 1, resetsAt: hoursFromNow(1), status: null }]);
    expect(
      readingsFromStatusLine({ five_hour: { used_percentage: 10, resets_at: epoch(hoursFromNow(3)) } }, now)
    ).toEqual([]);
  });

  it('drops a window whose reset time could not be real', () => {
    expect(
      readingsFromStatusLine({ seven_day: { used_percentage: 10, resets_at: epoch(hoursFromNow(24 * 9)) } }, now)
    ).toEqual([]);
  });

  it('rejects a body that is not status line usage', () => {
    expect(readingsFromStatusLine({ seven_day: { used_percentage: 'high' } }, now)).toBeUndefined();
  });
});

describe('needsProbe', () => {
  const reading = (minutesOld: number): UsageReading => ({
    window: 'sevenDay',
    utilisation: 0.5,
    resetsAt: hoursFromNow(48),
    takenAt: new Date(now.getTime() - minutesOld * 60_000),
    source: 'local'
  });
  const fresh = { sevenDay: reading(1) };

  const inMinutes = (minutes: number) => new Date(now.getTime() + minutes * 60_000);

  it('probes before a scheduled job on stale readings, with nothing held', () => {
    const stale = { sevenDay: reading(600) };
    expect(needsProbe({ readings: stale, waiting: 0, jobAt: inMinutes(8), staleAfterMinutes: 20, now })).toBe(true);
    expect(needsProbe({ readings: fresh, waiting: 0, jobAt: inMinutes(8), staleAfterMinutes: 20, now })).toBe(false);
    expect(needsProbe({ readings: stale, waiting: 0, staleAfterMinutes: 20, now })).toBe(false);
  });

  // 9 Nov: a reading taken at 05:33 was 19 minutes old at the 05:52 wake-up, so nothing probed, and the 06:00 security
  // check dispatched on it at 27 minutes.
  it('probes before a scheduled job when the readings will be stale by its slot', () => {
    const readings = { sevenDay: reading(19) };
    expect(needsProbe({ readings, waiting: 0, jobAt: inMinutes(8), staleAfterMinutes: 20, now })).toBe(true);
    expect(needsProbe({ readings, waiting: 0, staleAfterMinutes: 20, now })).toBe(false);
  });

  it('probes before releasing held work on stale readings', () => {
    expect(needsProbe({ readings: { sevenDay: reading(30) }, waiting: 1, staleAfterMinutes: 20, now })).toBe(true);
  });

  it('skips the probe when nothing is waiting, or the readings are fresh', () => {
    expect(needsProbe({ readings: {}, waiting: 0, staleAfterMinutes: 20, now })).toBe(false);
    expect(needsProbe({ readings: fresh, waiting: 3, staleAfterMinutes: 20, now })).toBe(false);
  });
});

describe('summariseUsage', () => {
  const policy: UsagePolicy = {
    sevenDay: { pacing: true, slack: 0.1, pauseAt: 0.85 },
    staleAfterMinutes: 20,
    downshift: {}
  };
  const reading = (window: UsageReading['window'], utilisation: number, resetsAt: Date): UsageReading => ({
    window,
    utilisation,
    resetsAt,
    takenAt: new Date(now.getTime() - 5 * 60_000),
    source: 'local'
  });

  it('shows the week with its thresholds and the state the governor would decide on', () => {
    // Half the week left: pacing allows 50% + 10% slack.
    const summary = summariseUsage({
      policy,
      readings: { sevenDay: reading('sevenDay', 0.65, hoursFromNow(84)) },
      now
    });
    expect(summary).toMatchObject({ state: 'throttled', reason: 'weekly_pacing' });
    expect(summary.windows).toHaveLength(1);
    expect(summary.windows[0]).toMatchObject({ window: 'sevenDay', utilisation: 0.65, pauseAt: 0.85, stale: false });
    expect(summary.windows[0]?.paceLimit).toBeCloseTo(0.6);
  });

  it('counts a week that has reset as empty, and a missing one as stale', () => {
    const reset = summariseUsage({ policy, readings: { sevenDay: reading('sevenDay', 0.9, hoursFromNow(-1)) }, now });
    expect(reset.state).toBe('open');
    expect(reset.windows[0]).toMatchObject({ utilisation: 0, reset: true, resetsAt: null, stale: false });
    expect(summariseUsage({ policy, readings: {}, now }).windows[0]).toMatchObject({ source: null, stale: true });
  });
});

describe('formatDuration', () => {
  it('reads as days, hours and minutes, dropping minutes once it runs to days', () => {
    expect(formatDuration(30_000)).toBe('under a minute');
    expect(formatDuration(4 * 60_000)).toBe('4 min');
    expect(formatDuration((2 * 60 + 51) * 60_000)).toBe('2 h 51 min');
    expect(formatDuration(3_600_000)).toBe('1 h');
    expect(formatDuration((26 * 60 + 5) * 60_000)).toBe('1 d 2 h');
  });
});
