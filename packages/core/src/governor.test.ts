import { describe, expect, it } from 'vitest';

import type { UsagePolicy } from './config';
import type { DispatchRequest, UsageReading } from './governor';
import { decideDispatch } from './governor';

const policy: UsagePolicy = {
  fiveHour: { throttleAt: 0.6, pauseAt: 0.8 },
  sevenDay: { pacing: true, slack: 0.1, pauseAt: 0.85 },
  staleAfterMinutes: 20,
  downshift: { triage: 'haiku' }
};

const now = new Date('2026-10-24T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const hoursFromNow = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

const fiveHour = (utilisation: number, overrides: Partial<UsageReading> = {}): UsageReading => ({
  window: 'fiveHour',
  utilisation,
  resetsAt: hoursFromNow(2),
  takenAt: minutesAgo(1),
  source: 'probe',
  ...overrides
});

const sevenDay = (utilisation: number, daysLeft: number, overrides: Partial<UsageReading> = {}): UsageReading => ({
  window: 'sevenDay',
  utilisation,
  resetsAt: hoursFromNow(daysLeft * 24),
  takenAt: minutesAgo(1),
  source: 'probe',
  ...overrides
});

const request = (overrides: Partial<DispatchRequest>): DispatchRequest => ({
  policy,
  readings: { fiveHour: fiveHour(0.1), sevenDay: sevenDay(0.1, 6) },
  priority: 'feature',
  runningCount: 0,
  maxRuns: 2,
  now,
  ...overrides
});

describe('decideDispatch', () => {
  it('dispatches feature work when both windows are well within limits', () => {
    expect(decideDispatch(request({}))).toEqual({ kind: 'dispatch', state: 'open', downshift: false });
  });

  it('asks for a probe when a reading is older than the stale limit', () => {
    const decision = decideDispatch(
      request({ readings: { fiveHour: fiveHour(0.1, { takenAt: minutesAgo(30) }), sevenDay: sevenDay(0.1, 6) } })
    );
    expect(decision).toEqual({ kind: 'probe', stale: ['fiveHour'] });
  });

  it('asks for a probe when a window has never been read', () => {
    expect(decideDispatch(request({ readings: { sevenDay: sevenDay(0.1, 6) } }))).toEqual({
      kind: 'probe',
      stale: ['fiveHour']
    });
  });

  it('treats a window whose reset time has passed as empty, without probing', () => {
    const decision = decideDispatch(
      request({
        readings: {
          fiveHour: fiveHour(0.95, { resetsAt: minutesAgo(5), takenAt: minutesAgo(90) }),
          sevenDay: sevenDay(0.1, 6)
        }
      })
    );
    expect(decision).toEqual({ kind: 'dispatch', state: 'open', downshift: false });
  });

  it('holds feature work at the five-hour throttle and releases at the window reset', () => {
    const decision = decideDispatch(request({ readings: { fiveHour: fiveHour(0.65), sevenDay: sevenDay(0.1, 6) } }));
    expect(decision).toEqual({
      kind: 'hold',
      state: 'throttled',
      reason: 'five_hour_throttle',
      releaseAt: hoursFromNow(2)
    });
  });

  it('dispatches in-flight work on cheaper models while throttled', () => {
    const decision = decideDispatch(
      request({ priority: 'in_flight', readings: { fiveHour: fiveHour(0.65), sevenDay: sevenDay(0.1, 6) } })
    );
    expect(decision).toEqual({ kind: 'dispatch', state: 'throttled', downshift: true });
  });

  it('holds even urgent work once the five-hour window reaches its pause threshold', () => {
    const decision = decideDispatch(
      request({ priority: 'urgent', readings: { fiveHour: fiveHour(0.8), sevenDay: sevenDay(0.1, 6) } })
    );
    expect(decision).toEqual({ kind: 'hold', state: 'paused', reason: 'five_hour_pause', releaseAt: hoursFromNow(2) });
  });

  it('pauses on the weekly threshold before considering the five-hour window', () => {
    const decision = decideDispatch(request({ readings: { fiveHour: fiveHour(0.9), sevenDay: sevenDay(0.86, 1) } }));
    expect(decision).toEqual({ kind: 'hold', state: 'paused', reason: 'weekly_pause', releaseAt: hoursFromNow(24) });
  });

  it('throttles feature work that is ahead of the weekly pace', () => {
    const decision = decideDispatch(request({ readings: { fiveHour: fiveHour(0.1), sevenDay: sevenDay(0.5, 5) } }));
    expect(decision).toEqual({
      kind: 'hold',
      state: 'throttled',
      reason: 'weekly_pacing',
      releaseAt: new Date(hoursFromNow(5 * 24).getTime() - 7 * 86_400_000 + 0.4 * 7 * 86_400_000)
    });
  });

  it('allows weekly use up to the elapsed share of the week plus slack', () => {
    const decision = decideDispatch(request({ readings: { fiveHour: fiveHour(0.1), sevenDay: sevenDay(0.38, 5) } }));
    expect(decision).toEqual({ kind: 'dispatch', state: 'open', downshift: false });
  });

  it('holds at the concurrency cap even when usage is open', () => {
    expect(decideDispatch(request({ runningCount: 2 }))).toEqual({
      kind: 'hold',
      state: 'open',
      reason: 'concurrency'
    });
  });
});
