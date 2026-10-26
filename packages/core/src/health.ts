import type { Job } from './config';
import { nextSlot, slotDay } from './jobs';
import type { RunStatus } from './runs';
import { DISPATCH_LAPSE_MINUTES } from './runs';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// The daily health check fires through the job slots under this name, so no scheduled job may take it.
export const HEALTH_JOB = 'health';

// How long the console keeps its warnings and errors, and how far back a message counts as seen before.
export const PROBLEM_RETENTION_DAYS = 30;
export const NEW_PROBLEM_DAYS = 14;

// A dispatched run that never called `/start` should have been ended by the governor tick; one running past the
// stage workflow's 60-minute timeout lost its report. A queued run with no hold was dropped on its way to the governor.
const RUNNING_MINUTES = 70;
const QUEUED_MINUTES = 15;
// Held work and job slots get this long past their moment before they count as late.
const LATE_MINUTES = 15;

const MAX_LINES = 10;
const MAX_DETAIL = 160;

export const PROBLEM_LEVELS = ['warn', 'error'] as const;

export type ProblemLevel = (typeof PROBLEM_LEVELS)[number];

// The hour a problem is counted under: one row per message an hour keeps the table small whatever arrives.
export const problemHour = (at: Date): Date => new Date(Math.floor(at.getTime() / (60 * MINUTE_MS)) * 60 * MINUTE_MS);

// Warnings and errors with one message, added up since the last check; `fields` are the latest line's.
export type ProblemGroup = { level: ProblemLevel; message: string; count: number; lastAt: Date; fields: unknown };

export type OpenRun = {
  // The issue identifier, or the job's name for a scheduled run.
  label: string;
  agent: string;
  status: RunStatus;
  createdAt: Date;
  dispatchedAt: Date | null;
  startedAt: Date | null;
  held: boolean;
};

export type HeldRun = { label: string; agent: string; releaseAt: Date };

export type FiredSlot = { job: string; slotAt: Date; firedAt: Date };

// A scheduled GitHub Actions run in one of the project's repos, such as a nightly backup.
export type ScheduledRun = {
  repository: string;
  workflow: string;
  conclusion: string | null;
  createdAt: Date;
  url: string;
};

// What counts as a failed run; a cancelled one was stopped on purpose.
const FAILED_CONCLUSIONS = ['failure', 'timed_out', 'startup_failure'];

export type HealthInput = {
  now: Date;
  since: Date;
  timeZone: string;
  problems: ProblemGroup[];
  // Messages logged in the `NEW_PROBLEM_DAYS` before `since`.
  knownMessages: string[];
  openRuns: OpenRun[];
  heldRuns: HeldRun[];
  // Every daily slot, the health check's own included.
  jobs: Pick<Job, 'name' | 'at' | 'day'>[];
  slots: FiredSlot[];
  // Scheduled runs created since `since`.
  scheduledRuns: ScheduledRun[];
};

export type HealthReport = {
  errors: string[];
  warnings: string[];
  runs: string[];
  held: string[];
  slots: string[];
  workflows: string[];
};

const clip = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

const escapeSlack = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const minutesBetween = (from: Date, to: Date): number => Math.floor((to.getTime() - from.getTime()) / MINUTE_MS);

export const formatMinutes = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  if (hours === 0) {
    return `${minutes} min`;
  }
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
};

const clockTime = (at: Date, timeZone: string): string =>
  at.toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' });

const stringField = (fields: unknown, key: string): string | undefined => {
  if (typeof fields !== 'object' || fields === null) {
    return undefined;
  }
  const value = (fields as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.replace(/\s+/g, ' ').trim() : undefined;
};

// What the latest line said beyond its message: the issue or job it was about and the error, which is where the
// cause usually is. Log fields can carry text from outside, so it's clipped and escaped.
const problemDetail = (fields: unknown): string => {
  const about = stringField(fields, 'issue') ?? stringField(fields, 'job');
  const error = stringField(fields, 'error');
  const detail = [about, error].filter((part) => part !== undefined).join(': ');
  return detail ? `: ${escapeSlack(clip(detail, MAX_DETAIL))}` : '';
};

const problemLine = (group: ProblemGroup, known: Set<string>, timeZone: string): string =>
  `${group.count}× ${escapeSlack(group.message)}${known.has(group.message) ? '' : ' (new)'}, last at ${clockTime(group.lastAt, timeZone)}${problemDetail(group.fields)}`;

const problemLines = (input: HealthInput, level: ProblemLevel): string[] => {
  const known = new Set(input.knownMessages);
  return input.problems
    .filter((group) => group.level === level)
    .toSorted((a, b) => b.count - a.count || a.message.localeCompare(b.message))
    .map((group) => problemLine(group, known, input.timeZone));
};

const stuckRun = (run: OpenRun, now: Date): string | undefined => {
  const name = `${run.label} ${run.agent} run`;
  if (
    run.status === 'dispatched' &&
    run.dispatchedAt &&
    minutesBetween(run.dispatchedAt, now) >= DISPATCH_LAPSE_MINUTES
  ) {
    return `${name} was dispatched ${formatMinutes(minutesBetween(run.dispatchedAt, now))} ago and never started`;
  }
  if (run.status === 'running' && run.startedAt && minutesBetween(run.startedAt, now) >= RUNNING_MINUTES) {
    return `${name} has been running for ${formatMinutes(minutesBetween(run.startedAt, now))} without a report`;
  }
  if (run.status === 'queued' && !run.held && minutesBetween(run.createdAt, now) >= QUEUED_MINUTES) {
    return `${name} has been queued for ${formatMinutes(minutesBetween(run.createdAt, now))} with no hold`;
  }
  return undefined;
};

const lateHold = ({ label, agent, releaseAt }: HeldRun, now: Date, timeZone: string): string | undefined =>
  minutesBetween(releaseAt, now) >= LATE_MINUTES
    ? `${label} ${agent} run is still held, ${formatMinutes(minutesBetween(releaseAt, now))} after its release at ${clockTime(releaseAt, timeZone)}`
    : undefined;

// The job's slots after `since` that should have fired by now.
const dueSlots = (job: Pick<Job, 'at' | 'day'>, since: Date, now: Date, timeZone: string): Date[] => {
  const cutoff = now.getTime() - LATE_MINUTES * MINUTE_MS;
  const collect = (from: Date, found: Date[]): Date[] => {
    const slot = nextSlot(job, from, timeZone);
    return slot.getTime() > cutoff ? found : collect(slot, [...found, slot]);
  };
  // A window longer than a few days means the last check is long gone; look at the latest week at most.
  return collect(new Date(Math.max(since.getTime(), now.getTime() - 7 * DAY_MS)), []);
};

const slotLines = (input: HealthInput): string[] =>
  input.jobs.flatMap((job) =>
    dueSlots(job, input.since, input.now, input.timeZone).flatMap((slotAt) => {
      const fired = input.slots.find((slot) => slot.job === job.name && slot.slotAt.getTime() === slotAt.getTime());
      const when = `the ${slotDay(slotAt, input.timeZone)} ${job.at} slot`;
      if (!fired) {
        return [`${job.name}: ${when} didn't fire`];
      }
      const late = minutesBetween(slotAt, fired.firedAt);
      return late >= LATE_MINUTES ? [`${job.name}: ${when} fired ${formatMinutes(late)} late`] : [];
    })
  );

// Each scheduled workflow that failed, once however many times, with the latest run's log. Workflow names come from
// the repo, so they're escaped.
const workflowLines = ({ scheduledRuns, timeZone }: HealthInput): string[] => {
  const failed = scheduledRuns
    .filter(({ conclusion }) => conclusion !== null && FAILED_CONCLUSIONS.includes(conclusion))
    .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const latest = failed.filter(
    (run, index) =>
      failed.findIndex(({ repository, workflow }) => repository === run.repository && workflow === run.workflow) ===
      index
  );
  return latest.map(({ repository, workflow, createdAt, url }) => {
    const count = failed.filter((run) => run.repository === repository && run.workflow === workflow).length;
    const times = count === 1 ? 'at' : `${count}×, last at`;
    const name = escapeSlack(`${repository.split('/').at(-1)}: ${workflow}`);
    return `${name} failed ${times} ${clockTime(createdAt, timeZone)} <${url}|run log>`;
  });
};

// Everything worth a look since the last check, from the console's own records and the project's scheduled runs.
export const healthReport = (input: HealthInput): HealthReport => ({
  errors: problemLines(input, 'error'),
  warnings: problemLines(input, 'warn'),
  runs: input.openRuns.flatMap((run) => stuckRun(run, input.now) ?? []),
  held: input.heldRuns.flatMap((run) => lateHold(run, input.now, input.timeZone) ?? []),
  slots: slotLines(input),
  workflows: workflowLines(input)
});

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

const section = (title: string, lines: string[]): string[] =>
  lines.length === 0
    ? []
    : [
        `*${title}*`,
        ...lines.slice(0, MAX_LINES).map((line) => `• ${line}`),
        ...(lines.length > MAX_LINES ? [`• and ${lines.length - MAX_LINES} more`] : [])
      ];

// The check's one top-level message a day, sent even when all is clear, so a missing message stands out.
export const healthText = (
  report: HealthReport,
  { now, since, timeZone, consoleUrl }: { now: Date; since: Date; timeZone: string; consoleUrl: string }
): string => {
  const title = `*Factory health, ${slotDay(now, timeZone)}:*`;
  const total = Object.values(report).reduce((sum, lines) => sum + lines.length, 0);
  const sinceText = `${slotDay(since, timeZone)} ${clockTime(since, timeZone)}`;
  if (total === 0) {
    return `${title} all clear. No warnings, errors, stuck runs, late jobs or failed workflows since ${sinceText}.`;
  }
  return [
    `${title} ${plural(total, 'thing')} to look at since ${sinceText}.`,
    ...section('Errors', report.errors),
    ...section('Warnings', report.warnings),
    ...section('Runs', report.runs),
    ...section('Held work', report.held),
    ...section('Scheduled jobs', report.slots),
    ...section('Scheduled workflows', report.workflows),
    `<${consoleUrl}/runs|Runs> · <${consoleUrl}/usage|Usage>`
  ].join('\n');
};
