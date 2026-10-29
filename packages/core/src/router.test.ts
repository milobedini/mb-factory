import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseFactoryConfig } from './config';
import type { SpecDesign } from './design';
import type { UsageReading } from './governor';
import {
  afterSpecApproval,
  briefRound,
  canRerun,
  closingActivity,
  conflictFixesSince,
  conflictHandOverText,
  consecutiveCiFixes,
  currentMergeable,
  decideCiFailure,
  decideConflict,
  decideVerify,
  designStageOn,
  failedChecks,
  findingsPrompt,
  formatReleaseAt,
  governDispatch,
  linearStatusFor,
  metEveryCriterion,
  modelFor,
  neverStarted,
  newestMergedBase,
  nextStepAfterRun,
  onlyLockfilesChanged,
  orderQueue,
  parseSessionEvent,
  queuedAlready,
  queuedThought,
  readSpecReply,
  retryText,
  reverifiesOnRequest,
  reviewThreadsToResolve,
  runRequestFor,
  sameChanges,
  shouldBringUpToDate,
  shouldMoveIssue,
  shouldResume,
  shouldRetry,
  showsOnScreen,
  slackFinishedText,
  slackReplyText,
  slackThreadText,
  stageForAgent,
  startsReviewLoop,
  withFindings
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
    ['design', 'design'],
    ['design_review', 'design'],
    ['building', 'implement'],
    ['in_review', 'review'],
    ['awaiting_merge', 'implement'],
    ['done', 'triage'],
    ['canceled', 'triage']
  ] as const)('continues from %s with %s', (stage, agent) => {
    expect(runRequestFor(created, stage)).toMatchObject({ agent, trigger: 'delegated' });
    if (stage !== 'spec_review' && stage !== 'design_review') {
      expect(runRequestFor(prompted, stage)?.agent).toBe(agent);
    }
  });

  const reply = (body: string) => {
    const event = parseSessionEvent(promptedEvent({ content: { body } }));
    if (event?.kind !== 'prompted') {
      throw new Error('fixture did not parse');
    }
    return event;
  };

  it('starts implement on approval in Spec Review, carrying any suggestions', () => {
    expect(runRequestFor(reply('Approve'), 'spec_review')).toEqual({
      agent: 'implement',
      trigger: 'spec_approved',
      priority: 'in_flight',
      prompt: null
    });
    expect(runRequestFor(reply('Approve: call the button Retry'), 'spec_review')).toMatchObject({
      agent: 'implement',
      prompt: 'call the button Retry'
    });
  });

  it('revises the spec on a change, and asks first when the reply names none', () => {
    expect(runRequestFor(reply('Keep the old copy.'), 'spec_review')).toEqual({
      agent: 'spec',
      trigger: 'prompted',
      priority: 'in_flight',
      prompt: 'Keep the old copy.'
    });
    expect(runRequestFor(reply('Change something'), 'spec_review')).toBeUndefined();
  });

  it('hands the design off on approval in Design Review, and revises it on a change', () => {
    expect(runRequestFor(reply('Approve: tighten the gap'), 'design_review')).toEqual({
      agent: 'design',
      trigger: 'design_approved',
      priority: 'in_flight',
      prompt: 'tighten the gap'
    });
    expect(runRequestFor(reply('Make the button green.'), 'design_review')).toEqual({
      agent: 'design',
      trigger: 'prompted',
      priority: 'in_flight',
      prompt: 'Make the button green.'
    });
    expect(runRequestFor(reply('Change something'), 'design_review')).toBeUndefined();
  });
});

describe('afterSpecApproval', () => {
  const approved = {
    agent: 'implement',
    trigger: 'spec_approved',
    priority: 'in_flight',
    prompt: 'Shorter copy'
  } as const;
  const needed: SpecDesign = { needed: true, why: 'A new screen.', components: [] };

  it('sends an approved spec that calls for design to the design stage, with its suggestions', () => {
    expect(afterSpecApproval(approved, needed, true)).toEqual({ ...approved, agent: 'design' });
  });

  it('keeps implement when the spec skips design, makes no call, or the project has no design stage', () => {
    expect(afterSpecApproval(approved, { needed: false, why: 'No visual change.' }, true)).toEqual(approved);
    expect(afterSpecApproval(approved, null, true)).toEqual(approved);
    expect(afterSpecApproval(approved, needed, false)).toEqual(approved);
  });

  it('leaves any other request alone', () => {
    const reply = { agent: 'spec', trigger: 'prompted', priority: 'in_flight', prompt: 'Keep it.' } as const;
    expect(afterSpecApproval(reply, needed, true)).toEqual(reply);
  });
});

describe('designStageOn', () => {
  it('is on only when the project names its design routine and both design statuses', () => {
    const statuses = config.linear.statuses;
    const routine = { routine: 'trig_0119jZu96GpU4dQ7dsog4A7Z' };
    const withDesign = (design: typeof config.design, named: Partial<typeof statuses>) => ({
      ...config,
      design,
      linear: { ...config.linear, statuses: { ...statuses, ...named } }
    });
    const both = { design: 'Design', designReview: 'Design Review' };
    expect(designStageOn(withDesign(routine, both))).toBe(true);
    expect(designStageOn(withDesign(undefined, both))).toBe(false);
    expect(designStageOn(withDesign(routine, { design: 'Design', designReview: undefined }))).toBe(false);
  });
});

describe('readSpecReply', () => {
  it.each(['Approve', 'approve', 'Approved.', ' LGTM! '])('reads %j as a plain approval', (body) => {
    expect(readSpecReply(body)).toEqual({ kind: 'approve', suggestions: null });
  });

  it.each([
    ['Approve: call the button Retry', 'call the button Retry'],
    ['approved - log the error too\nand keep the copy', 'log the error too\nand keep the copy'],
    ['Approve — fine as is, but shorter copy', 'fine as is, but shorter copy']
  ])('reads %j as approval with suggestions', (body, suggestions) => {
    expect(readSpecReply(body)).toEqual({ kind: 'approve', suggestions });
  });

  it.each(['Change something', 'change'])('reads the %j option alone as asking for changes', (body) => {
    expect(readSpecReply(body)).toEqual({ kind: 'ask_changes' });
  });

  it.each(['Approve once the copy is shorter', 'I approve of the approach but not the copy', 'Approve:', 'Yes'])(
    'reads %j as a change, not an approval',
    (body) => {
      expect(readSpecReply(body)).toEqual({ kind: 'changes', body });
    }
  );
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

  it('uses the slicing model for a triage run on a Slice issue, without the triage downshift', () => {
    expect(modelFor(config, 'triage', false, 'Slice Real recipes')).toBe('opus');
    expect(modelFor(config, 'triage', true, 'Slice Real recipes')).toBe('opus');
    expect(modelFor(config, 'triage', false, 'Slicer for onions')).toBe('sonnet');
    expect(modelFor(config, 'spec', false, 'Slice Real recipes')).toBe('opus');
  });

  it('uses the verify model, and says so when factory.yaml has none', () => {
    expect(modelFor(config, 'verify', false)).toBe('sonnet');
    const { verify: _, ...models } = config.models;
    expect(() => modelFor({ ...config, models }, 'verify', false)).toThrow(/no model for the verify stage/);
  });

  it('falls back to the triage model for slicing when none is set', () => {
    const { slicing: _, ...models } = config.models;
    expect(modelFor({ ...config, models }, 'triage', false, 'Slice Real recipes')).toBe('sonnet');
  });
});

describe('withFindings', () => {
  const answered = {
    agent: 'implement',
    trigger: 'answered',
    priority: 'in_flight',
    prompt: 'The human decided the findings the review left for them.'
  } as const;
  const nit = { tier: 'nit', path: 'backend/recipes/views.py', line: 52, summary: 'A ninth query.', fix: 'Reuse it.' };

  // TAS-43, 27 Oct: an answer that changed the PR would have shut out the round's Fix box.
  it('adds the round’s findings to the answers’ revision', () => {
    expect(withFindings(answered, 1, [nit]).prompt).toBe([answered.prompt, findingsPrompt(1, [nit])].join('\n\n'));
    expect(withFindings(answered, 1, [nit]).trigger).toBe('answered');
  });

  it('leaves the request alone with no findings', () => {
    expect(withFindings(answered, 1, [])).toBe(answered);
  });
});

describe('reverifiesOnRequest', () => {
  // TAS-40, 27 Oct: merging main in to clear a GLOSSARY.md conflict re-ran verify, though main's changes were verified
  // on their own PRs and the resolution changed nothing on screen.
  // TAS-43, 27 Oct: fixing two end-to-end locators, as the user's answer asked, re-ran verify for ten minutes.
  it('reuses a verify that met every criterion after any revision of a delivered PR', () => {
    expect(reverifiesOnRequest('review_findings')).toBe(true);
    expect(reverifiesOnRequest('answered')).toBe(true);
    expect(reverifiesOnRequest('ci_failed')).toBe(true);
    expect(reverifiesOnRequest('conflict')).toBe(true);
  });

  it('verifies a first delivery and a person’s own instruction as usual', () => {
    expect(reverifiesOnRequest('delegated')).toBe(false);
    expect(reverifiesOnRequest('spec_approved')).toBe(false);
    expect(reverifiesOnRequest('prompted')).toBe(false);
  });
});

describe('decideVerify', () => {
  const screen = ['frontend/'];
  const reason = 'Only changes where browser errors are sent';

  it('verifies a PR that touches the screen when the implement run gave no reason not to', () => {
    expect(decideVerify(screen, ['frontend/src/app.tsx'], { next: 'review' })).toEqual({ verify: true });
    expect(decideVerify(screen, ['frontend/src/app.tsx'], null)).toEqual({ verify: true });
    expect(decideVerify(screen, ['frontend/src/app.tsx'], { notOnScreen: '   ' })).toEqual({ verify: true });
    expect(decideVerify(screen, ['frontend/src/app.tsx'], { notOnScreen: 42 })).toEqual({ verify: true });
  });

  it('skips verify, with the reason, when the implement run said nothing a person sees changed', () => {
    expect(decideVerify(screen, ['frontend/vite.config.ts'], { notOnScreen: `  ${reason}\n` })).toEqual({
      verify: false,
      skipped: reason
    });
  });

  it('says nothing about a PR that never touches the screen', () => {
    expect(decideVerify(screen, ['backend/api.py'], { notOnScreen: reason })).toEqual({ verify: false });
  });

  it('skips verify once an earlier run met every criterion, saying when', () => {
    expect(decideVerify(screen, ['frontend/src/app.tsx'], null, '15:24')).toEqual({
      verify: false,
      skipped: 'already verified at 15:24, and nothing it checked was unmet'
    });
  });

  it('verifies when the implement run asks again, whatever else holds, passing on why', () => {
    const asked = { verifyAgain: ' The admin criterion needs a screenshot\n' };
    expect(decideVerify(screen, ['backend/admin.py'], asked, '15:24')).toEqual({
      verify: true,
      again: 'The admin criterion needs a screenshot'
    });
    expect(decideVerify(screen, ['frontend/src/app.tsx'], { verifyAgain: '  ' }, '15:24').verify).toBe(false);
  });

  it('gives the implement run’s reason over the earlier verify', () => {
    expect(decideVerify(screen, ['frontend/src/app.tsx'], { notOnScreen: reason }, '15:24')).toEqual({
      verify: false,
      skipped: reason
    });
  });
});

describe('metEveryCriterion', () => {
  const report = (...results: string[]) => ({ criteria: results.map((result) => ({ criterion: 'c', result })) });

  it('holds when at least one criterion was met and none was not met', () => {
    expect(metEveryCriterion(report('met', 'met'))).toBe(true);
    expect(metEveryCriterion(report('met', 'unverified'))).toBe(true);
  });

  it('fails when a criterion was not met, however it is written', () => {
    expect(metEveryCriterion(report('met', 'not met'))).toBe(false);
    expect(metEveryCriterion(report('met', 'not_met'))).toBe(false);
    expect(metEveryCriterion(report('Met', 'Not Met'))).toBe(false);
  });

  it('fails when nothing was met or the report has no criteria', () => {
    expect(metEveryCriterion(report('unverified'))).toBe(false);
    expect(metEveryCriterion(report())).toBe(false);
    expect(metEveryCriterion({ outcome: 'done' })).toBe(false);
    expect(metEveryCriterion(null)).toBe(false);
  });
});

describe('showsOnScreen', () => {
  it('matches files under a listed directory, with or without its slash, and listed files', () => {
    expect(showsOnScreen(['frontend/'], ['backend/api.py', 'frontend/src/app.tsx'])).toBe(true);
    expect(showsOnScreen(['frontend'], ['frontend/index.html'])).toBe(true);
    expect(showsOnScreen(['./frontend/'], ['frontend/index.html'])).toBe(true);
    expect(showsOnScreen(['vercel.json'], ['vercel.json'])).toBe(true);
  });

  it('ignores files outside them, including ones that only share a prefix', () => {
    expect(showsOnScreen(['frontend/'], ['backend/api.py', 'docs/design.md'])).toBe(false);
    expect(showsOnScreen(['frontend/'], ['frontend-tools/build.ts'])).toBe(false);
    expect(showsOnScreen(['frontend/'], [])).toBe(false);
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
    expect(queuedThought({ reason: 'concurrency' }, now, 'Europe/London')).toBe(
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
    expect(closingActivity({ ...run, outcome: 'done' }, open)).toMatchObject({ type: 'response' });
    expect(closingActivity({ ...run, outcome: 'declined' }, open)).toMatchObject({ type: 'response' });
  });

  it('leaves the session waiting on a reply when the run needs input but asked nothing', () => {
    expect(closingActivity({ ...run, outcome: 'needs_input' }, open)).toEqual({
      type: 'elicitation',
      body: 'CI cannot start Postgres.'
    });
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
  const finished = { status: 'finished' as const, outcome: 'done' as const, trigger: 'delegated' as const };
  const loop = { hasPr: false, reviewRounds: 0, maxReviewRounds: 2 };
  const triaged = (next: string | null) => ({
    ...finished,
    agent: 'triage' as const,
    report: { stage: 'triage', outcome: 'done', summary: 'Size S.', next }
  });

  it('settles a slicing issue once its slices are created, and only then', () => {
    const sliced = (report: unknown) => ({ ...finished, agent: 'triage' as const, report });
    expect(nextStepAfterRun(sliced({ next: 'human', created: ['TAS-38', 'TAS-39'] }), loop)).toEqual({ stage: 'done' });
    expect(nextStepAfterRun(sliced({ next: 'human', created: [] }), loop)).toEqual({});
    expect(nextStepAfterRun(sliced({ next: 'human', created: ['not an issue'] }), loop)).toEqual({});
    expect(nextStepAfterRun({ ...sliced({ created: ['TAS-38'] }), outcome: 'needs_input' }, loop)).toEqual({});
    expect(nextStepAfterRun(sliced({ next: 'spec', created: ['TAS-38'] }), loop)).toMatchObject({ stage: 'spec' });
  });

  it('hands a reported gate to the router, unless the run also asked questions', () => {
    const gate = { body: 'Split into 16.', options: ['Create them', 'Change something', 'Keep as one'] };
    const waiting = { ...finished, outcome: 'needs_input' as const, agent: 'triage' as const };
    expect(nextStepAfterRun({ ...waiting, report: { gate } }, loop)).toEqual({ gate });
    const question = { prompt: 'Which?', options: ['A', 'B'] };
    expect(nextStepAfterRun({ ...waiting, report: { gate, questions: [question] } }, loop)).not.toHaveProperty('gate');
    expect(nextStepAfterRun({ ...finished, agent: 'triage', report: { gate } }, loop)).not.toHaveProperty('gate');
  });

  it('builds the handed-off design with the approval’s suggestions, unless it needs new components first', () => {
    const handedOff = {
      ...finished,
      agent: 'design' as const,
      trigger: 'design_approved' as const,
      prompt: 'Tighten the gap',
      report: { components: [{ name: 'Button', change: 'changed' }] }
    };
    expect(nextStepAfterRun(handedOff, loop)).toEqual({
      stage: 'building',
      request: { agent: 'implement', trigger: 'design_approved', priority: 'in_flight', prompt: 'Tighten the gap' }
    });
    const needsAvatar = { ...handedOff, report: { components: [{ name: 'Avatar', change: 'new' }] } };
    expect(nextStepAfterRun(needsAvatar, loop)).toEqual({ stage: 'building' });
    expect(nextStepAfterRun({ ...handedOff, outcome: 'failed' }, loop)).toEqual({});
  });

  it('waits on Design Review once a design run drew the canvas or asked about it', () => {
    const designed = { ...finished, agent: 'design' as const, report: { summary: 'Drew the canvas.' } };
    expect(nextStepAfterRun(designed, loop)).toEqual({ stage: 'design_review' });
    expect(nextStepAfterRun({ ...designed, outcome: 'needs_input' }, loop)).toEqual({ stage: 'design_review' });
    expect(nextStepAfterRun({ ...designed, outcome: 'failed' }, loop)).toEqual({});
  });

  it('sends a delivered PR to review, as in-flight work', () => {
    expect(nextStepAfterRun({ ...finished, agent: 'implement', report: null }, { ...loop, hasPr: true })).toEqual({
      stage: 'in_review',
      request: { agent: 'review', trigger: 'delivered', priority: 'in_flight', prompt: null }
    });
  });

  it('sends a delivered PR that shows on screen to verify first, and a verified PR on to review', () => {
    const delivered = { ...loop, hasPr: true };
    expect(nextStepAfterRun({ ...finished, agent: 'implement', report: null }, { ...delivered, verify: true })).toEqual(
      {
        stage: 'in_review',
        request: { agent: 'verify', trigger: 'delivered', priority: 'in_flight', prompt: null }
      }
    );
    expect(nextStepAfterRun({ ...finished, agent: 'verify', report: null }, delivered)).toEqual({
      stage: 'in_review',
      request: { agent: 'review', trigger: 'delivered', priority: 'in_flight', prompt: null }
    });
    expect(nextStepAfterRun({ ...finished, agent: 'verify', outcome: 'blocked', report: null }, delivered)).toEqual({});
  });

  it('sends a PR back to the gate when its conflict fix changed only lockfiles, and to review otherwise', () => {
    const fix = { ...finished, agent: 'implement' as const, trigger: 'conflict' as const, report: null };
    const delivered = { ...loop, hasPr: true };
    expect(nextStepAfterRun(fix, { ...delivered, lockfileOnlyMerge: true })).toEqual({ stage: 'awaiting_merge' });
    expect(nextStepAfterRun(fix, delivered)).toMatchObject({ stage: 'in_review' });
    expect(
      nextStepAfterRun({ ...fix, trigger: 'review_findings' as const }, { ...delivered, lockfileOnlyMerge: true })
    ).toMatchObject({ stage: 'in_review' });
  });

  it.each([
    ['implement', 'building', 'implement'],
    ['verify', 'building', 'implement'],
    ['spec', 'spec', 'spec']
  ] as const)('follows triage’s next: %s with the %s stage and a %s run', (next, stage, agent) => {
    expect(nextStepAfterRun(triaged(next), loop)).toEqual({
      stage,
      request: { agent, trigger: 'delegated', priority: 'feature', prompt: null }
    });
  });

  it('waits for a human when triage says so, says nothing, or the report is unreadable', () => {
    expect(nextStepAfterRun(triaged('human'), loop)).toEqual({});
    expect(nextStepAfterRun(triaged(null), loop)).toEqual({});
    expect(nextStepAfterRun({ ...triaged('implement'), report: 'not json' }, loop)).toEqual({});
  });

  it('does nothing after a run that didn’t finish its stage', () => {
    expect(nextStepAfterRun({ ...triaged('implement'), outcome: 'needs_input' }, loop)).toEqual({});
    expect(nextStepAfterRun({ ...triaged('implement'), status: 'limit_hit', outcome: null }, loop)).toEqual({});
    expect(nextStepAfterRun({ ...finished, agent: 'implement', report: null }, loop)).toEqual({});
    expect(nextStepAfterRun({ ...finished, agent: 'spec', report: null }, loop)).toEqual({});
  });

  const question = { prompt: 'Store images where?', options: ['Disk', 'Blob'], suggested: 'Blob' };
  const asking = (agent: 'triage' | 'spec' | 'implement') => ({
    agent,
    status: 'finished' as const,
    outcome: 'needs_input' as const,
    report: { stage: agent, outcome: 'needs_input', summary: 'One question.', questions: [question] }
  });

  it('hands the questions a stage reported to the router to ask', () => {
    expect(nextStepAfterRun(asking('triage'), loop)).toEqual({
      questions: [{ prompt: 'Store images where?', topic: null, why: null, options: ['Blob', 'Disk'], keep: null }]
    });
  });

  it('asks a spec’s questions while it waits in Spec Review', () => {
    expect(nextStepAfterRun(asking('spec'), { ...loop, hasPr: true })).toEqual({
      stage: 'spec_review',
      questions: [{ prompt: 'Store images where?', topic: null, why: null, options: ['Blob', 'Disk'], keep: null }]
    });
  });

  it('ignores questions on a run that didn’t stop for input', () => {
    expect(nextStepAfterRun({ ...asking('implement'), outcome: 'blocked' }, loop)).toEqual({});
    expect(nextStepAfterRun({ ...asking('triage'), outcome: 'needs_input', report: { questions: [] } }, loop)).toEqual(
      {}
    );
  });

  it.each(['done', 'needs_input'] as const)('puts a spec with its PR open in Spec Review after %s', (outcome) => {
    expect(nextStepAfterRun({ ...finished, outcome, agent: 'spec', report: null }, { ...loop, hasPr: true })).toEqual({
      stage: 'spec_review'
    });
  });

  const fixable = {
    tier: 'should_fix',
    path: 'frontend/src/a.ts',
    line: 4,
    needsHuman: false,
    summary: 'Drop the cast.'
  };
  const forHuman = { ...fixable, needsHuman: true, summary: 'Pick the copy.' };
  const reviewed = (verdict: string | undefined, findings: unknown[] = []) => ({
    ...finished,
    agent: 'review' as const,
    report: { stage: 'review', outcome: 'done', summary: 'Reviewed.', verdict, findings }
  });

  it('hands an accepted PR to the merge gate and counts the round', () => {
    expect(nextStepAfterRun(reviewed('accepted'), { ...loop, hasPr: true })).toEqual({
      stage: 'awaiting_merge',
      reviewRounds: 1
    });
  });

  it('sends unambiguous findings back to implement with only those findings in the brief', () => {
    const step = nextStepAfterRun(reviewed('revision_needed', [fixable, forHuman, { junk: true }]), loop);
    expect(step).toMatchObject({
      stage: 'building',
      reviewRounds: 1,
      request: { agent: 'implement', trigger: 'review_findings', priority: 'in_flight' }
    });
    expect(step.request?.prompt).toBe(
      'Review round 1 found these for you to fix:\n1. [should_fix] frontend/src/a.ts:4: Drop the cast.'
    );
  });

  it('stops the loop at the round cap', () => {
    expect(nextStepAfterRun(reviewed('revision_needed', [fixable]), { ...loop, reviewRounds: 1 })).toEqual({
      stage: 'awaiting_merge',
      reviewRounds: 2
    });
  });

  it('gives a human the decision, a review with no verdict, and a revision with nothing to fix', () => {
    const toHuman = { stage: 'awaiting_merge', reviewRounds: 1 };
    expect(nextStepAfterRun(reviewed('human_decision_needed', [fixable]), loop)).toEqual(toHuman);
    expect(nextStepAfterRun(reviewed(undefined, [fixable]), loop)).toEqual(toHuman);
    expect(nextStepAfterRun(reviewed('revision_needed', [forHuman]), loop)).toEqual(toHuman);
  });

  it('asks the questions a review left for a human, but not while it sends the PR back for a revision', () => {
    const question = {
      prompt: 'Ship before the pages move?',
      options: ['Hold the PR', 'Accept the interim look'],
      suggested: 'Accept the interim look',
      keep: 'Accept the interim look'
    };
    const report = (verdict: string, findings: unknown[]) => ({
      ...reviewed(verdict, findings),
      report: { ...reviewed(verdict, findings).report, questions: [question] }
    });
    expect(nextStepAfterRun(report('human_decision_needed', [forHuman]), loop)).toEqual({
      stage: 'awaiting_merge',
      reviewRounds: 1,
      questions: [
        {
          prompt: 'Ship before the pages move?',
          topic: null,
          why: null,
          options: ['Accept the interim look', 'Hold the PR'],
          keep: 'Accept the interim look'
        }
      ]
    });
    expect(nextStepAfterRun(report('revision_needed', [fixable]), loop)).not.toHaveProperty('questions');
  });

  it('leaves a review that failed in In Review', () => {
    expect(nextStepAfterRun({ ...reviewed('accepted'), outcome: 'failed' }, loop)).toEqual({});
  });
});

describe('findingsPrompt', () => {
  it('lists each finding with its place and fix, clipped, and says how many it left out', () => {
    const many = Array.from({ length: 27 }, (_, index) => ({ summary: `Finding ${index + 1}.`, fix: 'x'.repeat(700) }));
    const prompt = findingsPrompt(2, many);
    expect(prompt.split('\n')[0]).toBe('Review round 2 found these for you to fix:');
    expect(prompt).toContain(`1. [finding]: Finding 1.\n   Fix: ${'x'.repeat(600)}…`);
    expect(prompt).not.toContain('Finding 26.');
    expect(prompt.endsWith("…and 2 more; the next review round checks what's left.")).toBe(true);
  });

  it('carries the guard a finding names', () => {
    const prompt = findingsPrompt(1, [
      {
        tier: 'should_fix',
        path: 'backend/recipes/views.py',
        line: 42,
        summary: 'Unscoped query.',
        fix: 'Filter.',
        guard: 'A test over every view.'
      }
    ]);
    expect(prompt).toContain(
      '1. [should_fix] backend/recipes/views.py:42: Unscoped query.\n   Fix: Filter.\n   Guard: A test over every view.'
    );
  });
});

describe('review rounds', () => {
  it('names the round a review does and the round a revision fixes', () => {
    expect(briefRound({ agent: 'review', trigger: 'delivered' }, 0)).toBe(1);
    expect(briefRound({ agent: 'implement', trigger: 'review_findings' }, 1)).toBe(1);
    expect(briefRound({ agent: 'implement', trigger: 'ci_failed' }, 1)).toBeUndefined();
  });

  it('starts a fresh loop only for implement work a human asked for', () => {
    const implement = { agent: 'implement' as const, priority: 'in_flight' as const, prompt: null };
    expect(startsReviewLoop({ ...implement, trigger: 'spec_approved' })).toBe(true);
    expect(startsReviewLoop({ ...implement, trigger: 'prompted' })).toBe(true);
    expect(startsReviewLoop({ ...implement, trigger: 'review_findings' })).toBe(false);
    expect(startsReviewLoop({ ...implement, trigger: 'rerun' })).toBe(false);
    expect(startsReviewLoop({ ...implement, agent: 'review', trigger: 'prompted' })).toBe(false);
  });
});

describe('CI failures', () => {
  const failure = { workflow: 'CI', url: 'https://github.com/milobedini/tastebook/actions/runs/1' };

  it('sends a failed check on a delivered PR back to implement with the run linked', () => {
    expect(decideCiFailure(failure, { stage: 'awaiting_merge', openRuns: 0, ciFixes: 0 })).toEqual({
      kind: 'fix',
      request: {
        agent: 'implement',
        trigger: 'ci_failed',
        priority: 'in_flight',
        prompt: 'The CI workflow failed on the PR: https://github.com/milobedini/tastebook/actions/runs/1'
      }
    });
  });

  it('leaves it while a run is going or before a PR is delivered', () => {
    expect(decideCiFailure(failure, { stage: 'in_review', openRuns: 1, ciFixes: 0 })).toEqual({ kind: 'ignore' });
    expect(decideCiFailure(failure, { stage: 'building', openRuns: 0, ciFixes: 0 })).toEqual({ kind: 'ignore' });
  });

  it('hands over after the capped number of fixes in a row', () => {
    expect(decideCiFailure(failure, { stage: 'in_review', openRuns: 0, ciFixes: 2 })).toEqual({ kind: 'hand_over' });
  });

  it('counts fixes since the last implement run something else asked for', () => {
    const run = (agent: 'implement' | 'review', trigger: 'ci_failed' | 'delivered' | 'spec_approved') => ({
      agent,
      trigger
    });
    expect(
      consecutiveCiFixes([
        run('review', 'delivered'),
        run('implement', 'ci_failed'),
        run('implement', 'ci_failed'),
        run('implement', 'spec_approved')
      ])
    ).toBe(2);
    expect(consecutiveCiFixes([run('implement', 'spec_approved'), run('implement', 'ci_failed')])).toBe(0);
    expect(consecutiveCiFixes([])).toBe(0);
  });
});

describe('retrying a run that never started', () => {
  const ended = {
    agent: 'review' as const,
    status: 'finished' as const,
    outcome: 'failed' as const,
    report: null,
    costUsd: null,
    durationMs: null
  };

  it('knows a run whose agent never started from one that failed while working', () => {
    expect(neverStarted(ended)).toBe(true);
    expect(neverStarted({ ...ended, durationMs: 90_000 })).toBe(true);
    expect(neverStarted({ ...ended, durationMs: 50 * 60_000 })).toBe(false);
    expect(neverStarted({ ...ended, costUsd: 0.4 })).toBe(false);
    expect(neverStarted({ ...ended, report: { outcome: 'failed' } })).toBe(false);
    expect(neverStarted({ ...ended, outcome: 'blocked' })).toBe(false);
  });

  it('retries once, and not a retry that failed the same way', () => {
    expect(shouldRetry(ended, undefined)).toBe(true);
    expect(shouldRetry(ended, { ...ended, outcome: 'done', report: {}, costUsd: 0.6, agent: 'implement' })).toBe(true);
    expect(shouldRetry(ended, ended)).toBe(false);
    expect(shouldRetry({ ...ended, costUsd: 1 }, undefined)).toBe(false);
  });

  it('says it is trying again, with the run log', () => {
    expect(retryText('review', 'https://github.com/o/r/actions/runs/1')).toBe(
      'The review run didn’t start: a setup step failed before the agent ran (<https://github.com/o/r/actions/runs/1|run log>). Trying again.'
    );
  });
});

describe('canRerun', () => {
  const open = { stage: 'building' as const, hasPr: false, reviewRounds: 0, maxReviewRounds: 2 };
  const run = (
    agent: 'triage' | 'implement' | 'review',
    status: 'finished' | 'limit_hit' | 'canceled' | 'running',
    outcome: 'done' | 'failed' | 'blocked' | 'stopped' | 'needs_input' | 'declined' | null,
    report: unknown = null
  ) => ({ agent, status, outcome, report });

  it.each([
    ['a failed run', run('implement', 'finished', 'failed')],
    ['a blocked run', run('implement', 'finished', 'blocked')],
    ['a stopped run', run('implement', 'finished', 'stopped')],
    ['a run that hit the limit', run('implement', 'limit_hit', null)],
    ['a canceled run', run('implement', 'canceled', null)],
    ['triage that named no next stage', run('triage', 'finished', 'done', { next: null })],
    ['implement that delivered no PR', run('implement', 'finished', 'done')]
  ])('allows %s', (_label, candidate) => {
    expect(canRerun(candidate, open)).toBe(true);
  });

  it.each([
    ['a run still going', run('implement', 'running', null), open],
    ['a question', run('implement', 'finished', 'needs_input'), open],
    ['a decline', run('triage', 'finished', 'declined'), open],
    ['triage that handed to a human', run('triage', 'finished', 'done', { next: 'human' }), open],
    ['a stage the router moved on from', run('implement', 'finished', 'done'), { ...open, hasPr: true }],
    [
      'a review',
      run('review', 'finished', 'done', { verdict: 'accepted' }),
      { ...open, stage: 'awaiting_merge' as const }
    ],
    ['a failed run on settled work', run('implement', 'finished', 'failed'), { ...open, stage: 'done' as const }]
  ])('refuses %s', (_label, candidate, workItem) => {
    expect(canRerun(candidate, workItem)).toBe(false);
  });
});

describe('slack timeline', () => {
  const issueUrl = 'https://linear.app/tastebook/issue/TAS-12';

  it('mirrors a reply on one line, escaped', () => {
    expect(slackReplyText('The tests pin <0.1.0>\n\n& shouldn’t.', issueUrl)).toBe(
      'Reply in Linear: “The tests pin &lt;0.1.0&gt; &amp; shouldn’t.”'
    );
  });

  it('clips a long reply and links to the rest', () => {
    const text = slackReplyText('x'.repeat(300), issueUrl);
    expect(text).toBe(`Reply in Linear: “${'x'.repeat(280)}…” <${issueUrl}|Read it all>`);
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

  it('points at the questions a run asked instead of its summary', () => {
    const asked = {
      agent: 'spec' as const,
      status: 'finished' as const,
      outcome: 'needs_input' as const,
      summary: 'Six questions before the spec.',
      prUrl: null,
      actionsRunUrl: 'https://github.com/milobedini/tastebook/actions/runs/2'
    };
    expect(slackFinishedText(asked, { questions: 6 })).toBe(
      'The spec run has 6 questions for you below. <https://github.com/milobedini/tastebook/actions/runs/2|run log>'
    );
    expect(slackFinishedText(asked, { questions: 1 })).toMatch(/^The spec run has a question for you below\./);
    expect(slackFinishedText(asked)).toMatch(/^The spec run needs an answer\. Six questions/);
    expect(slackFinishedText(asked, { gate: true })).toBe(
      'The spec run is waiting for your answer below. <https://github.com/milobedini/tastebook/actions/runs/2|run log>'
    );
    expect(slackFinishedText({ ...asked, summary: 'Spec in PR #12.' }, { specReview: true })).toBe(
      'The spec run finished: the spec is ready for review below. Spec in PR #12. <https://github.com/milobedini/tastebook/actions/runs/2|run log>'
    );
  });

  it('says a reply starts a blocked run again', () => {
    expect(
      slackFinishedText({
        agent: 'implement',
        status: 'finished',
        outcome: 'blocked',
        summary: 'The app needs the Workflows permission.',
        prUrl: null,
        actionsRunUrl: null
      })
    ).toBe(
      'The implement run is blocked. The app needs the Workflows permission. Reply here once that’s done and I’ll carry on.'
    );
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

describe('sameChanges', () => {
  const file = (filename: string, sha: string) => ({ filename, status: 'modified', sha });

  it('holds only when every file, lockfiles included, is as reviewed', () => {
    const reviewed = [file('frontend/src/main.tsx', 'a1'), file('pnpm-lock.yaml', 'l1')];
    expect(sameChanges(reviewed, [file('pnpm-lock.yaml', 'l1'), file('frontend/src/main.tsx', 'a1')])).toBe(true);
    expect(sameChanges(reviewed, [file('frontend/src/main.tsx', 'a1'), file('pnpm-lock.yaml', 'l2')])).toBe(false);
    expect(sameChanges(reviewed, [file('frontend/src/main.tsx', 'a1')])).toBe(false);
  });
});

describe('onlyLockfilesChanged', () => {
  const file = (filename: string, sha: string, status = 'modified') => ({ filename, status, sha });
  const reviewed = [file('frontend/src/main.tsx', 'a1'), file('pnpm-lock.yaml', 'l1'), file('backend/uv.lock', 'u1')];

  it('holds when only lockfiles differ from the reviewed files', () => {
    expect(onlyLockfilesChanged(reviewed, [file('pnpm-lock.yaml', 'l2'), file('frontend/src/main.tsx', 'a1')])).toBe(
      true
    );
  });

  it('compares diffs without their line numbers, so the base gaining lines elsewhere in a file still holds', () => {
    const doc = (sha: string, patch: string) => ({ ...file('AGENTS.md', sha), patch });
    expect(
      onlyLockfilesChanged([doc('d1', '@@ -10,3 +10,4 @@\n a\n+b\n c')], [doc('d2', '@@ -14,3 +14,4 @@\n a\n+b\n c')])
    ).toBe(true);
    expect(
      onlyLockfilesChanged([doc('d1', '@@ -10,3 +10,4 @@\n a\n+b\n c')], [doc('d2', '@@ -10,3 +10,4 @@\n a\n+B\n c')])
    ).toBe(false);
    expect(
      onlyLockfilesChanged(
        [doc('d1', '@@ -10,3 +10,4 @@ ## Domain areas\n a\n+b\n c')],
        [doc('d2', '@@ -40,3 +40,4 @@ ## Standards\n a\n+b\n c')]
      )
    ).toBe(false);
  });

  it('fails when reviewed code changed, appeared or went', () => {
    expect(onlyLockfilesChanged(reviewed, [file('frontend/src/main.tsx', 'a2'), file('pnpm-lock.yaml', 'l2')])).toBe(
      false
    );
    expect(
      onlyLockfilesChanged(reviewed, [
        file('frontend/src/main.tsx', 'a1'),
        file('frontend/src/extra.ts', 'e1', 'added')
      ])
    ).toBe(false);
    expect(onlyLockfilesChanged(reviewed, [file('pnpm-lock.yaml', 'l2')])).toBe(false);
  });
});

describe('reviewThreadsToResolve', () => {
  it("picks the review's own open threads and leaves people's", () => {
    expect(
      reviewThreadsToResolve([
        { id: 'a', isResolved: false, author: 'claude' },
        { id: 'b', isResolved: true, author: 'claude' },
        { id: 'c', isResolved: false, author: 'milobedini' },
        { id: 'd', isResolved: false, author: null }
      ])
    ).toEqual(['a']);
  });
});

describe('currentMergeable', () => {
  const heads = { baseHead: 'main2', prHead: 'pr1' };

  it('trusts a true whose test merge joins both heads', () => {
    expect(currentMergeable({ mergeable: true, testMergeParents: ['main2', 'pr1'], ...heads })).toBe(true);
  });

  it('treats a true from before either branch moved as not known yet', () => {
    expect(currentMergeable({ mergeable: true, testMergeParents: ['main1', 'pr1'], ...heads })).toBeNull();
    expect(currentMergeable({ mergeable: true, testMergeParents: ['main2', 'pr0'], ...heads })).toBeNull();
    expect(currentMergeable({ mergeable: true, testMergeParents: undefined, ...heads })).toBeNull();
  });

  it('passes false and null through', () => {
    expect(currentMergeable({ mergeable: false, testMergeParents: undefined, ...heads })).toBe(false);
    expect(currentMergeable({ mergeable: null, testMergeParents: undefined, ...heads })).toBeNull();
  });
});

describe('shouldBringUpToDate', () => {
  const waiting = { stage: 'awaiting_merge' as const, openRuns: 0, mergeable: true, behindBy: 2 };

  it('merges the base into a clean PR waiting at the merge gate behind it', () => {
    expect(shouldBringUpToDate(waiting)).toBe(true);
  });

  it('leaves a PR that is up to date, conflicts, has a run going or is still in review', () => {
    expect(shouldBringUpToDate({ ...waiting, behindBy: 0 })).toBe(false);
    expect(shouldBringUpToDate({ ...waiting, mergeable: false })).toBe(false);
    expect(shouldBringUpToDate({ ...waiting, mergeable: null })).toBe(false);
    expect(shouldBringUpToDate({ ...waiting, openRuns: 1 })).toBe(false);
    expect(shouldBringUpToDate({ ...waiting, stage: 'in_review' })).toBe(false);
  });
});

describe('newestMergedBase', () => {
  // reviewed ← m1 (merges main's b1) ← m2 (merges main's b2) = head
  const graph: Record<string, string[]> = {
    m2: ['m1', 'b2'],
    m1: ['reviewed', 'b1'],
    fix: ['reviewed'],
    octopus: ['reviewed', 'b1', 'b2'],
    side: ['reviewed', 'x1']
  };
  const onMain = new Set(['b1', 'b2']);
  const github = {
    parents: async (sha: string) => graph[sha] ?? [],
    onBase: async (sha: string) => onMain.has(sha)
  };

  it('finds the newest base commit merged in on the way from the reviewed commit', async () => {
    expect(await newestMergedBase('m1', 'reviewed', github)).toBe('b1');
    expect(await newestMergedBase('m2', 'reviewed', github)).toBe('b2');
  });

  it('gives nothing for the reviewed commit itself, or a commit that is not only a merge of the base', async () => {
    expect(await newestMergedBase('reviewed', 'reviewed', github)).toBeUndefined();
    expect(await newestMergedBase('fix', 'reviewed', github)).toBeUndefined();
    expect(await newestMergedBase('octopus', 'reviewed', github)).toBeUndefined();
    expect(await newestMergedBase('side', 'reviewed', github)).toBeUndefined();
  });

  it('stops after the limit of merges', async () => {
    expect(await newestMergedBase('m2', 'reviewed', github, 1)).toBeUndefined();
  });
});

describe('decideConflict', () => {
  it('sends a delivered PR that no longer merges back to implement', () => {
    expect(decideConflict({ branch: 'main' }, { stage: 'awaiting_merge', openRuns: 0, conflictFixes: 0 })).toEqual({
      kind: 'fix',
      request: {
        agent: 'implement',
        trigger: 'conflict',
        priority: 'in_flight',
        prompt: 'The PR conflicts with main. Merge origin/main into the branch and resolve the conflicts.'
      }
    });
  });

  it('leaves it while a run is going or before a PR is delivered', () => {
    expect(decideConflict({ branch: 'main' }, { stage: 'in_review', openRuns: 1, conflictFixes: 0 })).toEqual({
      kind: 'ignore'
    });
    expect(decideConflict({ branch: 'main' }, { stage: 'spec_review', openRuns: 0, conflictFixes: 0 })).toEqual({
      kind: 'ignore'
    });
  });

  it('hands over once this state of the default branch has had its attempt', () => {
    expect(decideConflict({ branch: 'main' }, { stage: 'awaiting_merge', openRuns: 0, conflictFixes: 1 })).toEqual({
      kind: 'hand_over'
    });
    expect(conflictHandOverText('main', 'https://github.com/milobedini/tastebook/pull/14')).toBe(
      'The PR still conflicts with main after I tried to resolve it, so I’ve stopped there; it needs a look: https://github.com/milobedini/tastebook/pull/14'
    );
  });

  it('counts conflict fixes made since the default branch last moved', () => {
    const moved = new Date('2026-10-26T09:00:00Z');
    const run = (
      trigger: 'conflict' | 'ci_failed',
      minutesAfter: number,
      agent: 'implement' | 'review' = 'implement'
    ) => ({
      agent,
      trigger,
      createdAt: new Date(moved.getTime() + minutesAfter * 60_000)
    });
    expect(conflictFixesSince([run('conflict', -5), run('conflict', 2), run('ci_failed', 3)], moved)).toBe(1);
    expect(conflictFixesSince([run('conflict', -5)], moved)).toBe(0);
  });
});

describe('failedChecks', () => {
  const run = (workflowId: number, name: string, conclusion: string | null, event = 'pull_request') => ({
    id: workflowId * 10,
    workflowId,
    name,
    event,
    conclusion,
    url: `https://github.com/o/r/actions/runs/${workflowId}-${conclusion}`
  });

  it('names each check whose latest run on the commit failed, preview checks included', () => {
    expect(
      failedChecks([
        run(1, 'CI', 'success'),
        run(2, 'Preview checks', 'failure', 'deployment_status'),
        run(1, 'CI', 'failure')
      ])
    ).toEqual([{ runId: 20, workflow: 'Preview checks', url: 'https://github.com/o/r/actions/runs/2-failure' }]);
  });

  it('ignores stage runs, unfinished checks and skipped ones', () => {
    expect(
      failedChecks([
        run(3, 'Factory', 'failure', 'repository_dispatch'),
        run(1, 'CI', null),
        run(2, 'Preview checks', 'skipped', 'deployment_status')
      ])
    ).toEqual([]);
  });
});

describe('queuedAlready', () => {
  const verify = { agent: 'verify', trigger: 'delivered', priority: 'in_flight', prompt: null } as const;

  // TAS-40, 27 Oct: a conflict fix and an answer's revision each handed on to verify, so two verify and review rounds
  // ran on the same commit.
  it('drops a verify or review when one is already queued for the work item', () => {
    expect(queuedAlready(verify, [{ agent: 'verify' }])).toBe(true);
    expect(queuedAlready({ ...verify, agent: 'review' }, [{ agent: 'review' }])).toBe(true);
  });

  it('keeps it when only other stages are queued', () => {
    expect(queuedAlready(verify, [])).toBe(false);
    expect(queuedAlready(verify, [{ agent: 'review' }])).toBe(false);
  });

  // TAS-43, 27 Oct: a review round's answers and its Fix box could each start a revision; the first to finish would
  // have sent half the changes to review.
  it('leaves the hand-on to an implement run still queued, so one review sees both changes', () => {
    expect(queuedAlready({ ...verify, agent: 'review' }, [{ agent: 'implement' }])).toBe(true);
    expect(queuedAlready(verify, [{ agent: 'implement' }])).toBe(true);
  });

  it('keeps any other kind of run, which carries its own request', () => {
    expect(
      queuedAlready({ agent: 'implement', trigger: 'review_findings', priority: 'in_flight', prompt: 'Fix' }, [
        { agent: 'implement' }
      ])
    ).toBe(false);
  });
});
