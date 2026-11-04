import { describe, expect, it } from 'vitest';

import type { DashboardRun, DashboardWorkItem } from './dashboard';
import type { DashboardAnswer, ExpressInput, MergedPr } from './express-metrics';
import {
  EXPRESS_BASELINE,
  expressAgainstBaseline,
  fixesBy,
  issueOfBranch,
  mergedPrFrom,
  namedFixes,
  tapsFor
} from './express-metrics';

const REPO = 'milobedini/tastebook';
const HOUR = 60 * 60 * 1000;
const at = (iso: string): Date => new Date(iso);
const hoursAfter = (start: Date, hours: number): Date => new Date(start.getTime() + hours * HOUR);

const pr = (overrides: Partial<MergedPr> & Pick<MergedPr, 'number'>): MergedPr => ({
  repository: REPO,
  title: `PR ${overrides.number}`,
  body: '',
  branch: `tastebook/tas-${overrides.number}-a-change`,
  issue: `TAS-${overrides.number}`,
  mergedAt: at('2026-11-04T10:00:00Z'),
  ...overrides
});

const workItem = (overrides: Partial<DashboardWorkItem> & Pick<DashboardWorkItem, 'id'>): DashboardWorkItem => ({
  project: 'tastebook',
  repository: REPO,
  prNumber: null,
  identifier: overrides.id.toUpperCase(),
  title: `Work on ${overrides.id}`,
  url: `https://linear.app/tastebook/issue/${overrides.id}`,
  origin: 'linear',
  estimate: 2,
  humanPushes: 0,
  track: null,
  createdAt: at('2026-11-04T08:00:00Z'),
  prOpenedAt: null,
  mergedAt: null,
  closedAt: null,
  ...overrides
});

const run = (overrides: Partial<DashboardRun> = {}): DashboardRun => ({
  id: 'run',
  parentRunId: null,
  workItemId: 'a',
  agent: 'implement',
  model: 'opus',
  trigger: 'delegated',
  status: 'finished',
  outcome: 'done',
  report: null,
  costUsd: 0.5,
  inputTokens: null,
  outputTokens: null,
  cacheReadInputTokens: null,
  cacheCreationInputTokens: null,
  createdAt: at('2026-11-04T08:05:00Z'),
  startedAt: null,
  finishedAt: null,
  ...overrides
});

const answer = (overrides: Partial<DashboardAnswer> = {}): DashboardAnswer => ({
  workItemId: 'a',
  runId: 'asking',
  source: 'option',
  answeredAt: at('2026-11-04T08:30:00Z'),
  ...overrides
});

describe('issueOfBranch', () => {
  it('reads the issue from a factory branch, with or without a prefix', () => {
    expect(issueOfBranch('tastebook/tas-135-add-a-privacy-page', 'TAS')).toBe('TAS-135');
    expect(issueOfBranch('TAS-20-convert-volume', 'TAS')).toBe('TAS-20');
  });

  it("reads the original's issue from GitHub's revert branch", () => {
    expect(issueOfBranch('revert-128-tastebook/tas-135-add-a-privacy-page', 'TAS')).toBe('TAS-135');
  });

  it('finds no issue in branches without one', () => {
    expect(issueOfBranch('dependabot/npm_and_yarn/puppeteer-core-25.16.0', 'TAS')).toBeNull();
    expect(issueOfBranch('fix-dino-bundle-navlink', 'TAS')).toBeNull();
    expect(issueOfBranch('tastebook/tas-1350', 'TAS')).toBe('TAS-1350');
  });
});

describe('namedFixes', () => {
  it('takes issues named after fix, fixes, regression from and broke', () => {
    expect(
      namedFixes(
        { title: 'Fix TAS-1 and the regression from TAS-2', body: 'Fixes: TAS-3\nThis broke tas-4 too.' },
        'TAS'
      )
    ).toEqual(['TAS-1', 'TAS-2', 'TAS-3', 'TAS-4']);
  });

  it('ignores other mentions, as slices name their earlier parts', () => {
    expect(namedFixes({ title: 'Part 2', body: 'Depends on TAS-151. Follows TAS-114.' }, 'TAS')).toEqual([]);
  });
});

describe('fixesBy', () => {
  const earlier = pr({ number: 128, branch: 'tastebook/tas-135-add-a-privacy-page', issue: 'TAS-135' });

  it('records a revert by its "Reverts" line', () => {
    const revert = pr({
      number: 131,
      branch: 'revert-128-tastebook/tas-135-add-a-privacy-page',
      issue: 'TAS-135',
      body: `Reverts ${REPO}#128`,
      mergedAt: hoursAfter(earlier.mergedAt, 2)
    });
    expect(fixesBy(revert, [earlier], 'TAS')).toEqual([
      {
        repository: REPO,
        prNumber: 128,
        issue: 'TAS-135',
        mergedAt: earlier.mergedAt,
        byPrNumber: 131,
        byIssue: 'TAS-135',
        byMergedAt: revert.mergedAt,
        kind: 'revert'
      }
    ]);
  });

  it('records a second PR for the same issue', () => {
    const second = pr({ number: 132, issue: 'TAS-135', mergedAt: hoursAfter(earlier.mergedAt, 30) });
    expect(fixesBy(second, [earlier], 'TAS').map(({ kind }) => kind)).toEqual(['same_issue']);
  });

  it('records a PR naming the earlier issue after "fixes"', () => {
    const named = pr({ number: 134, body: 'Fixes TAS-135: the link 404s.', mergedAt: hoursAfter(earlier.mergedAt, 5) });
    expect(fixesBy(named, [earlier], 'TAS').map(({ kind }) => kind)).toEqual(['named']);
  });

  it('looks only at PRs in the same repository merged in the 7 days before', () => {
    const named = pr({ number: 140, body: 'Fixes TAS-135', mergedAt: hoursAfter(earlier.mergedAt, 7 * 24 + 1) });
    expect(fixesBy(named, [earlier], 'TAS')).toEqual([]);
    const elsewhere = pr({ number: 141, body: 'Fixes TAS-135', mergedAt: hoursAfter(earlier.mergedAt, 1) });
    expect(fixesBy(elsewhere, [{ ...earlier, repository: 'someone/else' }], 'TAS')).toEqual([]);
    expect(fixesBy(earlier, [{ ...elsewhere, branch: earlier.branch }], 'TAS')).toEqual([]);
  });

  it("takes a slice built on its parent's branch name as its own issue", () => {
    const slice = pr({
      number: 133,
      branch: earlier.branch,
      issue: 'TAS-136',
      mergedAt: hoursAfter(earlier.mergedAt, 1)
    });
    expect(fixesBy(slice, [earlier], 'TAS')).toEqual([]);
  });

  it('records nothing for an unrelated PR', () => {
    const other = pr({ number: 150, body: 'Depends on TAS-135', mergedAt: hoursAfter(earlier.mergedAt, 1) });
    expect(fixesBy(other, [earlier], 'TAS')).toEqual([]);
  });
});

describe('mergedPrFrom', () => {
  const payload = (merged: boolean) => ({
    action: 'closed',
    repository: { full_name: REPO },
    pull_request: {
      number: 128,
      title: 'Add a privacy page',
      body: null,
      merged,
      merged_at: merged ? '2026-11-04T09:14:46Z' : null,
      head: { ref: 'tastebook/tas-135-add-a-privacy-page' }
    }
  });

  it('reads a merged PR', () => {
    expect(mergedPrFrom(payload(true), 'TAS')).toEqual({
      repository: REPO,
      number: 128,
      title: 'Add a privacy page',
      body: '',
      branch: 'tastebook/tas-135-add-a-privacy-page',
      issue: 'TAS-135',
      mergedAt: at('2026-11-04T09:14:46Z')
    });
  });

  it('ignores a PR closed without merging', () => {
    expect(mergedPrFrom(payload(false), 'TAS')).toBeUndefined();
  });
});

describe('tapsFor', () => {
  const merged = workItem({ id: 'a', mergedAt: at('2026-11-04T12:00:00Z') });

  it('counts a merge by the person, and nothing for one the factory made', () => {
    expect(tapsFor({ item: merged, runs: [run()], answers: [], autoMerged: false, reverted: false })).toBe(1);
    expect(tapsFor({ item: merged, runs: [run()], answers: [], autoMerged: true, reverted: false })).toBe(0);
  });

  it('counts each answer, and a round answered with the defaults once', () => {
    const answers = [
      answer(),
      answer({ source: 'text' }),
      answer({ runId: 'later', source: 'default' }),
      answer({ runId: 'later', source: 'default' })
    ];
    expect(tapsFor({ item: merged, runs: [], answers, autoMerged: true, reverted: false })).toBe(3);
  });

  it('counts gates, replies and re-runs, but not the runs that follow by themselves', () => {
    const runs = [
      run({ trigger: 'spec_approved', agent: 'design' }),
      run({ trigger: 'design_approved', agent: 'design' }),
      run({ trigger: 'design_approved', agent: 'implement' }),
      run({ trigger: 'prompted' }),
      run({ trigger: 'console' }),
      run({ trigger: 'answered' }),
      run({ trigger: 'delivered', agent: 'review' })
    ];
    expect(tapsFor({ item: merged, runs, answers: [], autoMerged: true, reverted: false })).toBe(4);
  });

  it('counts findings the person chose to fix, not a revision review asked for', () => {
    const runs = [
      run({ id: 'asked', agent: 'review', report: { verdict: 'revision_needed', findings: [] } }),
      run({ id: 'fix-1', trigger: 'review_findings', parentRunId: 'asked' }),
      run({ id: 'accepted', agent: 'review', report: { verdict: 'accepted', findings: [] } }),
      run({ id: 'fix-2', trigger: 'review_findings', parentRunId: 'accepted' })
    ];
    expect(tapsFor({ item: merged, runs, answers: [], autoMerged: true, reverted: false })).toBe(1);
  });

  it('counts a Revert, and nothing after the merge besides', () => {
    const late = at('2026-11-04T13:00:00Z');
    expect(
      tapsFor({
        item: merged,
        runs: [run({ trigger: 'prompted', createdAt: late })],
        answers: [answer({ answeredAt: late })],
        autoMerged: true,
        reverted: true
      })
    ).toBe(1);
  });
});

describe('expressAgainstBaseline', () => {
  const now = at('2026-11-06T12:00:00Z');
  const base = (id: string, mergedAt: string, prNumber: number) =>
    workItem({ id, prNumber, createdAt: at('2026-10-30T08:00:00Z'), mergedAt: at(mergedAt) });
  const input = (overrides: Partial<ExpressInput> = {}): ExpressInput => ({
    now,
    days: 14,
    workItems: [
      base('b1', '2026-10-30T12:00:00Z', 90),
      base('b2', '2026-10-31T12:00:00Z', 91),
      workItem({
        id: 'e1',
        track: 'express',
        prNumber: 128,
        createdAt: at('2026-11-05T08:00:00Z'),
        mergedAt: at('2026-11-05T09:00:00Z')
      }),
      workItem({
        id: 'c1',
        track: 'careful',
        prNumber: 129,
        createdAt: at('2026-11-05T08:00:00Z'),
        mergedAt: at('2026-11-05T20:00:00Z')
      }),
      // Before express, outside the baseline: in neither.
      base('old', '2026-10-20T12:00:00Z', 50),
      workItem({ id: 'open', track: 'express' })
    ],
    stageChanges: [],
    runs: [],
    questions: [],
    answers: [],
    autoMerged: new Set(['e1']),
    reverted: new Set(),
    fixes: [
      {
        repository: REPO,
        prNumber: 90,
        issue: 'B1',
        mergedAt: at('2026-10-30T12:00:00Z'),
        byPrNumber: 92,
        byIssue: null,
        byMergedAt: at('2026-10-31T09:00:00Z'),
        kind: 'named'
      }
    ],
    sentry: new Map([
      [
        'tastebook',
        [
          {
            project: 'sentry-gray-fountain',
            shortId: 'TASTEBOOK-1',
            title: 'TypeError',
            count: 3,
            firstSeen: at('2026-10-30T12:10:00Z'),
            url: 'https://sentry.io/1'
          }
        ]
      ]
    ]),
    ...overrides
  });

  it('compares the baseline with each track in the range', () => {
    const { baseline, express, careful, verdicts, expressDays } = expressAgainstBaseline(input());
    expect(baseline).toMatchObject({
      prs: 2,
      medianCycleMs: 16 * HOUR,
      medianTaps: 1,
      mergedByItself: 0,
      sentryIssues: 1
    });
    expect(baseline.fixed).toEqual([
      expect.objectContaining({ identifier: 'B1', fixes: [expect.objectContaining({ byPrNumber: 92, kind: 'named' })] })
    ]);
    expect(express).toMatchObject({ prs: 1, medianCycleMs: HOUR, medianTaps: 0, mergedByItself: 1, sentryIssues: 0 });
    expect(careful).toMatchObject({ prs: 1, medianCycleMs: 12 * HOUR, medianTaps: 1, fixed: [] });
    expect(verdicts).toEqual({ cycle: 'down', taps: 'down', fixes: 'no_worse', sentry: 'no_worse' });
    expect(expressDays).toBe(3);
  });

  it('claims nothing about Sentry when it could not be read, nor before express has PRs', () => {
    const unread = expressAgainstBaseline(input({ sentry: new Map([['tastebook', null]]) }));
    expect(unread.baseline.sentryIssues).toBeNull();
    expect(unread.verdicts.sentry).toBeNull();
    const none = expressAgainstBaseline(input({ now: EXPRESS_BASELINE.to, days: 7 }));
    expect(none.express.prs).toBe(0);
    expect(none.verdicts).toEqual({ cycle: null, taps: null, fixes: null, sentry: null });
    expect(none.expressDays).toBe(1);
  });
});
