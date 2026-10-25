import { describe, expect, it } from 'vitest';

import type { UsageReading } from './governor';
import { needsProbe, readingsFromStatusLine } from './usage';

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
    ).toEqual([
      { window: 'fiveHour', utilisation: 0.425, resetsAt: hoursFromNow(3), status: null },
      { window: 'sevenDay', utilisation: 0.12, resetsAt: hoursFromNow(100), status: null }
    ]);
  });

  it('keeps the windows that are present, and caps utilisation at 1', () => {
    expect(
      readingsFromStatusLine({ five_hour: { used_percentage: 130, resets_at: epoch(hoursFromNow(1)) } }, now)
    ).toEqual([{ window: 'fiveHour', utilisation: 1, resetsAt: hoursFromNow(1), status: null }]);
  });

  it('drops a window whose reset time could not be real', () => {
    expect(
      readingsFromStatusLine({ five_hour: { used_percentage: 10, resets_at: epoch(hoursFromNow(48)) } }, now)
    ).toEqual([]);
  });

  it('rejects a body that is not status line usage', () => {
    expect(readingsFromStatusLine({ five_hour: { used_percentage: 'high' } }, now)).toBeUndefined();
  });
});

describe('needsProbe', () => {
  const reading = (minutesOld: number): UsageReading => ({
    window: 'fiveHour',
    utilisation: 0.5,
    resetsAt: hoursFromNow(2),
    takenAt: new Date(now.getTime() - minutesOld * 60_000),
    source: 'local'
  });
  const fresh = { fiveHour: reading(1), sevenDay: { ...reading(1), window: 'sevenDay' as const } };

  it('probes before releasing held work on stale readings', () => {
    expect(needsProbe({ readings: { ...fresh, fiveHour: reading(30) }, waiting: 1, staleAfterMinutes: 20, now })).toBe(
      true
    );
  });

  it('skips the probe when nothing is waiting, or the readings are fresh', () => {
    expect(needsProbe({ readings: {}, waiting: 0, staleAfterMinutes: 20, now })).toBe(false);
    expect(needsProbe({ readings: fresh, waiting: 3, staleAfterMinutes: 20, now })).toBe(false);
  });
});
