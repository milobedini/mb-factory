import { describe, expect, it } from 'vitest';

import type { UsagePolicy } from './config';
import type { DispatchRequest, UsageReading } from './governor';
import { decideDispatch } from './governor';

const policy: UsagePolicy = {
  sevenDay: { pacing: true, slack: 0.1, pauseAt: 0.85 },
  staleAfterMinutes: 20,
  downshift: { triage: 'haiku' }
};

const now = new Date('2026-10-24T12:00:00Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const hoursFromNow = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

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
  readings: { sevenDay: sevenDay(0.1, 6) },
  priority: 'feature',
  runningCount: 0,
  maxRuns: 2,
  now,
  ...overrides
});

describe('decideDispatch', () => {
  it('dispatches feature work when the week is well within its limit', () => {
    expect(decideDispatch(request({}))).toEqual({ kind: 'dispatch', state: 'open', downshift: false });
  });

  it('asks for a probe when the reading is older than the stale limit', () => {
    const decision = decideDispatch(request({ readings: { sevenDay: sevenDay(0.1, 6, { takenAt: minutesAgo(30) }) } }));
    expect(decision).toEqual({ kind: 'probe', stale: ['sevenDay'] });
  });

  it('asks for a probe when the week has never been read', () => {
    expect(decideDispatch(request({ readings: {} }))).toEqual({ kind: 'probe', stale: ['sevenDay'] });
  });

  it('decides on stale or missing readings when told to accept them', () => {
    const stale = { sevenDay: sevenDay(0.9, 1, { takenAt: minutesAgo(30) }) };
    expect(decideDispatch(request({ readings: stale, acceptStale: true }))).toEqual({
      kind: 'hold',
      state: 'paused',
      reason: 'weekly_pause',
      releaseAt: hoursFromNow(24)
    });
    expect(decideDispatch(request({ readings: {}, acceptStale: true }))).toEqual({
      kind: 'dispatch',
      state: 'open',
      downshift: false
    });
  });

  it('treats a week whose reset time has passed as empty, without probing', () => {
    const reset = { sevenDay: sevenDay(0.95, 0, { resetsAt: minutesAgo(5), takenAt: minutesAgo(90) }) };
    expect(decideDispatch(request({ readings: reset }))).toEqual({ kind: 'dispatch', state: 'open', downshift: false });
  });

  it('holds even urgent work once the week reaches its pause threshold', () => {
    const decision = decideDispatch(request({ priority: 'urgent', readings: { sevenDay: sevenDay(0.86, 1) } }));
    expect(decision).toEqual({ kind: 'hold', state: 'paused', reason: 'weekly_pause', releaseAt: hoursFromNow(24) });
  });

  it('throttles feature work that is ahead of the weekly pace', () => {
    const decision = decideDispatch(request({ readings: { sevenDay: sevenDay(0.5, 5) } }));
    expect(decision).toEqual({
      kind: 'hold',
      state: 'throttled',
      reason: 'weekly_pacing',
      releaseAt: new Date(hoursFromNow(5 * 24).getTime() - 7 * 86_400_000 + 0.4 * 7 * 86_400_000)
    });
  });

  it('dispatches in-flight work on cheaper models while ahead of the pace', () => {
    const decision = decideDispatch(request({ priority: 'in_flight', readings: { sevenDay: sevenDay(0.5, 5) } }));
    expect(decision).toEqual({ kind: 'dispatch', state: 'throttled', downshift: true });
  });

  it('allows weekly use up to the elapsed share of the week plus slack', () => {
    const decision = decideDispatch(request({ readings: { sevenDay: sevenDay(0.38, 5) } }));
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
