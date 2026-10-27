import type { CardInput, CardSummary } from './card';
import { cardSummary, linkButton, STATUS_EMOJI } from './card';
import type { ReadyIssue } from './ready';
import { formatReleaseAt } from './router';
import type { SlackBlock, SlackMessage } from './slack';
import { button, escapeSlack, issueMetaText, needsSizeText, slackEmoji } from './slack';
import type { UsageSummary, WindowSummary } from './usage';

// The app's Home tab in Slack: what needs the viewer, what's running, what's ready to start, the scheduled checks and
// the week, published for each allowed person when they open it.

export type HomeCheck = {
  title: string;
  state: CheckState;
  // Issues the latest run filed.
  filed: number;
  // Its findings that never reached Linear, so a check whose filing failed doesn't read as clean.
  unfiled: number;
  // What it couldn't check, such as an audit tool that failed.
  gaps: number;
  lastAt: Date | null;
  nextAt: Date | null;
  runUrl: string | null;
};

export type CheckState = 'clean' | 'filed' | 'unfiled' | 'failed' | 'running' | 'none';

// A check's latest run, as the Home tab shows it: findings Linear refused outweigh the ones it filed.
export const checkState = (
  run: { status: string; outcome: string | null; open: boolean } | undefined,
  { filed, unfiled }: { filed: number; unfiled: number }
): CheckState =>
  !run
    ? 'none'
    : run.open
      ? 'running'
      : run.status !== 'finished' || run.outcome !== 'done'
        ? 'failed'
        : unfiled > 0
          ? 'unfiled'
          : filed > 0
            ? 'filed'
            : 'clean';

export type HomeInput = {
  alias: string;
  channelId: string | null;
  consoleUrl: string;
  now: Date;
  timeZone: string;
  emojiPrefix: string;
  usage: UsageSummary;
  paused: { by: string; at: Date } | null;
  // Every unsettled work item, as its card would be drawn.
  items: CardInput[];
  // Null when Linear couldn't be read.
  ready: ReadyIssue[] | null;
  // Unassigned issues that can't be ready until someone sizes them.
  needsSize: ReadyIssue[];
  checks: HomeCheck[];
  // Warnings and errors the console logged in the last day.
  problems: number;
  week: { merged: number; runs: number; failed: number; costUsd: number | null };
};

export type HomeView = { type: 'home'; blocks: SlackBlock[] };

// Slack allows 100 blocks in a Home tab; each list is capped, with the console for the rest.
export const MAX_HOME_ROWS = 8;
const MAX_HOME_BLOCKS = 100;

const NEEDS_YOU: CardSummary['status'][] = ['waiting', 'blocked', 'ready'];

const header = (text: string): SlackBlock => ({ type: 'header', text: { type: 'plain_text', text } });

const section = (text: string, accessory?: SlackBlock): SlackBlock => ({
  type: 'section',
  text: { type: 'mrkdwn', text },
  ...(accessory ? { accessory } : {})
});

const context = (text: string): SlackBlock => ({ type: 'context', elements: [{ type: 'mrkdwn', text }] });

const divider: SlackBlock = { type: 'divider' };

const clip = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

const plural = (count: number, word: string, words = `${word}s`): string => `${count} ${count === 1 ? word : words}`;

export const clock = (at: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);

const CELLS = 10;

// Usage as ten cells, so a glance says how full the window is.
export const usageBar = (fraction: number): string => {
  const filled = Math.round(Math.min(Math.max(fraction, 0), 1) * CELLS);
  return `${'▰'.repeat(filled)}${'▱'.repeat(CELLS - filled)}`;
};

const WINDOW_NAMES: Record<WindowSummary['window'], string> = { fiveHour: '5-hour window', sevenDay: 'Week' };

const windowText = (window: WindowSummary, { now, timeZone }: HomeInput): string => {
  const percent = Math.round(window.utilisation * 100);
  const state =
    window.utilisation >= window.pauseAt
      ? 'New work waits for the reset.'
      : window.throttleAt !== null && window.utilisation >= window.throttleAt
        ? 'Only work in flight runs.'
        : window.stale
          ? 'The reading is stale.'
          : undefined;
  const resets = window.resetsAt ? `Resets ${formatReleaseAt(window.resetsAt, now, timeZone)}.` : undefined;
  return [
    `*${WINDOW_NAMES[window.window]}* ${percent}%`,
    usageBar(window.utilisation),
    [resets, state].filter((part) => part !== undefined).join(' ')
  ]
    .filter((line) => line.length > 0)
    .join('\n');
};

type Row = { input: CardInput; summary: CardSummary };

const itemRow = ({ input, summary }: Row): SlackBlock => {
  const { workItem, emojiPrefix } = input;
  const title = workItem.title ? ` ${escapeSlack(clip(workItem.title, 90))}` : '';
  const [action] = summary.buttons;
  return section(
    `${slackEmoji(emojiPrefix, STATUS_EMOJI[summary.status])} *<${workItem.url}|${escapeSlack(workItem.identifier)}>*${title}\n${summary.line}`,
    action
  );
};

const latestRunAt = ({ input }: Row): number => input.runs.at(-1)?.createdAt.getTime() ?? 0;

const waitingSince = ({ input, summary }: Row): number =>
  summary.entry?.since.getTime() ?? input.workItem.updatedAt.getTime();

const listSection = (title: string, rows: SlackBlock[], empty: string, more: string | undefined): SlackBlock[] => [
  divider,
  section(`*${title}*${rows.length > 0 ? ` · ${rows.length}` : ''}`),
  ...(rows.length > 0 ? rows.slice(0, MAX_HOME_ROWS) : [context(empty)]),
  ...(rows.length > MAX_HOME_ROWS && more ? [context(more)] : [])
];

const readyRow = (issue: ReadyIssue, emojiPrefix: string): SlackBlock =>
  section(
    `<${issue.url}|${escapeSlack(issue.identifier)}> ${escapeSlack(clip(issue.title, 90))}\n${issueMetaText(
      issue,
      emojiPrefix
    )}`,
    button('delegate', 'Delegate', { d: [issue.identifier] })
  );

const CHECK_EMOJI: Record<CheckState, string> = {
  clean: 'done',
  filed: 'needs-you',
  unfiled: 'warning',
  failed: 'blocked',
  running: 'running',
  none: 'todo'
};

const checkRow = (check: HomeCheck, { now, timeZone, emojiPrefix }: HomeInput): SlackBlock => {
  const at = check.lastAt ? formatReleaseAt(check.lastAt, now, timeZone) : '';
  const alsoFiled = check.filed > 0 ? `; filed ${plural(check.filed, 'issue')} in Triage` : '';
  const last = {
    clean: check.gaps > 0 ? `Nothing to file at ${at}` : `Clean at ${at}`,
    filed: `Filed ${plural(check.filed, 'issue')} in Triage at ${at}`,
    unfiled: `Couldn’t file ${plural(check.unfiled, 'finding')} in Linear at ${at}${alsoFiled}`,
    failed: `Failed at ${at}`,
    running: 'Running now',
    none: 'Not run yet'
  }[check.state];
  const finished = check.state === 'clean' || check.state === 'filed' || check.state === 'unfiled';
  const gaps = finished && check.gaps > 0 ? ', but not everything was checked' : '';
  const emoji = check.state === 'clean' && check.gaps > 0 ? 'warning' : CHECK_EMOJI[check.state];
  const next = check.nextAt ? ` · next ${formatReleaseAt(check.nextAt, now, timeZone)}` : '';
  return section(
    `${slackEmoji(emojiPrefix, emoji)} *${escapeSlack(check.title)}*\n${last}${gaps}${next}`,
    check.runUrl ? linkButton('check_log', 'Run log', check.runUrl) : undefined
  );
};

const healthRow = ({ problems, emojiPrefix }: HomeInput): SlackBlock =>
  section(
    `${slackEmoji(emojiPrefix, problems > 0 ? 'warning' : 'done')} *Factory health*\n${
      problems > 0
        ? `${plural(problems, 'warning or error', 'warnings and errors')} in the last day; the 07:00 check lists them.`
        : 'No warnings or errors in the last day.'
    }`
  );

const field = (text: string) => ({ type: 'mrkdwn', text });

// What needs the viewer (longest waiting first) and what's in flight (oldest first), with the counts both lead with.
const sortRows = (input: HomeInput) => {
  const rows = input.items.map((item): Row => ({ input: item, summary: cardSummary(item) }));
  const needsYou = rows
    .filter(({ summary }) => NEEDS_YOU.includes(summary.status))
    .toSorted((a, b) => waitingSince(a) - waitingSince(b));
  const inFlight = rows
    .filter(({ summary }) => summary.status === 'running' || summary.status === 'queued')
    .toSorted((a, b) => latestRunAt(a) - latestRunAt(b));
  const queued = inFlight.filter(({ summary }) => summary.status === 'queued').length;
  const counts = [
    `${inFlight.length - queued} running`,
    ...(queued > 0 ? [`${queued} queued`] : []),
    `${needsYou.length} need${needsYou.length === 1 ? 's' : ''} you`
  ];
  return { needsYou, inFlight, counts };
};

const pausedText = ({ paused, timeZone }: HomeInput): string | undefined =>
  paused ? `*Paused* by ${escapeSlack(paused.by)} since ${clock(paused.at, timeZone)}: nothing new starts.` : undefined;

export const homeView = (input: HomeInput): HomeView => {
  const { now, timeZone, consoleUrl, week, paused } = input;
  const { needsYou, inFlight, counts } = sortRows(input);
  const windows = input.usage.windows.map((window) => field(windowText(window, input)));
  const status = [`Updated ${clock(now, timeZone)}`, ...counts].join(' · ');
  const pausedLine = pausedText(input);
  const controls = [
    linkButton('console_open', 'Open the console', consoleUrl),
    paused
      ? button('home_resume', 'Resume the factory', { h: 'resume' }, true)
      : {
          ...button('home_pause', 'Pause the factory', { h: 'pause' }),
          confirm: {
            title: { type: 'plain_text', text: 'Pause the factory?' },
            text: { type: 'plain_text', text: 'Nothing new starts until it’s resumed. Running stages finish.' },
            confirm: { type: 'plain_text', text: 'Pause' },
            deny: { type: 'plain_text', text: 'Cancel' }
          }
        },
    button('home_refresh', 'Refresh', { h: 'refresh' })
  ];
  const blocks: SlackBlock[] = [
    header(`${input.alias} factory`),
    context(status),
    ...(pausedLine ? [section(pausedLine)] : []),
    ...(windows.length > 0 ? [{ type: 'section', fields: windows }] : []),
    { type: 'actions', elements: controls },
    ...listSection(
      'Needs you',
      needsYou.map(itemRow),
      'Nothing is waiting on you.',
      `The rest are on the <${consoleUrl}/inbox|Inbox>.`
    ),
    ...listSection(
      'In flight',
      inFlight.map(itemRow),
      'Nothing is running.',
      `The rest are on <${consoleUrl}/runs|Runs>.`
    ),
    ...listSection(
      'Ready to delegate',
      input.ready === null ? [] : input.ready.map((issue) => readyRow(issue, input.emojiPrefix)),
      input.ready === null ? 'I couldn’t read Linear just now. Refresh in a minute.' : 'Nothing is ready to start.',
      `The rest are on the <${consoleUrl}/inbox|Inbox>.`
    ),
    ...(input.ready && input.ready.length > 0
      ? [
          context(
            `Delegating assigns the issue to you and starts it, like delegating to @${escapeSlack(input.alias)} in Linear.`
          )
        ]
      : []),
    ...(input.needsSize.length > 0 ? [context(needsSizeText(input.needsSize))] : []),
    divider,
    section('*Checks*'),
    ...input.checks.map((check) => checkRow(check, input)),
    healthRow(input),
    divider,
    section('*Last 7 days*'),
    {
      type: 'section',
      fields: [
        field(`*Merged*\n${week.merged}`),
        field(`*Runs*\n${week.runs}${week.failed > 0 ? ` · ${week.failed} failed` : ''}`),
        field(`*Cost*\n${week.costUsd === null ? 'Not reported' : `$${week.costUsd.toFixed(2)} API-equivalent`}`)
      ]
    },
    ...(input.channelId
      ? [context(`Mention @${escapeSlack(input.alias)} in <#${input.channelId}> to file a request.`)]
      : [])
  ];
  return { type: 'home', blocks: blocks.slice(0, MAX_HOME_BLOCKS) };
};

// For someone who isn't one of the factory's people: the Home tab says so rather than showing the work.
export const homeNotAllowedView = (alias: string): HomeView => ({
  type: 'home',
  blocks: [
    header(`${alias} factory`),
    section(`Only the people listed for ${escapeSlack(alias)} can see its work here. Ask one of them to add you.`)
  ]
});

const windowShort = (window: WindowSummary): string =>
  `${WINDOW_NAMES[window.window]} ${Math.round(window.utilisation * 100)}%`;

// The slash command's `status`: the hub's counts and what needs the person, each with its action, in a reply only they
// see, with links to the hub and the console for the rest.
export const slackStatusMessage = (input: HomeInput, hubUrl: string): SlackMessage => {
  const { needsYou, counts } = sortRows(input);
  const pausedLine = pausedText(input);
  const usage = input.usage.windows.map(windowShort).join(' · ');
  const more = needsYou.length > MAX_HOME_ROWS ? `${needsYou.length - MAX_HOME_ROWS} more on the hub. ` : '';
  return {
    text: `${input.alias}: ${counts.join(', ')}`,
    blocks: [
      section(`*${escapeSlack(input.alias)} factory* · ${counts.join(' · ')}`),
      ...(usage ? [context(usage)] : []),
      ...(pausedLine ? [section(pausedLine)] : []),
      ...(needsYou.length > 0
        ? needsYou.slice(0, MAX_HOME_ROWS).map(itemRow)
        : [context('Nothing is waiting on you.')]),
      context(`${more}<${hubUrl}|Open the hub> · <${input.consoleUrl}|Open the console>`)
    ]
  };
};
