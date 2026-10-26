import { reviewVerdict } from './router';
import type { RunOutcome, RunStatus, RunTrigger, WorkOrigin } from './runs';
import type { AgentRole, Stage } from './stages';
import { HUMAN_GATES, STAGES, TERMINAL_STAGES } from './stages';

const DAY_MS = 24 * 60 * 60 * 1000;

export const DASHBOARD_RANGES = [7, 14, 30] as const;

export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export const DEFAULT_DASHBOARD_RANGE: DashboardRange = 14;

export const readDashboardRange = (value: unknown): DashboardRange =>
  DASHBOARD_RANGES.find((days) => String(days) === value) ?? DEFAULT_DASHBOARD_RANGE;

// Linear's T-shirt estimates as stored (1, 2, 3, 5, 8); an issue triage never sized is `unsized`.
const SIZES: Record<number, string> = { 1: 'XS', 2: 'S', 3: 'M', 5: 'L', 8: 'XL' };
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'unsized'];

export const sizeLabel = (estimate: number | null): string => (estimate !== null && SIZES[estimate]) || 'unsized';

export type DashboardWorkItem = {
  id: string;
  identifier: string;
  title: string | null;
  url: string;
  origin: WorkOrigin;
  estimate: number | null;
  humanPushes: number;
  createdAt: Date;
  // From the PR's webhooks; a PR closed unmerged has `closedAt` and no `mergedAt`.
  prOpenedAt: Date | null;
  mergedAt: Date | null;
  closedAt: Date | null;
};

export type DashboardStageChange = { workItemId: string; stage: Stage; at: Date };

export type DashboardRun = {
  // Empty for a scheduled job's run.
  workItemId: string | null;
  agent: AgentRole;
  model: string;
  trigger: RunTrigger;
  status: RunStatus;
  outcome: RunOutcome | null;
  report: unknown;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadInputTokens: number | null;
  cacheCreationInputTokens: number | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
};

export type DashboardQuestion = { workItemId: string; askedAt: Date; answeredAt: Date | null };

export type DashboardInput = {
  now: Date;
  days: DashboardRange;
  timeZone: string;
  workItems: DashboardWorkItem[];
  stageChanges: DashboardStageChange[];
  // Every run of the work items, and the job runs in the range.
  runs: DashboardRun[];
  questions: DashboardQuestion[];
};

export type StageMedian = { stage: Stage; medianMs: number; items: number };

export type BreakdownRow = { key: string; runs: number; costUsd: number | null };

export type SizeRow = {
  size: string;
  prs: number;
  medianCostUsd: number | null;
  totalCostUsd: number | null;
  medianTokens: number | null;
  medianRunMs: number | null;
};

export type ExpensiveItem = {
  identifier: string;
  title: string | null;
  url: string;
  origin: WorkOrigin;
  runs: number;
  costUsd: number;
};

export type Dashboard = {
  from: Date;
  to: Date;
  prs: { opened: number; merged: number; closedUnmerged: number };
  autonomy: { autonomous: number; merged: number };
  medianCostPerPrUsd: number | null;
  // Over the PRs merged in the range: delegation to merge, split into time at the gates and waiting on answers
  // (the human's) and the rest (the factory's).
  cycle: {
    medianMs: number | null;
    medianHumanWaitMs: number | null;
    medianFactoryMs: number | null;
    stages: StageMedian[];
    // Medians over the PRs that spent any time there.
    waits: { label: string; medianMs: number; items: number }[];
  };
  daily: { day: string; opened: number; merged: number }[];
  breakdown: { title: string; rows: BreakdownRow[] }[];
  bySize: SizeRow[];
  expensive: ExpensiveItem[];
  // Over the PRs whose first review ran in the range.
  review: { reviewed: number; firstPass: number; revisions: number; mostRevisions: number };
};

const EXPENSIVE_LIMIT = 5;

export const median = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? null) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};

const groupBy = <T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> =>
  items.reduce(
    (groups, item) => groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]),
    new Map<string, T[]>()
  );

const sumOrNull = (values: (number | null)[]): number | null => {
  const known = values.filter((value) => value !== null);
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null;
};

const within = (at: Date | null, from: Date, to: Date): at is Date =>
  at !== null && at.getTime() >= from.getTime() && at.getTime() <= to.getTime();

const runTokens = (run: DashboardRun): number | null =>
  sumOrNull([run.inputTokens, run.outputTokens, run.cacheReadInputTokens, run.cacheCreationInputTokens]);

const runMs = ({ startedAt, finishedAt }: DashboardRun): number | null =>
  startedAt && finishedAt ? finishedAt.getTime() - startedAt.getTime() : null;

// Time in each stage from the work item's stage changes, up to the merge; the last stage runs until `end`.
export const timeInStages = (changes: DashboardStageChange[], end: Date): Map<Stage, number> => {
  const ordered = changes
    .filter(({ at }) => at.getTime() <= end.getTime())
    .toSorted((a, b) => a.at.getTime() - b.at.getTime());
  return ordered.reduce((totals, { stage, at }, index) => {
    const until = ordered[index + 1]?.at ?? end;
    return totals.set(stage, (totals.get(stage) ?? 0) + until.getTime() - at.getTime());
  }, new Map<Stage, number>());
};

// Waiting on answers: each question from when it was asked until it was answered, within the work item's life.
const questionWaitMs = (questions: DashboardQuestion[], start: Date, end: Date): number =>
  questions.reduce((total, { askedAt, answeredAt }) => {
    const from = Math.max(askedAt.getTime(), start.getTime());
    const until = Math.min((answeredAt ?? end).getTime(), end.getTime());
    return total + Math.max(until - from, 0);
  }, 0);

const dayKey = (at: Date, timeZone: string): string => at.toLocaleDateString('en-CA', { timeZone });

// Every calendar day the range touches, in the project's time zone.
const daysBetween = (from: Date, to: Date, timeZone: string): string[] => {
  const steps = Math.ceil((to.getTime() - from.getTime()) / (DAY_MS / 2));
  const keys = Array.from({ length: steps + 1 }, (_, step) =>
    dayKey(new Date(Math.min(from.getTime() + (step * DAY_MS) / 2, to.getTime())), timeZone)
  );
  return [...new Set(keys)];
};

const breakdown = (runs: DashboardRun[], keyOf: (run: DashboardRun) => string): BreakdownRow[] => {
  const groups = groupBy(runs, keyOf);
  return [...groups.entries()]
    .map(([key, grouped]) => ({ key, runs: grouped.length, costUsd: sumOrNull(grouped.map(({ costUsd }) => costUsd)) }))
    .toSorted((a, b) => b.runs - a.runs || a.key.localeCompare(b.key));
};

const resultOf = ({ status, outcome }: DashboardRun): string =>
  status === 'finished' ? (outcome ?? 'finished') : status;

const reviewStats = (runs: DashboardRun[], from: Date, to: Date): Dashboard['review'] => {
  const reviews = runs.filter(
    (run) => run.agent === 'review' && run.workItemId !== null && run.status === 'finished' && run.report !== null
  );
  const byItem = [...groupBy(reviews, ({ workItemId }) => workItemId ?? '').values()]
    .map((itemReviews) => itemReviews.toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime()))
    .filter(([first]) => within(first?.createdAt ?? null, from, to));
  const revisionCounts = byItem.map(
    (itemReviews) => itemReviews.filter(({ report }) => reviewVerdict(report) === 'revision_needed').length
  );
  return {
    reviewed: byItem.length,
    firstPass: byItem.filter(([first]) => reviewVerdict(first?.report) === 'accepted').length,
    revisions: revisionCounts.reduce((sum, count) => sum + count, 0),
    mostRevisions: Math.max(0, ...revisionCounts)
  };
};

const WAITS: { label: string; stage?: Stage }[] = [
  { label: 'Spec review', stage: 'spec_review' },
  { label: 'Awaiting merge', stage: 'awaiting_merge' },
  { label: 'Answering questions' }
];

export const dashboardMetrics = ({
  now,
  days,
  timeZone,
  workItems,
  stageChanges,
  runs,
  questions
}: DashboardInput): Dashboard => {
  const from = new Date(now.getTime() - days * DAY_MS);
  const to = now;
  const changesFor = groupBy(stageChanges, ({ workItemId }) => workItemId);
  const runsFor = groupBy(
    runs.filter(({ workItemId }) => workItemId !== null),
    ({ workItemId }) => workItemId ?? ''
  );
  const questionsFor = groupBy(questions, ({ workItemId }) => workItemId);

  const merged = workItems
    .filter(({ mergedAt }) => within(mergedAt, from, to))
    .map((item) => {
      const mergedAt = item.mergedAt ?? to;
      const stages = timeInStages(changesFor.get(item.id) ?? [], mergedAt);
      const gateMs = HUMAN_GATES.reduce((total, stage) => total + (stages.get(stage) ?? 0), 0);
      const answeringMs = questionWaitMs(questionsFor.get(item.id) ?? [], item.createdAt, mergedAt);
      const cycleMs = mergedAt.getTime() - item.createdAt.getTime();
      const itemRuns = runsFor.get(item.id) ?? [];
      return {
        item,
        stages,
        answeringMs,
        cycleMs,
        humanWaitMs: Math.min(gateMs + answeringMs, cycleMs),
        costUsd: sumOrNull(itemRuns.map(({ costUsd }) => costUsd)),
        tokens: sumOrNull(itemRuns.map(runTokens)),
        runMs: sumOrNull(itemRuns.map(runMs))
      };
    });

  const stageMedians = STAGES.filter((stage) => !TERMINAL_STAGES.includes(stage)).flatMap((stage) => {
    const spent = merged.flatMap(({ stages }) => (stages.has(stage) ? [stages.get(stage) ?? 0] : []));
    const medianMs = median(spent);
    return medianMs === null ? [] : [{ stage, medianMs, items: spent.length }];
  });

  const waits = WAITS.flatMap(({ label, stage }) => {
    const spent = merged
      .map(({ stages, answeringMs }) => (stage ? (stages.get(stage) ?? 0) : answeringMs))
      .filter((ms) => ms > 0);
    const medianMs = median(spent);
    return medianMs === null ? [] : [{ label, medianMs, items: spent.length }];
  });

  const rangeRuns = runs.filter(({ createdAt }) => within(createdAt, from, to));
  const itemsById = new Map(workItems.map((item) => [item.id, item]));

  const expensive = [...groupBy(rangeRuns, ({ workItemId }) => workItemId ?? '').entries()]
    .flatMap(([id, itemRuns]) => {
      const item = itemsById.get(id);
      const costUsd = sumOrNull(itemRuns.map((run) => run.costUsd));
      return item && costUsd !== null
        ? [
            {
              identifier: item.identifier,
              title: item.title,
              url: item.url,
              origin: item.origin,
              runs: itemRuns.length,
              costUsd
            }
          ]
        : [];
    })
    .toSorted((a, b) => b.costUsd - a.costUsd)
    .slice(0, EXPENSIVE_LIMIT);

  const sized = groupBy(merged, ({ item }) => sizeLabel(item.estimate));
  const bySize = SIZE_ORDER.flatMap((size) => {
    const prs = sized.get(size) ?? [];
    const known = <T>(values: (T | null)[]): T[] => values.filter((value) => value !== null);
    return prs.length === 0
      ? []
      : [
          {
            size,
            prs: prs.length,
            medianCostUsd: median(known(prs.map(({ costUsd }) => costUsd))),
            totalCostUsd: sumOrNull(prs.map(({ costUsd }) => costUsd)),
            medianTokens: median(known(prs.map(({ tokens }) => tokens))),
            medianRunMs: median(known(prs.map(({ runMs: ms }) => ms)))
          }
        ];
  });

  return {
    from,
    to,
    prs: {
      opened: workItems.filter(({ prOpenedAt }) => within(prOpenedAt, from, to)).length,
      merged: merged.length,
      closedUnmerged: workItems.filter(({ mergedAt, closedAt }) => mergedAt === null && within(closedAt, from, to))
        .length
    },
    autonomy: { autonomous: merged.filter(({ item }) => item.humanPushes === 0).length, merged: merged.length },
    medianCostPerPrUsd: median(merged.flatMap(({ costUsd }) => (costUsd === null ? [] : [costUsd]))),
    cycle: {
      medianMs: median(merged.map(({ cycleMs }) => cycleMs)),
      medianHumanWaitMs: median(merged.map(({ humanWaitMs }) => humanWaitMs)),
      medianFactoryMs: median(merged.map(({ cycleMs, humanWaitMs }) => cycleMs - humanWaitMs)),
      stages: stageMedians,
      waits
    },
    daily: daysBetween(from, to, timeZone).map((day) => ({
      day,
      opened: workItems.filter(({ prOpenedAt }) => within(prOpenedAt, from, to) && dayKey(prOpenedAt, timeZone) === day)
        .length,
      merged: merged.filter(({ item }) => item.mergedAt !== null && dayKey(item.mergedAt, timeZone) === day).length
    })),
    breakdown: [
      { title: 'Agent', rows: breakdown(rangeRuns, ({ agent }) => agent) },
      { title: 'Result', rows: breakdown(rangeRuns, resultOf) },
      { title: 'Model', rows: breakdown(rangeRuns, ({ model }) => model) },
      { title: 'Trigger', rows: breakdown(rangeRuns, ({ trigger }) => trigger) }
    ],
    bySize,
    expensive,
    review: reviewStats(runs, from, to)
  };
};
