import { describe, expect, it } from 'vitest';

import { dispatchLapsedBefore, dispatchLapsesAt, formatRunTime, isOpenRun, runTiming, runTotals } from './runs';

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 25, 12, minutes));

describe('dispatch lapse', () => {
  it('comes fifteen minutes after the dispatch', () => {
    expect(dispatchLapsesAt(at(10))).toEqual(at(25));
    expect(dispatchLapsedBefore(at(30))).toEqual(at(15));
  });
});

describe('isOpenRun', () => {
  it.each([
    ['queued', true],
    ['running', true],
    ['finished', false],
    ['limit_hit', false],
    ['canceled', false]
  ] as const)('treats %s as open: %s', (status, open) => {
    expect(isOpenRun(status)).toBe(open);
  });
});

describe('runTiming', () => {
  it('measures the wait and the run of a finished run', () => {
    expect(runTiming({ createdAt: at(0), dispatchedAt: at(2), startedAt: at(3), finishedAt: at(5) }, at(30))).toEqual({
      waitedMs: 120_000,
      ranMs: 120_000
    });
  });

  it('measures open spans to now', () => {
    expect(runTiming({ createdAt: at(0), dispatchedAt: null, startedAt: null, finishedAt: null }, at(4))).toEqual({
      waitedMs: 240_000,
      ranMs: null
    });
    expect(runTiming({ createdAt: at(0), dispatchedAt: at(1), startedAt: at(1), finishedAt: null }, at(4))).toEqual({
      waitedMs: 60_000,
      ranMs: 180_000
    });
  });

  it('ends the wait of a run canceled in the queue when it was canceled', () => {
    expect(runTiming({ createdAt: at(0), dispatchedAt: null, startedAt: null, finishedAt: at(3) }, at(10))).toEqual({
      waitedMs: 180_000,
      ranMs: null
    });
  });
});

describe('formatRunTime', () => {
  it.each([
    [0, '0 s'],
    [34_400, '34 s'],
    [60_000, '1 min'],
    [145_000, '2 min 25 s'],
    [3_780_000, '1 h 3 min'],
    [7_200_000, '2 h']
  ])('formats %d ms as %s', (ms, text) => {
    expect(formatRunTime(ms)).toBe(text);
  });
});

describe('runTotals', () => {
  it('adds up the runs that reported', () => {
    expect(
      runTotals([
        { costUsd: 0.5, durationMs: 60_000 },
        { costUsd: null, durationMs: null },
        { costUsd: 0.25, durationMs: 30_000 }
      ])
    ).toEqual({ runs: 3, costUsd: 0.75, durationMs: 90_000 });
  });

  it('keeps the cost unknown until a run reports one', () => {
    expect(runTotals([{ costUsd: null, durationMs: null }])).toEqual({ runs: 1, costUsd: null, durationMs: 0 });
  });
});
