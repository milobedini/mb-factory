import { describe, expect, it } from 'vitest';

import type { HealthInput } from './health';
import { formatMinutes, healthReport, healthText, problemHour } from './health';

const london = 'Europe/London';
const now = new Date('2026-10-27T07:00:10Z');
const since = new Date('2026-10-26T07:00:05Z');

const input = (overrides: Partial<HealthInput> = {}): HealthInput => ({
  now,
  since,
  timeZone: london,
  problems: [],
  knownMessages: [],
  openRuns: [],
  heldRuns: [],
  jobs: [],
  slots: [],
  scheduledRuns: [],
  sentryIssues: [],
  ...overrides
});

const minutesBefore = (minutes: number): Date => new Date(now.getTime() - minutes * 60 * 1000);

describe('problemHour', () => {
  it('counts a line under the start of its hour', () => {
    expect(problemHour(new Date('2026-10-27T14:59:59.999Z'))).toEqual(new Date('2026-10-27T14:00:00Z'));
    expect(problemHour(new Date('2026-10-27T15:00:00Z'))).toEqual(new Date('2026-10-27T15:00:00Z'));
  });
});

describe('formatMinutes', () => {
  it('reads as minutes, hours, or both', () => {
    expect(formatMinutes(40)).toBe('40 min');
    expect(formatMinutes(120)).toBe('2 h');
    expect(formatMinutes(125)).toBe('2 h 5 min');
  });
});

describe('healthReport', () => {
  it('lists errors and warnings apart, most frequent first, marking messages not seen before', () => {
    const report = healthReport(
      input({
        knownMessages: ['governor decided on stale usage readings'],
        problems: [
          {
            level: 'warn',
            message: 'governor decided on stale usage readings',
            count: 2,
            lastAt: new Date('2026-10-26T14:02:00Z'),
            fields: {}
          },
          {
            level: 'warn',
            message: 'work item left awaiting merge without a merge',
            count: 5,
            lastAt: new Date('2026-10-26T15:30:00Z'),
            fields: { issue: 'TAS-19', to: 'in_review' }
          },
          {
            level: 'error',
            message: 'run dispatch failed',
            count: 1,
            lastAt: new Date('2026-10-26T16:00:00Z'),
            fields: { error: 'GitHub said <no>\n  twice' }
          }
        ]
      })
    );
    expect(report.errors).toEqual(['1× run dispatch failed (new), last at 16:00: GitHub said &lt;no&gt; twice']);
    expect(report.warnings).toEqual([
      '5× work item left awaiting merge without a merge (new), last at 15:30: TAS-19',
      '2× governor decided on stale usage readings, last at 14:02'
    ]);
  });

  it('clips a long error', () => {
    const [line] = healthReport(
      input({
        problems: [{ level: 'error', message: 'x', count: 1, lastAt: now, fields: { error: 'e'.repeat(500) } }]
      })
    ).errors;
    expect(line?.endsWith('…')).toBe(true);
    expect(line?.length).toBeLessThan(200);
  });

  it('flags runs dispatched but never started, running past the timeout, or queued with no hold', () => {
    const run = { agent: 'implement', createdAt: minutesBefore(120), dispatchedAt: null, startedAt: null, held: false };
    const report = healthReport(
      input({
        openRuns: [
          { ...run, label: 'TAS-1', status: 'dispatched', dispatchedAt: minutesBefore(40) },
          { ...run, label: 'TAS-2', status: 'dispatched', dispatchedAt: minutesBefore(5) },
          { ...run, label: 'TAS-3', status: 'running', startedAt: minutesBefore(75) },
          { ...run, label: 'TAS-4', status: 'running', startedAt: minutesBefore(30) },
          { ...run, label: 'TAS-5', status: 'queued' },
          { ...run, label: 'TAS-6', status: 'queued', held: true },
          { ...run, label: 'security', agent: 'security', status: 'queued', createdAt: minutesBefore(3) }
        ]
      })
    );
    expect(report.runs).toEqual([
      'TAS-1 implement run was dispatched 40 min ago and never started',
      'TAS-3 implement run has been running for 1 h 15 min without a report',
      'TAS-5 implement run has been queued for 2 h with no hold'
    ]);
  });

  it('flags held work well past its release time', () => {
    const report = healthReport(
      input({
        heldRuns: [
          { label: 'TAS-7', agent: 'review', releaseAt: new Date('2026-10-27T05:30:00Z') },
          { label: 'TAS-8', agent: 'review', releaseAt: minutesBefore(5) }
        ]
      })
    );
    expect(report.held).toEqual(['TAS-7 review run is still held, 1 h 30 min after its release at 05:30']);
  });

  it('flags a slot that fired late or not at all, and not one fired on time or not yet due', () => {
    const report = healthReport(
      input({
        jobs: [
          { name: 'security', at: '06:00' },
          { name: 'health', at: '07:00' },
          { name: 'late', at: '20:00' },
          { name: 'missed', at: '06:30' },
          { name: 'pending', at: '06:55' }
        ],
        slots: [
          { job: 'security', slotAt: new Date('2026-10-27T06:00:00Z'), firedAt: new Date('2026-10-27T06:00:31Z') },
          { job: 'health', slotAt: new Date('2026-10-27T07:00:00Z'), firedAt: now },
          { job: 'late', slotAt: new Date('2026-10-26T20:00:00Z'), firedAt: new Date('2026-10-27T06:17:02Z') }
        ]
      })
    );
    expect(report.slots).toEqual([
      'late: the Mon 26 Oct 20:00 slot fired 10 h 17 min late',
      "missed: the Tue 27 Oct 06:30 slot didn't fire"
    ]);
  });

  it('looks back a week at most after a long gap', () => {
    const report = healthReport(
      input({ since: new Date('2026-09-01T07:00:00Z'), jobs: [{ name: 'security', at: '06:00' }] })
    );
    expect(report.slots).toHaveLength(7);
  });
});

describe('healthReport scheduled workflows', () => {
  const run = (workflow: string, conclusion: string | null, at: string, id: number) => ({
    repository: 'milobedini/tastebook',
    workflow,
    conclusion,
    createdAt: new Date(at),
    url: `https://github.com/milobedini/tastebook/actions/runs/${id}`
  });

  it('lists each failed workflow once, with the latest run', () => {
    const report = healthReport(
      input({
        scheduledRuns: [
          run('Backup', 'failure', '2026-10-26T14:17:00Z', 1),
          run('Backup', 'timed_out', '2026-10-27T02:17:00Z', 2),
          run('Prune', 'startup_failure', '2026-10-27T03:00:00Z', 3)
        ]
      })
    );
    expect(report.workflows).toEqual([
      'tastebook: Prune failed at 03:00 <https://github.com/milobedini/tastebook/actions/runs/3|run log>',
      'tastebook: Backup failed 2×, last at 02:17 <https://github.com/milobedini/tastebook/actions/runs/2|run log>'
    ]);
  });

  it('leaves out runs that passed, were cancelled or are still going, and escapes names', () => {
    const report = healthReport(
      input({
        scheduledRuns: [
          run('Backup', 'success', '2026-10-27T02:17:00Z', 1),
          run('Backup', 'cancelled', '2026-10-27T02:18:00Z', 2),
          run('Backup', null, '2026-10-27T02:19:00Z', 3),
          run('<Nightly>', 'failure', '2026-10-27T02:20:00Z', 4)
        ]
      })
    );
    expect(report.workflows).toEqual([
      'tastebook: &lt;Nightly&gt; failed at 02:20 <https://github.com/milobedini/tastebook/actions/runs/4|run log>'
    ]);
  });
});

describe('healthReport Sentry issues', () => {
  const issue = (shortId: string, title: string, count: number, firstSeen: string) => ({
    project: 'tastebook',
    shortId,
    title,
    count,
    firstSeen: new Date(firstSeen),
    url: `https://milo-bedini.sentry.io/issues/${shortId}/`
  });

  it('lists issues first seen since the last check, most events first', () => {
    const report = healthReport(
      input({
        sentryIssues: [
          issue('TB-3', 'TypeError: recipe is undefined', 1, '2026-10-27T01:12:00Z'),
          issue('TB-4', 'OperationalError: connection refused', 14, '2026-10-26T22:40:00Z'),
          issue('TB-1', 'Seen before the check', 30, '2026-10-26T06:00:00Z')
        ]
      })
    );
    expect(report.sentry).toEqual([
      '<https://milo-bedini.sentry.io/issues/TB-4/|TB-4> OperationalError: connection refused: 14 events, first at 22:40',
      '<https://milo-bedini.sentry.io/issues/TB-3/|TB-3> TypeError: recipe is undefined: 1 event, first at 01:12'
    ]);
  });

  it('escapes and clips titles', () => {
    const report = healthReport(
      input({ sentryIssues: [issue('TB-5', `<b>\n${'x'.repeat(200)}`, 2, '2026-10-27T03:00:00Z')] })
    );
    expect(report.sentry[0]).toMatch(
      /^<https:\/\/milo-bedini\.sentry\.io\/issues\/TB-5\/\|TB-5> &lt;b&gt; x+…: 2 events/
    );
  });
});

describe('healthText', () => {
  const context = { now, since, timeZone: london, consoleUrl: 'https://console.test' };
  const empty = { errors: [], warnings: [], runs: [], held: [], slots: [], workflows: [], sentry: [] };

  it('says all is clear when nothing came up', () => {
    expect(healthText(empty, context)).toBe(
      '*Factory health, Tue 27 Oct:* all clear. No warnings, errors, stuck runs, late jobs, failed workflows or new Sentry issues since Mon 26 Oct 07:00.'
    );
  });

  it('lists what came up by section, with links to the console', () => {
    expect(
      healthText({ ...empty, errors: ['1× a'], slots: ["security: the Tue 27 Oct 06:00 slot didn't fire"] }, context)
    ).toBe(
      [
        '*Factory health, Tue 27 Oct:* 2 things to look at since Mon 26 Oct 07:00.',
        '*Errors*',
        '• 1× a',
        '*Scheduled jobs*',
        "• security: the Tue 27 Oct 06:00 slot didn't fire",
        '<https://console.test/runs|Runs> · <https://console.test/usage|Usage>'
      ].join('\n')
    );
  });

  it('shows ten lines a section and counts the rest', () => {
    const warnings = Array.from({ length: 13 }, (_, index) => `${index + 1}× w${index}`);
    const text = healthText({ ...empty, warnings }, context);
    expect(text).toContain('13 things to look at');
    expect(text).toContain('• 10× w9\n• and 3 more');
    expect(text).not.toContain('w10');
  });
});
