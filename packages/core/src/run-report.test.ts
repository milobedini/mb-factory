import { describe, expect, it } from 'vitest';

import type { RunReport } from './run-report';
import { summariseRun as summarise } from './run-report';

// Four hours before the fixture's five-hour reset.
const now = new Date('2026-10-25T07:00:00Z');
const summariseRun = (input: RunReport) => summarise(input, now);

// Shapes as captured from claude-code-action v1.0.262's execution file (Claude Code 2.1.310).
const rateLimitEvent = (fiveHourStatus = 'allowed', topStatus = 'allowed') => ({
  type: 'rate_limit_event',
  rate_limit_info: {
    status: topStatus,
    resetsAt: 1792926000,
    rateLimitType: 'five_hour',
    overageStatus: 'rejected',
    unifiedWindows: {
      five_hour: { utilization: 0.42, resetsAt: 1792926000, status: fiveHourStatus },
      seven_day: { utilization: 0.13, resetsAt: 1792990800, status: 'allowed' }
    }
  },
  uuid: 'bb4a8ebd-15be-4e33-a4b5-5a7f71fcaead',
  session_id: '5cee6e76-2220-46cc-8227-33e8268b8755'
});

const resultEvent = (overrides: Record<string, unknown> = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 4,
  duration_ms: 9286,
  total_cost_usd: 0.42,
  modelUsage: {
    'claude-opus-5-5': {
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadInputTokens: 5000,
      cacheCreationInputTokens: 300
    },
    'claude-haiku-5-5': { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 50, cacheCreationInputTokens: 3 }
  },
  ...overrides
});

const stageReport = {
  stage: 'implement',
  outcome: 'done',
  summary: 'Added the cooking time to the recipe card.',
  next: 'review',
  pr: 42,
  branch: 'tas-12-show-cooking-time',
  followUps: []
};

const report = (overrides: Partial<RunReport> = {}): RunReport => ({
  conclusion: 'success',
  report: stageReport,
  events: [{ type: 'system', subtype: 'init' }, rateLimitEvent(), resultEvent()],
  ...overrides
});

describe('summariseRun', () => {
  it('takes the outcome, summary and report from a valid stage report', () => {
    const summary = summariseRun(report());

    expect(summary.status).toBe('finished');
    expect(summary.outcome).toBe('done');
    expect(summary.summary).toBe('Added the cooking time to the recipe card.');
    expect(summary.report?.pr).toBe(42);
    expect(summary.report?.branch).toBe('tas-12-show-cooking-time');
  });

  it('sums token usage across every model and keeps cost, duration and turns', () => {
    expect(summariseRun(report()).usage).toEqual({
      inputTokens: 1010,
      outputTokens: 202,
      cacheReadInputTokens: 5050,
      cacheCreationInputTokens: 303,
      costUsd: 0.42,
      durationMs: 9286,
      numTurns: 4
    });
  });

  it('turns both rate-limit windows into usage readings', () => {
    expect(summariseRun(report()).readings).toEqual([
      { window: 'fiveHour', utilisation: 0.42, resetsAt: new Date('2026-10-25T11:00:00Z'), status: 'allowed' },
      { window: 'sevenDay', utilisation: 0.13, resetsAt: new Date('2026-10-26T05:00:00Z'), status: 'allowed' }
    ]);
  });

  it('uses the last rate-limit event when there are several', () => {
    const events = [rateLimitEvent(), { ...rateLimitEvent(), rate_limit_info: { unifiedWindows: {} } }];

    expect(summariseRun(report({ events })).readings).toEqual([]);
  });

  it.each([
    ['missing', null],
    ['malformed', { stage: 'implement', outcome: 'shipped', summary: 'Done' }]
  ])('marks a run with a %s report as failed', (_label, stageReportValue) => {
    const summary = summariseRun(
      report({ report: stageReportValue, events: [resultEvent({ subtype: 'error_max_turns', is_error: true })] })
    );

    expect(summary.status).toBe('finished');
    expect(summary.outcome).toBe('failed');
    expect(summary.summary).toBe('The stage ended without a valid report. Claude Code ended with error_max_turns.');
    expect(summary.report).toBeNull();
  });

  it('says when the workflow step itself failed', () => {
    const summary = summariseRun(report({ conclusion: 'failure', report: null, events: [] }));

    expect(summary.summary).toBe('The stage ended without a valid report. The workflow step failed.');
    expect(summary.usage).toBeNull();
  });

  it.each([
    ['a window', rateLimitEvent('rejected')],
    ['the overall status', rateLimitEvent('allowed', 'rejected')]
  ])('marks a run without a report as limit_hit when %s was rejected', (_label, event) => {
    const summary = summariseRun(report({ report: null, events: [event, resultEvent({ is_error: true })] }));

    expect(summary.status).toBe('limit_hit');
    expect(summary.outcome).toBeNull();
    expect(summary.summary).toBe('Hit the usage limit before the stage finished.');
  });

  it('keeps the stage report when the limit was hit after the stage finished', () => {
    const summary = summariseRun(report({ events: [rateLimitEvent('rejected'), resultEvent()] }));

    expect(summary.status).toBe('finished');
    expect(summary.outcome).toBe('done');
  });

  it('caps utilisation at 1', () => {
    const event = rateLimitEvent();
    event.rate_limit_info.unifiedWindows.five_hour.utilization = 7;

    expect(summariseRun(report({ events: [event] })).readings[0]?.utilisation).toBe(1);
  });

  it.each([
    ['too far ahead for the window', 1793000000],
    ['already past', 1792900000]
  ])('drops a reading whose reset is %s', (_label, resetsAt) => {
    const event = rateLimitEvent();
    event.rate_limit_info.unifiedWindows.five_hour.resetsAt = resetsAt;

    expect(summariseRun(report({ events: [event] })).readings.map(({ window }) => window)).toEqual(['sevenDay']);
  });

  it.each(['tas-12\nstage: review', '../main', '-delete', 'feature/', 'refs.lock'])(
    'treats a report with the branch %j as malformed',
    (branch) => {
      const summary = summariseRun(report({ report: { ...stageReport, branch } }));

      expect(summary.outcome).toBe('failed');
      expect(summary.report).toBeNull();
    }
  );

  it('skips events it does not recognise', () => {
    const events = ['not an event', { type: 'result' }, { type: 'rate_limit_event' }, resultEvent({ num_turns: 7 })];

    const summary = summariseRun(report({ events }));

    expect(summary.usage?.numTurns).toBe(7);
    expect(summary.readings).toEqual([]);
  });
});
