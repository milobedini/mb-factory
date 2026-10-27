import { z } from 'zod';

import type { Job } from './config';
import { WEEKDAYS } from './config';
import type { JobAgent } from './stages';

const DAY_MS = 24 * 60 * 60 * 1000;

const clip = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

type CalendarDay = { year: number; month: number; day: number };

const zonedParts = (instant: Date, timeZone: string): Record<string, number> =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
      .formatToParts(instant)
      .filter(({ type }) => type !== 'literal')
      .map(({ type, value }) => [type, Number(value)])
  );

// How far the zone's wall clock is ahead of UTC at this instant.
const offsetMs = (instant: Date, timeZone: string): number => {
  const parts = zonedParts(instant, timeZone);
  const wall = Date.UTC(parts.year ?? 0, (parts.month ?? 1) - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wall - (instant.getTime() - instant.getUTCMilliseconds());
};

// The instant a wall-clock time in the zone happens; the offset is read twice so a change of clocks that day counts.
const zonedMoment = ({ year, month, day }: CalendarDay, at: string, timeZone: string): Date => {
  const [hour = 0, minute = 0] = at.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const guess = wall - offsetMs(new Date(wall), timeZone);
  return new Date(wall - offsetMs(new Date(guess), timeZone));
};

const calendarDay = (instant: Date, timeZone: string): CalendarDay => {
  const { year = 0, month = 1, day = 1 } = zonedParts(instant, timeZone);
  return { year, month, day };
};

const shiftDay = ({ year, month, day }: CalendarDay, days: number): CalendarDay => {
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * DAY_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
};

type SlotTime = Pick<Job, 'at' | 'day'>;

const weekdayOf = ({ year, month, day }: CalendarDay): (typeof WEEKDAYS)[number] | undefined =>
  WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];

// The first of the seven days from `from`, stepping by `step`, that the job runs on: `from` itself for a daily job.
const runDay = ({ day }: SlotTime, from: CalendarDay, step: 1 | -1): CalendarDay =>
  Array.from({ length: 7 }, (_, index) => shiftDay(from, index * step)).find(
    (candidate) => day === undefined || weekdayOf(candidate) === day
  ) ?? from;

// The job's most recent slot at or before `now`: today's if it has come, else the run day before.
export const latestSlot = (job: SlotTime, now: Date, timeZone: string): Date => {
  const today = calendarDay(now, timeZone);
  const start = zonedMoment(today, job.at, timeZone) <= now ? today : shiftDay(today, -1);
  return zonedMoment(runDay(job, start, -1), job.at, timeZone);
};

// The job's first slot after `now`.
export const nextSlot = (job: SlotTime, now: Date, timeZone: string): Date => {
  const today = calendarDay(now, timeZone);
  const start = zonedMoment(today, job.at, timeZone) > now ? today : shiftDay(today, 1);
  return zonedMoment(runDay(job, start, 1), job.at, timeZone);
};

export const FINDING_SEVERITIES = ['critical', 'high', 'moderate', 'low'] as const;

export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

const SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const;

export const FINDING_KINDS = ['advisory', 'code', 'docs'] as const;

export type FindingKind = (typeof FINDING_KINDS)[number];

// The kinds each job may report; anything else in its report is dropped.
const JOB_KINDS: Record<JobAgent, FindingKind[]> = { security: ['advisory', 'code'], docs: ['docs'] };

const MAX_FINDINGS = 20;

const findingSchema = z
  .looseObject({
    // Stable across runs, so a finding already filed is recognised: `advisory:<package>@<version>`,
    // `code:<category>:<path>` or `docs:<path>:<topic>`.
    fingerprint: z
      .string()
      .trim()
      .regex(/^(advisory|code|docs):[A-Za-z0-9._@/:+-]{1,200}$/),
    kind: z.enum(FINDING_KINDS),
    title: z.string().trim().min(1).max(200),
    severity: z.enum(FINDING_SEVERITIES),
    // Advisories only: whether the package ships with the app or is only used to build and test it.
    scope: z.enum(['runtime', 'dev']).nullish().catch(null),
    evidence: z.string().trim().min(1).max(4000),
    fix: z.string().trim().min(1).max(2000),
    size: z.enum(SIZES).nullish().catch(null),
    path: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._/-]{1,300}$/)
      .refine((path) => !path.split('/').includes('..'))
      .nullish()
      .catch(null),
    line: z.int().positive().nullish().catch(null)
  })
  .refine(({ fingerprint, kind }) => fingerprint.startsWith(`${kind}:`), {
    message: 'the fingerprint names another kind'
  });

export type Finding = z.infer<typeof findingSchema>;

const SEVERITY_RANK: Record<FindingSeverity, number> = { critical: 3, high: 2, moderate: 1, low: 0 };

// The agreed bar, applied again here whatever the agent judged: advisories moderate and up in what ships, high and up
// in what only builds and tests it; a concrete code issue or docs drift at any severity.
export const isWorthFiling = ({ kind, severity, scope }: Finding): boolean => {
  if (kind !== 'advisory') {
    return true;
  }
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[scope === 'dev' ? 'high' : 'moderate'];
};

const jobReportSchema = z.looseObject({
  // The newest commit on the default branch the check covered; the next check starts after it.
  head: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .nullish()
    .catch(null),
  commits: z.int().min(0).nullish().catch(null),
  // What the job couldn't check, such as an audit tool that failed, so a quiet day isn't read as a clean one.
  gaps: z.array(z.unknown()).nullish().catch(null),
  findings: z.array(z.unknown()).nullish().catch(null)
});

const MAX_GAPS = 5;
const MAX_GAP_LENGTH = 200;

export type JobReport = {
  head: string | null;
  commits: number | null;
  gaps: string[];
  findings: Finding[];
  dropped: number;
};

// A job's report, each finding read on its own; ones that are malformed, of another job's kind, below the bar or
// repeated are dropped.
export const readJobReport = (report: unknown, agent: JobAgent): JobReport => {
  const parsed = jobReportSchema.safeParse(report).data;
  const raw = parsed?.findings ?? [];
  const findings = raw
    .flatMap((finding) => {
      const read = findingSchema.safeParse(finding);
      return read.success && JOB_KINDS[agent].includes(read.data.kind) && isWorthFiling(read.data) ? [read.data] : [];
    })
    .filter((finding, index, all) => all.findIndex(({ fingerprint }) => fingerprint === finding.fingerprint) === index)
    .slice(0, MAX_FINDINGS);
  const gaps = (parsed?.gaps ?? [])
    .flatMap((gap) =>
      typeof gap === 'string' && gap.trim() ? [clip(gap.replace(/\s+/g, ' ').trim(), MAX_GAP_LENGTH)] : []
    )
    .slice(0, MAX_GAPS);
  return {
    head: parsed?.head ?? null,
    commits: parsed?.commits ?? null,
    gaps,
    findings,
    dropped: raw.length - findings.length
  };
};

export type CoveredRun = { head: string; fingerprints: string[] };

// Where the next check starts: after the newest run (runs come newest first) whose findings all reached Linear, so one
// Linear refused is found again rather than lost. Past the runs given, the oldest one's head, so a check that can't
// file for days still moves on.
export const coveredHead = (runs: CoveredRun[], filed: ReadonlySet<string>): string | undefined =>
  (runs.find(({ fingerprints }) => fingerprints.every((fingerprint) => filed.has(fingerprint))) ?? runs.at(-1))?.head;

// The latest issue filed for a fingerprint, with its Linear state type, or null when it can't be read.
export type FiledBefore = { identifier: string; url: string; stateType: string | null };

export type Filing =
  | { kind: 'file' }
  | { kind: 'refile'; previous: FiledBefore }
  | { kind: 'known'; previous: FiledBefore; why: 'open' | 'declined' };

// A finding already filed isn't filed again while its issue is open, or after it was declined; one seen again after
// its issue was done has come back, so it's filed anew. An issue that can't be read counts as open: no duplicates.
export const decideFiling = (previous: FiledBefore | undefined): Filing => {
  if (!previous) {
    return { kind: 'file' };
  }
  if (previous.stateType === 'completed') {
    return { kind: 'refile', previous };
  }
  return { kind: 'known', previous, why: previous.stateType === 'canceled' ? 'declined' : 'open' };
};

// Linear's priorities: 1 urgent, 2 high, 3 medium, 4 low.
const PRIORITY: Record<FindingSeverity, number> = { critical: 1, high: 2, moderate: 3, low: 4 };
// The team's T-shirt estimates as Linear stores them.
const ESTIMATE: Record<(typeof SIZES)[number], number> = { XS: 1, S: 2, M: 3, L: 5, XL: 8 };

const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  moderate: 'Moderate',
  low: 'Low'
};

const MAX_TITLE = 80;

const KIND_LABEL: Record<FindingKind, string> = { advisory: 'dependency advisory', code: 'code', docs: 'docs drift' };
const TITLE_PREFIX: Record<FindingKind, string> = { advisory: 'Security', code: 'Security', docs: 'Docs' };

// The agent read public repo content to write a finding, so its text is untrusted: an image would load as soon as
// someone opened the issue, and a link could hide where it goes. Escaping the brackets and angle brackets means no
// link, image, reference definition or HTML can render, whatever form it takes; a bare address stays visible as it is.
// Code shows the backslashes too, which is the price of not parsing Markdown here.
export const neutraliseMarkdown = (text: string): string => text.replace(/[\\[\]<>]/g, (character) => `\\${character}`);

export type FindingIssue = { title: string; description: string; priority: number; estimate: number | null };

export type FindingContext = {
  jobTitle: string;
  repository: string;
  // The commit the check read, for links that keep pointing at the code it saw.
  head: string | null;
  runUrl: string | null;
  day: string;
  previous?: FiledBefore;
};

const location = ({ path, line }: Finding, { repository, head }: FindingContext): string | undefined => {
  if (!path) {
    return undefined;
  }
  const shown = `${path}${line ? `:${line}` : ''}`;
  return head
    ? `[\`${shown}\`](https://github.com/${repository}/blob/${head}/${path}${line ? `#L${line}` : ''})`
    : `\`${shown}\``;
};

// One finding as a Linear issue: what triage would want to read before accepting it.
export const findingIssue = (finding: Finding, context: FindingContext): FindingIssue => {
  const where = location(finding, context);
  const kind = KIND_LABEL[finding.kind] + (finding.kind === 'advisory' && finding.scope ? ` (${finding.scope})` : '');
  const found = `Found by the ${context.jobTitle.toLowerCase()} on ${context.day}${context.runUrl ? ` ([run log](${context.runUrl}))` : ''}.`;
  return {
    title: clip(`${TITLE_PREFIX[finding.kind]}: ${finding.title.replace(/\s+/g, ' ')}`, MAX_TITLE),
    description: [
      `**Severity:** ${SEVERITY_LABEL[finding.severity]} · **Kind:** ${kind}${where ? ` · **Where:** ${where}` : ''}`,
      '',
      '## What',
      '',
      neutraliseMarkdown(finding.evidence),
      '',
      '## Fix',
      '',
      neutraliseMarkdown(finding.fix),
      '',
      '---',
      '',
      context.previous
        ? `${found} It came back after [${context.previous.identifier}](${context.previous.url}) was done.`
        : found,
      `Fingerprint: \`${finding.fingerprint}\``
    ].join('\n'),
    priority: PRIORITY[finding.severity],
    estimate: finding.size ? ESTIMATE[finding.size] : null
  };
};

// "Daily security check", or "Weekly docs pass over the whole repo".
export const jobTitle = ({ agent, day, scope }: Pick<Job, 'agent' | 'day' | 'scope'>): string =>
  `${day === undefined ? 'Daily' : 'Weekly'} ${agent} ${scope === 'repo' ? 'pass over the whole repo' : 'check'}`;

// Labels on every issue the job files, so Triage shows where it came from.
const JOB_LABELS: Record<JobAgent, string[]> = { security: ['security', 'factory'], docs: ['docs', 'factory'] };

export const jobLabels = (agent: JobAgent): string[] => JOB_LABELS[agent];

const escapeSlack = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const slackLink = (url: string, label: string): string => `<${url}|${escapeSlack(label)}>`;

export type CheckIssue = { identifier: string; url: string; title?: string };

export type CheckResult =
  | { kind: 'clean'; commits: number | null; gaps: string[] }
  | {
      kind: 'filed';
      commits: number | null;
      gaps: string[];
      filed: CheckIssue[];
      known: CheckIssue[];
      // Titles of the findings Linear refused, so the channel shows what was found without opening the console.
      unfiled: string[];
    }
  | { kind: 'failed'; summary: string };

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

const reviewed = (commits: number | null): string =>
  commits === null ? '' : ` Reviewed ${plural(commits, 'commit')} on main.`;

// The job's one top-level message a day: clean, what it filed, or that it failed, always with the run log.
export const jobCheckText = (title: string, day: string, result: CheckResult, runUrl: string | null): string => {
  const log = runUrl ? ` ${slackLink(runUrl, 'Run log')}` : '';
  if (result.kind === 'failed') {
    return `*${title}, ${day}:* failed. ${escapeSlack(result.summary)}${log}`;
  }
  const notChecked =
    result.gaps.length > 0 ? `Not checked: ${result.gaps.map((gap) => escapeSlack(gap)).join('; ')}.` : undefined;
  if (result.kind === 'clean') {
    return result.gaps.length > 0
      ? `*${title}, ${day}:* nothing to file, but not everything was checked.${reviewed(result.commits)}${log}\n${notChecked}`
      : `*${title}, ${day}:* clean.${reviewed(result.commits)} Nothing new to file.${log}`;
  }
  const unfiled =
    result.unfiled.length > 0 ? `couldn’t file ${plural(result.unfiled.length, 'finding')} in Linear` : '';
  const headline =
    result.filed.length > 0
      ? `filed ${plural(result.filed.length, 'issue')} in Triage.`
      : unfiled
        ? `${unfiled}.`
        : 'nothing new to file.';
  const lines = [
    `*${title}, ${day}:* ${headline}${reviewed(result.commits)}${log}`,
    ...result.filed.map(
      ({ identifier, url, title: issueTitle }) =>
        `• ${slackLink(url, identifier)}${issueTitle ? ` ${escapeSlack(issueTitle)}` : ''}`
    ),
    result.known.length > 0
      ? `Already filed: ${result.known.map(({ identifier, url }) => slackLink(url, identifier)).join(', ')}.`
      : undefined,
    // The headline already says so when nothing was filed.
    unfiled && result.filed.length > 0 ? `Also ${unfiled}:` : undefined,
    ...result.unfiled.map((findingTitle) => `• ${escapeSlack(findingTitle)}`),
    unfiled
      ? 'Linear’s reason is in the next health message. The next check looks at the same commits again.'
      : undefined,
    notChecked
  ];
  return lines.filter((line) => line !== undefined).join('\n');
};

// The day a slot belongs to, as people in the project read it: "Tue 27 Oct".
export const slotDay = (slot: Date, timeZone: string): string =>
  slot.toLocaleDateString('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).replace(',', '');
