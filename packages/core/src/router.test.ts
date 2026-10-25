import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseFactoryConfig } from './config';
import type { UsageReading } from './governor';
import {
  closingActivity,
  formatReleaseAt,
  governDispatch,
  linearStatusFor,
  modelFor,
  nextStepAfterRun,
  orderQueue,
  parseSessionEvent,
  queuedThought,
  runRequestFor,
  shouldMoveIssue,
  shouldResume,
  slackFinishedText,
  slackThreadText,
  stageForAgent
} from './router';

const config = parseFactoryConfig(
  readFileSync(fileURLToPath(new URL('../../../projects/tastebook/factory.yaml', import.meta.url)), 'utf8')
);

// Trimmed from a real delivery (TAS-7, 2026-10-25).
const createdEvent = {
  type: 'AgentSessionEvent',
  action: 'created',
  organizationId: 'org-1',
  agentSession: {
    id: 'session-1',
    issue: {
      id: 'issue-1',
      identifier: 'TAS-7',
      url: 'https://linear.app/tastebook/issue/TAS-7/show-a-page-not-found-page-for-unknown-routes',
      title: 'Show a "page not found" page for unknown routes',
      team: { id: 'team-1', key: 'TAS', name: 'Tastebook' }
    },
    creator: { id: 'user-1', name: 'Milo Bedini' }
  },
  agentActivity: { signal: null, content: { type: 'prompt', body: 'Work on [TAS-7](https://linear.app/…)' } }
};

const promptedEvent = (activity: Record<string, unknown>) => ({
  type: 'AgentSessionEvent',
  action: 'prompted',
  organizationId: 'org-1',
  agentSession: { id: 'session-1' },
  agentActivity: activity
});

describe('parseSessionEvent', () => {
  it('reads the issue, team and requester from a created event', () => {
    expect(parseSessionEvent(createdEvent)).toEqual({
      kind: 'created',
      organizationId: 'org-1',
      sessionId: 'session-1',
      issue: {
        id: 'issue-1',
        identifier: 'TAS-7',
        url: 'https://linear.app/tastebook/issue/TAS-7/show-a-page-not-found-page-for-unknown-routes',
        title: 'Show a "page not found" page for unknown routes',
        teamKey: 'TAS'
      },
      requester: 'Milo Bedini'
    });
  });

  it('reads a human reply from the activity content, or from the documented body field', () => {
    expect(parseSessionEvent(promptedEvent({ content: { type: 'prompt', body: ' Use the brand colour. ' } }))).toEqual({
      kind: 'prompted',
      organizationId: 'org-1',
      sessionId: 'session-1',
      body: 'Use the brand colour.'
    });
    expect(parseSessionEvent(promptedEvent({ body: 'Use the brand colour.' }))).toMatchObject({
      kind: 'prompted',
      body: 'Use the brand colour.'
    });
  });

  it('treats a stop signal as a stop, whatever the message says', () => {
    expect(parseSessionEvent(promptedEvent({ signal: 'stop', content: { body: 'Stop' } }))).toEqual({
      kind: 'stop',
      organizationId: 'org-1',
      sessionId: 'session-1'
    });
  });

  it('ignores other webhooks, empty replies, sessions without an issue and non-https issue links', () => {
    expect(parseSessionEvent({ ...createdEvent, type: 'Issue' })).toBeUndefined();
    expect(parseSessionEvent(promptedEvent({ content: { body: '   ' } }))).toBeUndefined();
    expect(parseSessionEvent({ ...createdEvent, agentSession: { id: 'session-1', issue: null } })).toBeUndefined();
    const unsafe = { ...createdEvent.agentSession.issue, url: 'javascript:alert(1)' };
    expect(parseSessionEvent({ ...createdEvent, agentSession: { id: 'session-1', issue: unsafe } })).toBeUndefined();
  });
});

describe('runRequestFor', () => {
  const created = parseSessionEvent(createdEvent);
  const prompted = parseSessionEvent(promptedEvent({ content: { body: 'Rename the button.' } }));
  if (created?.kind !== 'created' || prompted?.kind !== 'prompted') {
    throw new Error('fixtures did not parse');
  }

  it('starts new work at triage, as feature work', () => {
    expect(runRequestFor(created, undefined)).toEqual({
      agent: 'triage',
      trigger: 'delegated',
      priority: 'feature',
      prompt: null
    });
  });

  it('sends a reply to the agent for the work item’s stage, as in-flight work with the reply', () => {
    expect(runRequestFor(prompted, 'building')).toEqual({
      agent: 'implement',
      trigger: 'prompted',
      priority: 'in_flight',
      prompt: 'Rename the button.'
    });
  });

  it.each([
    ['researching', 'triage'],
    ['spec', 'spec'],
    ['spec_review', 'spec'],
    ['building', 'implement'],
    ['in_review', 'implement'],
    ['awaiting_merge', 'implement'],
    ['done', 'triage'],
    ['canceled', 'triage']
  ] as const)('continues from %s with %s', (stage, agent) => {
    expect(runRequestFor(prompted, stage).agent).toBe(agent);
    expect(runRequestFor(created, stage)).toMatchObject({ agent, trigger: 'delegated' });
  });
});

const now = new Date('2026-10-25T12:00:00Z');
const reading = (window: UsageReading['window'], utilisation: number, overrides: Partial<UsageReading> = {}) => ({
  window,
  utilisation,
  resetsAt: new Date(now.getTime() + 2 * 3_600_000),
  takenAt: new Date(now.getTime() - 60_000),
  source: 'run' as const,
  ...overrides
});

const governed = (overrides: Partial<Parameters<typeof governDispatch>[0]>) =>
  governDispatch({
    policy: config.usage,
    readings: { fiveHour: reading('fiveHour', 0.1), sevenDay: reading('sevenDay', 0.1) },
    priority: 'feature',
    runningCount: 0,
    maxRuns: 2,
    now,
    workItemBusy: false,
    paused: false,
    allowUsage: false,
    ...overrides
  });

describe('governDispatch', () => {
  it('dispatches with fresh readings and nothing else running', () => {
    expect(governed({})).toEqual({ decision: { kind: 'dispatch', state: 'open', downshift: false }, staleWindows: [] });
  });

  it('fails open on missing readings and reports which windows were stale', () => {
    expect(governed({ readings: {} })).toEqual({
      decision: { kind: 'dispatch', state: 'open', downshift: false },
      staleWindows: ['fiveHour', 'sevenDay']
    });
  });

  it('still holds on a stale reading that says the window is paused', () => {
    const stalePaused = reading('fiveHour', 0.9, { takenAt: new Date(now.getTime() - 60 * 60_000) });
    expect(governed({ readings: { fiveHour: stalePaused } }).decision).toMatchObject({
      kind: 'hold',
      reason: 'five_hour_pause'
    });
  });

  it('holds work on an issue that already has a run going', () => {
    expect(governed({ workItemBusy: true }).decision).toEqual({
      kind: 'hold',
      state: 'open',
      reason: 'work_item_busy'
    });
  });

  it('holds everything while the console’s pause is on', () => {
    expect(governed({ paused: true }).decision).toEqual({ kind: 'hold', state: 'paused', reason: 'manual_pause' });
  });

  it('lets an allowed run past the pause and the usage limits, without downshifting', () => {
    expect(governed({ paused: true, allowUsage: true }).decision).toEqual({
      kind: 'dispatch',
      state: 'open',
      downshift: false
    });
    expect(
      governed({
        allowUsage: true,
        readings: { fiveHour: reading('fiveHour', 0.9), sevenDay: reading('sevenDay', 0.1) }
      }).decision
    ).toEqual({ kind: 'dispatch', state: 'paused', downshift: false });
  });

  it('keeps the run caps for an allowed run', () => {
    expect(governed({ allowUsage: true, runningCount: 2 }).decision).toMatchObject({ reason: 'concurrency' });
    expect(governed({ allowUsage: true, workItemBusy: true }).decision).toMatchObject({ reason: 'work_item_busy' });
  });

  it('prefers the usage reason over a busy issue, so the hold says when it can release', () => {
    expect(governed({ workItemBusy: true, readings: { fiveHour: reading('fiveHour', 0.9) } }).decision).toMatchObject({
      reason: 'five_hour_pause'
    });
  });
});

describe('modelFor', () => {
  it('uses the stage model, and the downshift model only when throttled', () => {
    expect(modelFor(config, 'implement', false)).toBe('opus');
    expect(modelFor(config, 'triage', true)).toBe('haiku');
    expect(modelFor(config, 'triage', false)).toBe('sonnet');
  });

  it('keeps the stage model when throttled and no downshift is set for it', () => {
    expect(modelFor(config, 'implement', true)).toBe('opus');
  });
});

describe('Linear statuses', () => {
  it('maps a stage’s agent to the status name in factory.yaml', () => {
    const stage = stageForAgent('implement');
    expect(stage).toBe('building');
    expect(linearStatusFor(config, 'awaiting_merge')).toBe('Awaiting Merge');
  });

  it('leaves finished issues where they are', () => {
    expect(shouldMoveIssue('backlog')).toBe(true);
    expect(shouldMoveIssue('started')).toBe(true);
    expect(shouldMoveIssue('completed')).toBe(false);
    expect(shouldMoveIssue('canceled')).toBe(false);
  });
});

describe('orderQueue', () => {
  it('releases higher priorities first, then the longest-held', () => {
    const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
    const queue = [
      { runId: 'feature-old', priority: 'feature' as const, heldAt: at(0) },
      { runId: 'in-flight', priority: 'in_flight' as const, heldAt: at(10) },
      { runId: 'feature-new', priority: 'feature' as const, heldAt: at(5) },
      { runId: 'urgent', priority: 'urgent' as const, heldAt: at(20) }
    ];
    expect(orderQueue(queue).map(({ runId }) => runId)).toEqual(['urgent', 'in-flight', 'feature-old', 'feature-new']);
  });
});

describe('queuedThought', () => {
  it('says when held work is released, in the project’s time zone', () => {
    const decision = {
      kind: 'hold' as const,
      state: 'paused' as const,
      reason: 'five_hour_pause' as const,
      releaseAt: new Date('2026-10-25T14:30:00Z')
    };
    expect(queuedThought(decision, now, 'Europe/London')).toBe(
      'Queued until 14:30: usage in the 5-hour window is close to the limit.'
    );
  });

  it('says what it is waiting for when there is no release time', () => {
    expect(queuedThought({ kind: 'hold', state: 'open', reason: 'concurrency' }, now, 'Europe/London')).toBe(
      'Queued: the factory is already running as many stages as it allows. It starts as soon as that clears.'
    );
  });
});

describe('formatReleaseAt', () => {
  it('adds the day when the release is not today', () => {
    expect(formatReleaseAt(new Date('2026-10-27T09:00:00Z'), now, 'Europe/London')).toBe('Tue 27 Oct, 09:00');
  });
});

describe('closingActivity', () => {
  const run = { agent: 'implement' as const, status: 'finished' as const, summary: 'CI cannot start Postgres.' };
  const open = { agentClosed: false, resuming: false };

  it('posts an error for a failed or blocked run the agent left without a closing message', () => {
    expect(closingActivity({ ...run, outcome: 'blocked' }, open)).toEqual({
      type: 'error',
      body: 'CI cannot start Postgres.'
    });
    expect(closingActivity({ ...run, outcome: 'failed', summary: null }, open)).toEqual({
      type: 'error',
      body: 'The implement run ended without a summary.'
    });
  });

  it('posts a response for other outcomes the agent left open', () => {
    expect(closingActivity({ ...run, outcome: 'needs_input' }, open)).toMatchObject({ type: 'response' });
  });

  it('stays quiet when the agent already closed the session', () => {
    expect(closingActivity({ ...run, outcome: 'failed' }, { ...open, agentClosed: true })).toBeUndefined();
  });

  it('says a run cut short by the usage limit will resume, or that it gave up after a second time', () => {
    const limitHit = { ...run, status: 'limit_hit' as const, outcome: null };
    expect(closingActivity(limitHit, { ...open, resuming: true })).toMatchObject({ type: 'thought' });
    expect(closingActivity(limitHit, open)).toMatchObject({ type: 'error' });
  });
});

describe('nextStepAfterRun', () => {
  const finished = { status: 'finished' as const, outcome: 'done' as const };
  const triaged = (next: string | null) => ({
    ...finished,
    agent: 'triage' as const,
    report: { stage: 'triage', outcome: 'done', summary: 'Size S.', next }
  });

  it('hands a delivered PR to the human merge gate', () => {
    expect(nextStepAfterRun({ ...finished, agent: 'implement', report: null }, true)).toEqual({
      stage: 'awaiting_merge'
    });
  });

  it.each([
    ['implement', 'building', 'implement'],
    ['verify', 'building', 'implement'],
    ['spec', 'spec', 'spec']
  ] as const)('follows triage’s next: %s with the %s stage and a %s run', (next, stage, agent) => {
    expect(nextStepAfterRun(triaged(next), false)).toEqual({
      stage,
      request: { agent, trigger: 'delegated', priority: 'feature', prompt: null }
    });
  });

  it('waits for a human when triage says so, says nothing, or the report is unreadable', () => {
    expect(nextStepAfterRun(triaged('human'), false)).toEqual({});
    expect(nextStepAfterRun(triaged(null), false)).toEqual({});
    expect(nextStepAfterRun({ ...triaged('implement'), report: 'not json' }, false)).toEqual({});
  });

  it('does nothing after a run that didn’t finish its stage', () => {
    expect(nextStepAfterRun({ ...triaged('implement'), outcome: 'needs_input' }, false)).toEqual({});
    expect(nextStepAfterRun({ ...triaged('implement'), status: 'limit_hit', outcome: null }, false)).toEqual({});
    expect(nextStepAfterRun({ ...finished, agent: 'implement', report: null }, false)).toEqual({});
    expect(nextStepAfterRun({ ...finished, agent: 'spec', report: null }, true)).toEqual({});
  });
});

describe('shouldResume', () => {
  it('resumes a run cut short by the limit once, but not a resumed run that hit it again', () => {
    expect(shouldResume({ status: 'limit_hit', trigger: 'delegated' })).toBe(true);
    expect(shouldResume({ status: 'limit_hit', trigger: 'rerun' })).toBe(false);
    expect(shouldResume({ status: 'finished', trigger: 'delegated' })).toBe(false);
  });
});

describe('Slack text', () => {
  it('opens the thread with a link to the issue, escaping the title', () => {
    expect(slackThreadText({ identifier: 'TAS-7', url: 'https://linear.app/t/TAS-7', title: 'Fix <b> & co' })).toBe(
      '<https://linear.app/t/TAS-7|TAS-7> Fix &lt;b&gt; &amp; co'
    );
  });

  it('reports the outcome, summary and links when a run finishes', () => {
    expect(
      slackFinishedText({
        agent: 'implement',
        status: 'finished',
        outcome: 'done',
        summary: 'Added the page.',
        prUrl: 'https://github.com/milobedini/tastebook/pull/4',
        actionsRunUrl: null
      })
    ).toBe('The implement run finished. Added the page. <https://github.com/milobedini/tastebook/pull/4|PR>');
  });

  it('says a limit-hit run will resume', () => {
    expect(
      slackFinishedText({
        agent: 'implement',
        status: 'limit_hit',
        outcome: null,
        summary: null,
        prUrl: null,
        actionsRunUrl: 'https://github.com/milobedini/tastebook/actions/runs/1'
      })
    ).toBe(
      'The implement run hit the usage limit; it resumes once the window resets. <https://github.com/milobedini/tastebook/actions/runs/1|run log>'
    );
  });
});
