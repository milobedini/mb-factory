import { describe, expect, it } from 'vitest';

import type { CardInput, CardRun } from './card';
import type { HomeCheck, HomeInput } from './home';
import { checkState, homeNotAllowedView, homeView, MAX_HOME_ROWS, slackStatusMessage, usageBar } from './home';
import type { SlackBlock } from './slack';
import type { UsageSummary } from './usage';

const at = (minute: number): Date => new Date(Date.UTC(2026, 9, 27, 10, minute));

const run = (overrides: Partial<CardRun> = {}): CardRun => ({
  id: '11111111-1111-4111-8111-111111111111',
  agent: 'triage',
  trigger: 'delegated',
  status: 'finished',
  outcome: 'done',
  summary: null,
  costUsd: 0.25,
  durationMs: 60_000,
  createdAt: at(0),
  dispatchedAt: at(0),
  startedAt: at(1),
  finishedAt: at(2),
  actionsRunUrl: null,
  ...overrides
});

const item = (identifier: string, stage: CardInput['workItem']['stage'], runs: CardRun[]): CardInput => ({
  workItem: {
    id: '22222222-2222-4222-8222-222222222222',
    identifier,
    url: `https://linear.app/t/${identifier}`,
    title: `Work on ${identifier}`,
    stage,
    repository: 'milobedini/tastebook',
    branch: null,
    prNumber: stage === 'awaiting_merge' ? 38 : null,
    estimate: 3,
    reviewRounds: 0,
    updatedAt: at(5),
    project: null,
    milestone: null,
    assignee: null
  },
  runs,
  round: [],
  hold: null,
  gate: undefined,
  rerunnable: false,
  questionsUrl: null,
  next: [],
  now: at(30),
  timeZone: 'Europe/London',
  emojiPrefix: 'tb'
});

const usage: UsageSummary = {
  state: 'open',
  stale: [],
  windows: [
    {
      window: 'fiveHour',
      utilisation: 0.82,
      resetsAt: at(240),
      takenAt: at(20),
      source: 'probe',
      stale: false,
      reset: false,
      throttleAt: 0.8,
      pauseAt: 0.95,
      paceLimit: null
    },
    {
      window: 'sevenDay',
      utilisation: 0.41,
      resetsAt: new Date(Date.UTC(2026, 10, 2, 9, 0)),
      takenAt: at(20),
      source: 'probe',
      stale: false,
      reset: false,
      throttleAt: null,
      pauseAt: 0.95,
      paceLimit: 0.5
    }
  ]
} as UsageSummary;

const input = (overrides: Partial<HomeInput> = {}): HomeInput => ({
  alias: 'Tastebook',
  channelId: 'C0CBSE2Q6FQ',
  consoleUrl: 'https://console.test',
  now: at(30),
  timeZone: 'Europe/London',
  emojiPrefix: 'tb',
  usage,
  paused: null,
  items: [],
  ready: [],
  checks: [],
  problems: 0,
  week: { merged: 9, runs: 41, failed: 3, costUsd: 38.2 },
  ...overrides
});

const check = (overrides: Partial<HomeCheck> = {}): HomeCheck => ({
  title: 'Security, daily',
  state: 'clean',
  filed: 0,
  unfiled: 0,
  gaps: 0,
  lastAt: at(-240),
  nextAt: null,
  runUrl: null,
  ...overrides
});

const texts = (blocks: SlackBlock[]): string[] =>
  blocks.flatMap((block) => {
    const text = (block.text as { text?: string } | undefined)?.text;
    const elements = block.type === 'context' ? ((block.elements as { text: string }[] | undefined) ?? []) : [];
    const fields = (block.fields as { text: string }[] | undefined) ?? [];
    return [text, ...elements.map((element) => element.text), ...fields.map(({ text: t }) => t)].filter(
      (value) => value !== undefined
    );
  });

const rowsUnder = (blocks: SlackBlock[], heading: string): string[] => {
  const all = texts(blocks);
  const start = all.findIndex((text) => text.startsWith(`*${heading}*`));
  return all.slice(start + 1, start + 4);
};

describe('homeView', () => {
  it('sorts work into what needs you and what is in flight, each with its card’s line and first action', () => {
    const view = homeView(
      input({
        items: [
          item('TAS-39', 'building', [run(), run({ agent: 'implement', status: 'running', finishedAt: null })]),
          item('TAS-41', 'awaiting_merge', [run(), run({ agent: 'implement' }), run({ agent: 'review' })]),
          item('TAS-38', 'spec_review', [run(), run({ agent: 'spec' })])
        ]
      })
    );
    expect(texts(view.blocks)).toContain('*Needs you* · 2');
    expect(rowsUnder(view.blocks, 'Needs you')[0]).toBe(
      ':tb-done: *<https://linear.app/t/TAS-41|TAS-41>* Work on TAS-41\n*Ready to merge:* PR #38 waits for your approval on GitHub.'
    );
    expect(rowsUnder(view.blocks, 'In flight')[0]).toMatch(
      /^:tb-running: \*<https:\/\/linear.app\/t\/TAS-39\|TAS-39>\*/
    );
    const spec = view.blocks.find((block) => texts([block])[0]?.includes('TAS-38'));
    expect(spec?.accessory).toMatchObject({ text: { text: 'Approve' } });
  });

  it('says how full each usage window is, and what the governor does about it', () => {
    const view = homeView(input());
    expect(texts(view.blocks)).toEqual(
      expect.arrayContaining([
        '*5-hour window* 82%\n▰▰▰▰▰▰▰▰▱▱\nResets 14:00. Only work in flight runs.',
        '*Week* 41%\n▰▰▰▰▱▱▱▱▱▱\nResets Mon 2 Nov, 09:00.'
      ])
    );
  });

  it('offers Pause with a confirmation, or Resume while paused', () => {
    const controls = (view: ReturnType<typeof homeView>) =>
      ((view.blocks.find((block) => block.type === 'actions')?.elements as SlackBlock[] | undefined) ?? []).map(
        (element) => (element.text as { text: string }).text
      );
    expect(controls(homeView(input()))).toEqual(['Open the console', 'Pause the factory', 'Refresh']);
    const actions = homeView(input()).blocks.find((block) => block.type === 'actions');
    const pause = ((actions?.elements as SlackBlock[] | undefined) ?? [])[1];
    expect(pause?.confirm).toMatchObject({ title: { text: 'Pause the factory?' } });
    const paused = homeView(input({ paused: { by: 'Milo in Slack', at: at(20) } }));
    expect(controls(paused)).toEqual(['Open the console', 'Resume the factory', 'Refresh']);
    expect(texts(paused.blocks)).toContain('*Paused* by Milo in Slack since 10:20: nothing new starts.');
  });

  it('lists ready issues with a Delegate button, or says Linear couldn’t be read', () => {
    const ready = [
      {
        id: 'i',
        identifier: 'TAS-47',
        title: 'Filter by diet',
        url: 'https://l/47',
        project: 'Real recipes',
        size: 'M',
        assignee: null,
        blockedBy: [],
        waitingOn: []
      }
    ];
    const view = homeView(input({ ready }));
    expect(rowsUnder(view.blocks, 'Ready to delegate')[0]).toBe(
      '<https://l/47|TAS-47> Filter by diet\n:tb-size-m: Medium · Real recipes'
    );
    expect(texts(homeView(input({ ready: null })).blocks)).toContain(
      'I couldn’t read Linear just now. Refresh in a minute.'
    );
  });

  it('shows each check’s last result and next run, and the console’s health', () => {
    const view = homeView(
      input({
        problems: 6,
        checks: [
          check({ title: 'Security, daily', nextAt: at(1200) }),
          check({ title: 'Docs, daily', state: 'filed', filed: 1, lastAt: at(-210), runUrl: 'https://gh/1' })
        ]
      })
    );
    expect(rowsUnder(view.blocks, 'Checks')).toEqual([
      ':tb-done: *Security, daily*\nClean at 06:00 · next Wed 28 Oct, 06:00',
      ':tb-needs-you: *Docs, daily*\nFiled 1 issue in Triage at 06:30',
      ':tb-warning: *Factory health*\n6 warnings and errors in the last day; the 07:00 check lists them.'
    ]);
  });

  it('warns when findings never reached Linear, or not everything was checked', () => {
    const view = homeView(
      input({
        checks: [
          check({ title: 'Security, daily', state: 'unfiled', unfiled: 5 }),
          check({ title: 'Docs, daily', state: 'unfiled', unfiled: 1, filed: 2, gaps: 1 }),
          check({ title: 'Security, weekly', gaps: 1 })
        ]
      })
    );
    expect(rowsUnder(view.blocks, 'Checks')).toEqual([
      ':tb-warning: *Security, daily*\nCouldn’t file 5 findings in Linear at 06:00',
      ':tb-warning: *Docs, daily*\nCouldn’t file 1 finding in Linear at 06:00; filed 2 issues in Triage, but not everything was checked',
      ':tb-warning: *Security, weekly*\nNothing to file at 06:00, but not everything was checked'
    ]);
  });

  it('caps each list and points at the console for the rest', () => {
    const running = Array.from({ length: MAX_HOME_ROWS + 2 }, (_, index) =>
      item(`TAS-${index}`, 'building', [run({ agent: 'implement', status: 'running', finishedAt: null })])
    );
    const view = homeView(input({ items: running }));
    expect(texts(view.blocks)).toContain(`*In flight* · ${MAX_HOME_ROWS + 2}`);
    expect(texts(view.blocks)).toContain('The rest are on <https://console.test/runs|Runs>.');
    expect(view.blocks.length).toBeLessThanOrEqual(100);
  });

  it('sums up the last seven days', () => {
    expect(texts(homeView(input()).blocks)).toEqual(
      expect.arrayContaining(['*Merged*\n9', '*Runs*\n41 · 3 failed', '*Cost*\n$38.20 API-equivalent'])
    );
  });
});

describe('usageBar', () => {
  it('fills a cell per tenth, within bounds', () => {
    expect(usageBar(0)).toBe('▱▱▱▱▱▱▱▱▱▱');
    expect(usageBar(0.46)).toBe('▰▰▰▰▰▱▱▱▱▱');
    expect(usageBar(1.3)).toBe('▰▰▰▰▰▰▰▰▰▰');
  });
});

describe('homeNotAllowedView', () => {
  it('says who can see the work', () => {
    expect(texts(homeNotAllowedView('Tastebook').blocks)).toContain(
      'Only the people listed for Tastebook can see its work here. Ask one of them to add you.'
    );
  });
});

describe('slackStatusMessage', () => {
  const hub = 'slack://app?team=T1&id=A1&tab=home';

  it('leads with the hub’s counts and usage, then what needs you with its action', () => {
    const message = slackStatusMessage(
      input({
        items: [
          item('TAS-39', 'building', [run(), run({ agent: 'implement', status: 'running', finishedAt: null })]),
          item('TAS-38', 'spec_review', [run(), run({ agent: 'spec' })])
        ]
      }),
      hub
    );
    expect(message.text).toBe('Tastebook: 1 running, 1 needs you');
    expect(texts(message.blocks).slice(0, 2)).toEqual([
      '*Tastebook factory* · 1 running · 1 needs you',
      '5-hour window 82% · Week 41%'
    ]);
    const spec = message.blocks.find((block) => texts([block])[0]?.includes('TAS-38'));
    expect(spec?.accessory).toMatchObject({ text: { text: 'Approve' } });
    expect(texts(message.blocks).some((text) => text.includes('TAS-39'))).toBe(false);
    expect(texts(message.blocks).at(-1)).toBe(`<${hub}|Open the hub> · <https://console.test|Open the console>`);
  });

  it('says when nothing waits, when it’s paused, and how many more are on the hub', () => {
    const quiet = texts(slackStatusMessage(input({ paused: { by: 'Milo in Slack', at: at(10) } }), hub).blocks);
    expect(quiet).toContain('Nothing is waiting on you.');
    expect(quiet).toContain('*Paused* by Milo in Slack since 10:10: nothing new starts.');
    const waiting = Array.from({ length: MAX_HOME_ROWS + 3 }, (_, index) =>
      item(`TAS-${index}`, 'spec_review', [run(), run({ agent: 'spec' })])
    );
    expect(texts(slackStatusMessage(input({ items: waiting }), hub).blocks).at(-1)).toMatch(/^3 more on the hub\. /);
  });
});

describe('checkState', () => {
  const done = { status: 'finished', outcome: 'done', open: false };

  it('reads a finished run by what reached Linear', () => {
    expect(checkState(done, { filed: 0, unfiled: 0 })).toBe('clean');
    expect(checkState(done, { filed: 2, unfiled: 0 })).toBe('filed');
    expect(checkState(done, { filed: 2, unfiled: 1 })).toBe('unfiled');
  });

  it('says when it never ran, is running or failed', () => {
    expect(checkState(undefined, { filed: 0, unfiled: 0 })).toBe('none');
    expect(checkState({ status: 'running', outcome: null, open: true }, { filed: 0, unfiled: 0 })).toBe('running');
    expect(checkState({ status: 'finished', outcome: 'failed', open: false }, { filed: 0, unfiled: 3 })).toBe('failed');
    expect(checkState({ status: 'limit_hit', outcome: null, open: false }, { filed: 0, unfiled: 0 })).toBe('failed');
  });
});
