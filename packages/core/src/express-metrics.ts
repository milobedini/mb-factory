import { z } from 'zod';

import type { DashboardQuestion, DashboardRun, DashboardStageChange, DashboardWorkItem } from './dashboard';
import { groupBy, median, mergedCycle, within } from './dashboard';
import type { SentryIssue } from './health';
import type { AnswerSource } from './questions';
import { reviewVerdict } from './router';
import type { Track } from './track';

// Express against the baseline (docs/express.md, "Measuring it"): the PRs merged in the dashboard's range on each track,
// beside Phase 4's baseline, on the four measures Phase 5's exit rests on.

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// Phase 4's dashboard data, frozen when it closed: 25 Oct–3 Nov 2026, London days.
export const EXPRESS_BASELINE = {
  from: new Date('2026-10-24T23:00:00Z'),
  to: new Date('2026-11-04T00:00:00Z'),
  label: '25 Oct–3 Nov'
} as const;

// Express became Tastebook's default on 4 Nov 2026; Phase 5 ends after two weeks of it.
export const EXPRESS_START = EXPRESS_BASELINE.to;
export const EXPRESS_DAYS = 14;

export const FIX_WINDOW_DAYS = 7;
export const SENTRY_WINDOW_MINUTES = 30;

// ---- Fixes and reverts within 7 days ----

// A merged PR as its `pull_request` closed webhook, or `gh pr list`, gives it. Its issue is its work item's when it has
// one, since a slice can be built on its parent's branch name, and otherwise read from its branch.
export type MergedPr = {
  repository: string;
  number: number;
  title: string;
  body: string;
  branch: string;
  issue: string | null;
  mergedAt: Date;
};

export const FIX_KINDS = ['revert', 'same_issue', 'named'] as const;

export type FixKind = (typeof FIX_KINDS)[number];

// A later PR that fixed or reverted an earlier one, recorded when the later one merges.
export type Fix = {
  repository: string;
  prNumber: number;
  issue: string | null;
  mergedAt: Date;
  byPrNumber: number;
  byIssue: string | null;
  byMergedAt: Date;
  kind: FixKind;
};

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The Linear issue a PR's branch is for: the factory names branches `<prefix>/<issue>-<slug>` or `<issue>-<slug>`, and
// GitHub's revert branch keeps the original's after `revert-<n>-`.
export const issueOfBranch = (branch: string, teamKey: string): string | null => {
  const match = new RegExp(`(?:^|/)(${escapeRegExp(teamKey)}-\\d+)(?:-|$)`, 'i').exec(branch);
  return match?.[1]?.toUpperCase() ?? null;
};

const mergedPrSchema = z.looseObject({
  repository: z.looseObject({ full_name: z.string().min(1) }),
  pull_request: z.looseObject({
    number: z.int().positive(),
    title: z.string().nullish(),
    body: z.string().nullish(),
    merged: z.boolean().nullish(),
    merged_at: z.iso.datetime({ offset: true }).nullish(),
    head: z.looseObject({ ref: z.string().min(1) })
  })
});

// A `pull_request` webhook's PR, when it was merged, its issue read from its branch.
export const mergedPrFrom = (payload: unknown, teamKey: string): MergedPr | undefined => {
  const parsed = mergedPrSchema.safeParse(payload).data;
  const pr = parsed?.pull_request;
  return parsed && pr?.merged && pr.merged_at
    ? {
        repository: parsed.repository.full_name,
        number: pr.number,
        title: pr.title ?? '',
        body: pr.body ?? '',
        branch: pr.head.ref,
        issue: issueOfBranch(pr.head.ref, teamKey),
        mergedAt: new Date(pr.merged_at)
      }
    : undefined;
};

// The issues a PR names after "fix", "fixes", "regression from" or "broke". "Depends on" and other mentions don't count,
// since slices name their earlier parts.
export const namedFixes = (pr: Pick<MergedPr, 'title' | 'body'>, teamKey: string): string[] => {
  const pattern = new RegExp(`\\b(?:fix|fixes|regression from|broke)[:\\s]+(${escapeRegExp(teamKey)}-\\d+)\\b`, 'gi');
  return [...`${pr.title}\n${pr.body}`.matchAll(pattern)].flatMap(([, issue]) => (issue ? [issue.toUpperCase()] : []));
};

// GitHub's revert PR says "Reverts <owner>/<repo>#<n>".
const revertedNumber = (pr: MergedPr): number | null => {
  const match = new RegExp(`^Reverts ${escapeRegExp(pr.repository)}#(\\d+)`, 'im').exec(pr.body);
  return match?.[1] ? Number(match[1]) : null;
};

// What a PR fixed or reverted among the PRs merged in the 7 days before it: one it reverts, an earlier PR for the same
// issue, or one whose issue it names after "fix", "fixes", "regression from" or "broke".
export const fixesBy = (later: MergedPr, earlier: MergedPr[], teamKey: string): Fix[] => {
  const byIssue = later.issue;
  const reverts = revertedNumber(later);
  const named = namedFixes(later, teamKey);
  const since = later.mergedAt.getTime() - FIX_WINDOW_DAYS * DAY_MS;
  return earlier.flatMap((pr) => {
    if (
      pr.repository !== later.repository ||
      pr.number === later.number ||
      pr.mergedAt.getTime() >= later.mergedAt.getTime() ||
      pr.mergedAt.getTime() < since
    ) {
      return [];
    }
    const { issue } = pr;
    const kind: FixKind | null =
      reverts === pr.number
        ? 'revert'
        : issue && issue === byIssue
          ? 'same_issue'
          : issue && named.includes(issue)
            ? 'named'
            : null;
    return kind
      ? [
          {
            repository: pr.repository,
            prNumber: pr.number,
            issue,
            mergedAt: pr.mergedAt,
            byPrNumber: later.number,
            byIssue,
            byMergedAt: later.mergedAt,
            kind
          }
        ]
      : [];
  });
};

// ---- Taps ----

export type DashboardAnswer = { workItemId: string; runId: string; source: AnswerSource; answeredAt: Date };

// The person's decisions on a merged PR's work item up to its merge: each question answered (a round's "Use the
// defaults" is one tap), a gate approved or sent back, a typed reply that started a run, findings fixed by choice and a
// re-run; then the merge, unless the factory merged it, and a Revert.
export const tapsFor = ({
  item,
  runs,
  answers,
  autoMerged,
  reverted
}: {
  item: DashboardWorkItem;
  runs: DashboardRun[];
  answers: DashboardAnswer[];
  autoMerged: boolean;
  reverted: boolean;
}): number => {
  const until = (item.mergedAt ?? new Date(0)).getTime();
  const before = runs.filter(({ createdAt }) => createdAt.getTime() <= until);
  const byId = new Map(runs.map((run) => [run.id, run]));
  const runTaps = before.filter(({ trigger, agent, parentRunId }) => {
    switch (trigger) {
      case 'spec_approved':
      case 'prompted':
      case 'console':
        return true;
      // Approving a design starts its hand-off run; the implement run after it follows by itself.
      case 'design_approved':
        return agent === 'design';
      // A review asking for a revision starts the fix by itself; any other fix run is findings the person chose.
      case 'review_findings': {
        const review = parentRunId ? byId.get(parentRunId) : undefined;
        return reviewVerdict(review?.report) !== 'revision_needed';
      }
      default:
        return false;
    }
  }).length;
  const answered = answers.filter(({ answeredAt }) => answeredAt.getTime() <= until);
  const chosen = answered.filter(({ source }) => source !== 'default').length;
  const defaultRounds = new Set(answered.filter(({ source }) => source === 'default').map(({ runId }) => runId)).size;
  return runTaps + chosen + defaultRounds + (autoMerged ? 0 : 1) + (reverted ? 1 : 0);
};

// ---- The comparison ----

export type ExpressInput = {
  now: Date;
  days: number;
  workItems: DashboardWorkItem[];
  stageChanges: DashboardStageChange[];
  runs: DashboardRun[];
  questions: DashboardQuestion[];
  answers: DashboardAnswer[];
  // Work items whose PR the factory merged (a watch was started), and those reverted from the watch.
  autoMerged: Set<string>;
  reverted: Set<string>;
  fixes: Fix[];
  // Each factory project's Sentry issues first seen since the baseline began; null for a project that couldn't be read,
  // absent for one that doesn't report to Sentry.
  sentry: Map<string, SentryIssue[] | null>;
};

export type FixedPr = {
  repository: string;
  identifier: string;
  title: string | null;
  url: string;
  mergedAt: Date;
  autoMerged: boolean;
  fixes: Pick<Fix, 'byPrNumber' | 'byMergedAt' | 'kind'>[];
};

export type ExpressColumn = {
  key: 'baseline' | Track;
  prs: number;
  medianCycleMs: number | null;
  medianHumanWaitMs: number | null;
  medianTaps: number | null;
  mergedByItself: number;
  fixed: FixedPr[];
  // Null when a project's Sentry couldn't be read, so nothing is claimed.
  sentryIssues: number | null;
};

// Cycle time and taps must come down; fixes and Sentry issues must be no worse. Null until both sides have PRs.
export type ExpressVerdict = 'down' | 'not_down' | 'no_worse' | 'worse' | null;

export type ExpressComparison = {
  baseline: ExpressColumn;
  express: ExpressColumn;
  careful: ExpressColumn;
  verdicts: { cycle: ExpressVerdict; taps: ExpressVerdict; fixes: ExpressVerdict; sentry: ExpressVerdict };
  // Days of express so far, of the two weeks Phase 5 needs.
  expressDays: number;
};

const prKey = (repository: string, number: number): string => `${repository}#${number}`;

const issuesAfterMerge = (issues: SentryIssue[], mergedAt: Date): number =>
  issues.filter(({ firstSeen }) => {
    const after = firstSeen.getTime() - mergedAt.getTime();
    return after >= 0 && after <= SENTRY_WINDOW_MINUTES * MINUTE_MS;
  }).length;

const column = (key: ExpressColumn['key'], items: DashboardWorkItem[], input: ExpressInput): ExpressColumn => {
  const changesFor = groupBy(input.stageChanges, ({ workItemId }) => workItemId);
  const runsFor = groupBy(input.runs, ({ workItemId }) => workItemId ?? '');
  const questionsFor = groupBy(input.questions, ({ workItemId }) => workItemId);
  const answersFor = groupBy(input.answers, ({ workItemId }) => workItemId);
  const fixesOf = groupBy(input.fixes, ({ repository, prNumber }) => prKey(repository, prNumber));
  const cycles = items.map((item) =>
    mergedCycle(item, changesFor.get(item.id) ?? [], runsFor.get(item.id) ?? [], questionsFor.get(item.id) ?? [])
  );
  const sentryCounts = items.map((item) => {
    const issues = input.sentry.get(item.project);
    return issues === undefined
      ? 0
      : issues === null || !item.mergedAt
        ? null
        : issuesAfterMerge(issues, item.mergedAt);
  });
  return {
    key,
    prs: items.length,
    medianCycleMs: median(cycles.map(({ cycleMs }) => cycleMs)),
    medianHumanWaitMs: median(cycles.map(({ humanWaitMs }) => humanWaitMs)),
    medianTaps: median(
      items.map((item) =>
        tapsFor({
          item,
          runs: runsFor.get(item.id) ?? [],
          answers: answersFor.get(item.id) ?? [],
          autoMerged: input.autoMerged.has(item.id),
          reverted: input.reverted.has(item.id)
        })
      )
    ),
    mergedByItself: items.filter(({ id }) => input.autoMerged.has(id)).length,
    fixed: items.flatMap((item) => {
      const fixes = item.prNumber === null ? [] : (fixesOf.get(prKey(item.repository, item.prNumber)) ?? []);
      return fixes.length > 0 && item.mergedAt
        ? [
            {
              repository: item.repository,
              identifier: item.identifier,
              title: item.title,
              url: item.url,
              mergedAt: item.mergedAt,
              autoMerged: input.autoMerged.has(item.id),
              fixes: fixes
                .toSorted((a, b) => a.byMergedAt.getTime() - b.byMergedAt.getTime())
                .map(({ byPrNumber, byMergedAt, kind }) => ({ byPrNumber, byMergedAt, kind }))
            }
          ]
        : [];
    }),
    sentryIssues: sentryCounts.includes(null)
      ? null
      : sentryCounts.reduce<number>((total, count) => total + (count ?? 0), 0)
  };
};

const lower = (now: number | null, then: number | null): ExpressVerdict =>
  now === null || then === null ? null : now < then ? 'down' : 'not_down';

// No worse: a rate per merged PR at most the baseline's.
const noWorse = (count: number | null, prs: number, baseCount: number | null, basePrs: number): ExpressVerdict =>
  count === null || baseCount === null || prs === 0 || basePrs === 0
    ? null
    : count / prs <= baseCount / basePrs
      ? 'no_worse'
      : 'worse';

export const expressAgainstBaseline = (input: ExpressInput): ExpressComparison => {
  const from = new Date(input.now.getTime() - input.days * DAY_MS);
  const merged = input.workItems.filter(({ mergedAt }) => mergedAt !== null);
  const onTrack = (track: Track): DashboardWorkItem[] =>
    merged.filter((item) => item.track === track && within(item.mergedAt, from, input.now));
  const baseline = column(
    'baseline',
    merged.filter(
      ({ mergedAt }) =>
        mergedAt !== null &&
        mergedAt.getTime() >= EXPRESS_BASELINE.from.getTime() &&
        mergedAt.getTime() < EXPRESS_BASELINE.to.getTime()
    ),
    input
  );
  const express = column('express', onTrack('express'), input);
  const careful = column('careful', onTrack('careful'), input);
  const elapsed = Math.floor((input.now.getTime() - EXPRESS_START.getTime()) / DAY_MS) + 1;
  return {
    baseline,
    express,
    careful,
    verdicts: {
      cycle: lower(express.medianCycleMs, baseline.medianCycleMs),
      taps: lower(express.medianTaps, baseline.medianTaps),
      fixes: noWorse(express.fixed.length, express.prs, baseline.fixed.length, baseline.prs),
      sentry: noWorse(express.sentryIssues, express.prs, baseline.sentryIssues, baseline.prs)
    },
    expressDays: Math.min(Math.max(elapsed, 0), EXPRESS_DAYS)
  };
};
