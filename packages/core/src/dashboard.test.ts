import { describe, expect, it } from 'vitest';

import type { DashboardInput, DashboardRun, DashboardStageChange, DashboardWorkItem } from './dashboard';
import { blockedWaitMs, dashboardMetrics, median, readDashboardRange, sizeLabel, timeInStages } from './dashboard';

const MINUTE = 60 * 1000;
const now = new Date('2026-10-26T12:00:00Z');
const at = (iso: string): Date => new Date(iso);
const minutesAfter = (start: Date, minutes: number): Date => new Date(start.getTime() + minutes * MINUTE);

const workItem = (overrides: Partial<DashboardWorkItem> & Pick<DashboardWorkItem, 'id'>): DashboardWorkItem => ({
  identifier: overrides.id.toUpperCase(),
  title: `Work on ${overrides.id}`,
  url: `https://linear.app/tastebook/issue/${overrides.id}`,
  origin: 'linear',
  estimate: 2,
  humanPushes: 0,
  createdAt: at('2026-10-25T09:00:00Z'),
  prOpenedAt: null,
  mergedAt: null,
  closedAt: null,
  ...overrides
});

const run = (overrides: Partial<DashboardRun> = {}): DashboardRun => ({
  workItemId: 'a',
  agent: 'implement',
  model: 'opus',
  trigger: 'delegated',
  status: 'finished',
  outcome: 'done',
  report: null,
  costUsd: 0.5,
  inputTokens: 100,
  outputTokens: 50,
  cacheReadInputTokens: 1000,
  cacheCreationInputTokens: 10,
  createdAt: at('2026-10-25T09:05:00Z'),
  startedAt: at('2026-10-25T09:05:30Z'),
  finishedAt: at('2026-10-25T09:07:30Z'),
  ...overrides
});

const review = (workItemId: string, verdict: string, createdAt: Date): DashboardRun =>
  run({ workItemId, agent: 'review', model: 'sonnet', trigger: 'delivered', report: { verdict }, createdAt });

const timeline = (workItemId: string, start: Date, steps: [DashboardStageChange['stage'], number][]) =>
  steps.reduce<{ changes: DashboardStageChange[]; at: Date }>(
    ({ changes, at: current }, [stage, minutes]) => ({
      changes: [...changes, { workItemId, stage, at: current }],
      at: minutesAfter(current, minutes)
    }),
    { changes: [], at: start }
  ).changes;

const input = (overrides: Partial<DashboardInput> = {}): DashboardInput => ({
  now,
  days: 14,
  timeZone: 'Europe/London',
  workItems: [],
  stageChanges: [],
  runs: [],
  questions: [],
  ...overrides
});

describe('readDashboardRange', () => {
  it('takes a listed range and falls back to two weeks', () => {
    expect(readDashboardRange('7')).toBe(7);
    expect(readDashboardRange('30')).toBe(30);
    expect(readDashboardRange('9')).toBe(14);
    expect(readDashboardRange(undefined)).toBe(14);
  });
});

describe('sizeLabel', () => {
  it('names Linear’s T-shirt estimates', () => {
    expect([1, 2, 3, 5, 8].map(sizeLabel)).toEqual(['XS', 'S', 'M', 'L', 'XL']);
    expect(sizeLabel(null)).toBe('unsized');
    expect(sizeLabel(4)).toBe('unsized');
  });
});

describe('median', () => {
  it('takes the middle value, or the mean of the middle two', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('timeInStages', () => {
  it('adds up each stage’s spells, the last one running to the end', () => {
    const start = at('2026-10-25T09:00:00Z');
    const changes = timeline('a', start, [
      ['researching', 2],
      ['building', 5],
      ['in_review', 3],
      ['building', 4],
      ['in_review', 1],
      ['awaiting_merge', 0]
    ]);
    const stages = timeInStages(changes, minutesAfter(start, 25));
    expect(Object.fromEntries(stages)).toEqual({
      researching: 2 * MINUTE,
      building: 9 * MINUTE,
      in_review: 4 * MINUTE,
      awaiting_merge: 10 * MINUTE
    });
  });

  it('ignores changes after the end and changes out of order', () => {
    const changes: DashboardStageChange[] = [
      { workItemId: 'a', stage: 'building', at: at('2026-10-25T09:10:00Z') },
      { workItemId: 'a', stage: 'researching', at: at('2026-10-25T09:00:00Z') },
      { workItemId: 'a', stage: 'done', at: at('2026-10-25T09:30:00Z') }
    ];
    expect(Object.fromEntries(timeInStages(changes, at('2026-10-25T09:20:00Z')))).toEqual({
      researching: 10 * MINUTE,
      building: 10 * MINUTE
    });
  });
});

describe('blockedWaitMs', () => {
  it('counts from each blocked or failed run to the next run, or the end', () => {
    const blocked = run({
      outcome: 'blocked',
      createdAt: at('2026-10-25T09:00:00Z'),
      finishedAt: at('2026-10-25T09:10:00Z')
    });
    const next = run({ createdAt: at('2026-10-25T09:40:00Z'), finishedAt: at('2026-10-25T09:50:00Z') });
    const failed = run({
      outcome: 'failed',
      createdAt: at('2026-10-25T10:00:00Z'),
      finishedAt: at('2026-10-25T10:05:00Z')
    });
    expect(blockedWaitMs([failed, next, blocked], at('2026-10-25T10:20:00Z'))).toBe((30 + 15) * 60_000);
    expect(blockedWaitMs([next], at('2026-10-25T10:20:00Z'))).toBe(0);
  });
});

describe('dashboardMetrics', () => {
  const start = at('2026-10-25T09:00:00Z');
  // Delegated 09:00, merged 10:00: 2 min triage, 10 min spec, 20 min spec review, 8 min building, 2 min review,
  // 18 min at the merge gate.
  const specced = workItem({
    id: 'a',
    estimate: 3,
    createdAt: start,
    prOpenedAt: minutesAfter(start, 12),
    mergedAt: minutesAfter(start, 60)
  });
  const speccedChanges = timeline('a', start, [
    ['researching', 2],
    ['spec', 10],
    ['spec_review', 20],
    ['building', 8],
    ['in_review', 2],
    ['awaiting_merge', 18],
    ['done', 0]
  ]);
  // Delegated 11:00 the next day, merged 11:30, with a human push.
  const quick = workItem({
    id: 'b',
    estimate: 1,
    humanPushes: 1,
    createdAt: at('2026-10-26T11:00:00Z'),
    prOpenedAt: at('2026-10-26T11:10:00Z'),
    mergedAt: at('2026-10-26T11:30:00Z')
  });
  const quickChanges = timeline('b', quick.createdAt, [
    ['researching', 5],
    ['building', 15],
    ['in_review', 5],
    ['awaiting_merge', 5],
    ['done', 0]
  ]);
  const closed = workItem({
    id: 'c',
    origin: 'dependabot',
    estimate: null,
    createdAt: at('2026-10-26T09:56:00Z'),
    prOpenedAt: at('2026-10-26T09:56:00Z'),
    closedAt: at('2026-10-26T10:03:00Z')
  });

  const metrics = dashboardMetrics(
    input({
      workItems: [specced, quick, closed],
      stageChanges: [...speccedChanges, ...quickChanges],
      runs: [
        run({ workItemId: 'a', costUsd: 1 }),
        run({ workItemId: 'a', agent: 'spec', costUsd: 2 }),
        review('a', 'revision_needed', minutesAfter(start, 41)),
        review('a', 'accepted', minutesAfter(start, 45)),
        run({ workItemId: 'b', costUsd: 0.25, createdAt: quick.createdAt }),
        review('b', 'accepted', minutesAfter(quick.createdAt, 25)),
        run({ workItemId: 'c', costUsd: 0.65, createdAt: closed.createdAt }),
        review('c', 'human_decision_needed', minutesAfter(closed.createdAt, 4)),
        run({ workItemId: null, agent: 'security', model: 'sonnet', trigger: 'scheduled', costUsd: 0.18 })
      ],
      questions: [{ workItemId: 'a', askedAt: minutesAfter(start, 5), answeredAt: minutesAfter(start, 9) }]
    })
  );

  it('counts PRs opened, merged and closed unmerged in the range', () => {
    expect(metrics.prs).toEqual({ opened: 3, merged: 2, closedUnmerged: 1 });
    expect(metrics.autonomy).toEqual({ autonomous: 1, merged: 2 });
  });

  it('measures cycle time from delegation to merge, splitting out the human wait', () => {
    // a: 60 min, 20 + 18 at the gates and 4 answering; b: 30 min, 5 at the merge gate.
    expect(metrics.cycle.medianMs).toBe(45 * MINUTE);
    expect(metrics.cycle.medianHumanWaitMs).toBe(((42 + 5) / 2) * MINUTE);
    expect(metrics.cycle.medianFactoryMs).toBe(((18 + 25) / 2) * MINUTE);
    expect(metrics.cycle.waits).toEqual([
      { label: 'Spec review', medianMs: 20 * MINUTE, items: 1 },
      { label: 'Awaiting merge', medianMs: 11.5 * MINUTE, items: 2 },
      { label: 'Answering questions', medianMs: 4 * MINUTE, items: 1 }
    ]);
  });

  it('gives each stage’s median over the PRs that reached it', () => {
    expect(metrics.cycle.stages).toEqual([
      { stage: 'researching', medianMs: 3.5 * MINUTE, items: 2 },
      { stage: 'spec', medianMs: 10 * MINUTE, items: 1 },
      { stage: 'spec_review', medianMs: 20 * MINUTE, items: 1 },
      { stage: 'building', medianMs: 11.5 * MINUTE, items: 2 },
      { stage: 'in_review', medianMs: 3.5 * MINUTE, items: 2 },
      { stage: 'awaiting_merge', medianMs: 11.5 * MINUTE, items: 2 }
    ]);
  });

  it('adds up usage per merged PR by size', () => {
    expect(metrics.bySize.map(({ size, prs, totalCostUsd }) => ({ size, prs, totalCostUsd }))).toEqual([
      { size: 'XS', prs: 1, totalCostUsd: 0.75 },
      { size: 'M', prs: 1, totalCostUsd: 4 }
    ]);
    expect(metrics.bySize[1]?.medianTokens).toBe(4 * 1160);
    expect(metrics.bySize[1]?.medianRunMs).toBe(4 * 2 * MINUTE);
    expect(metrics.medianCostPerPrUsd).toBe(2.375);
  });

  it('lists the most expensive work items, leaving out job runs', () => {
    expect(metrics.expensive.map(({ identifier, runs }) => [identifier, runs])).toEqual([
      ['A', 4],
      ['C', 2],
      ['B', 2]
    ]);
    expect(metrics.expensive[1]?.costUsd).toBeCloseTo(1.15);
  });

  it('breaks runs down by agent, result, model and trigger', () => {
    const agents = metrics.breakdown.find(({ title }) => title === 'Agent')?.rows;
    expect(agents?.map(({ key, runs }) => [key, runs])).toEqual([
      ['review', 4],
      ['implement', 3],
      ['security', 1],
      ['spec', 1]
    ]);
    const [sonnet] = metrics.breakdown.find(({ title }) => title === 'Model')?.rows ?? [];
    expect(sonnet?.key).toBe('sonnet');
    expect(sonnet?.runs).toBe(5);
    expect(sonnet?.costUsd).toBeCloseTo(2.18);
  });

  it('counts first-pass acceptance and revisions over the PRs first reviewed in the range', () => {
    expect(metrics.review).toEqual({ reviewed: 3, firstPass: 1, revisions: 1, mostRevisions: 1 });
  });

  it('counts PRs opened and merged per day in the project’s time zone', () => {
    expect(metrics.daily).toHaveLength(15);
    expect(metrics.daily.at(-2)).toEqual({ day: '2026-10-25', opened: 1, merged: 1 });
    expect(metrics.daily.at(-1)).toEqual({ day: '2026-10-26', opened: 2, merged: 1 });
  });

  it('leaves out work outside the range', () => {
    const later = dashboardMetrics(
      input({
        now: at('2026-11-20T12:00:00Z'),
        days: 7,
        workItems: [specced],
        stageChanges: speccedChanges,
        runs: [run({ workItemId: 'a' })]
      })
    );
    expect(later.prs).toEqual({ opened: 0, merged: 0, closedUnmerged: 0 });
    expect(later.cycle.medianMs).toBeNull();
    expect(later.expensive).toEqual([]);
    expect(later.daily).toHaveLength(8);
  });
});
