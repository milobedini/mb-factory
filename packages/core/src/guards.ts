import { z } from 'zod';

import type { FiledBefore, FindingIssue } from './jobs';
import { neutraliseMarkdown } from './jobs';

// A guard against a whole class of problem that the implement stage couldn't fit in its PR. It reports it as data and
// the console files it in Triage, so a person decides whether it's worth building.
const guardSchema = z.object({
  title: z.string().trim().min(1).max(200),
  problem: z.string().trim().min(1).max(2000),
  guard: z.string().trim().min(1).max(2000)
});

export type Guard = z.infer<typeof guardSchema>;

const guardsReportSchema = z.looseObject({ guards: z.array(z.unknown()).nullish() });

const MAX_GUARDS = 5;
const MAX_TITLE = 80;

// Malformed guards are dropped one by one; a run can't flood the Triage inbox.
export const readGuards = (report: unknown): Guard[] =>
  (guardsReportSchema.safeParse(report).data?.guards ?? [])
    .flatMap((guard) => {
      const read = guardSchema.safeParse(guard);
      return read.success ? [read.data] : [];
    })
    .slice(0, MAX_GUARDS);

const flatten = (text: string): string => text.replace(/\s+/g, ' ').trim();

// One guard per work item and title, so a later revision reporting it again finds the first issue.
export const guardFingerprint = (issueIdentifier: string, { title }: Guard): string =>
  `guard:${issueIdentifier}:${flatten(title).toLowerCase()}`;

export const GUARD_LABELS = ['factory'];

export type GuardContext = {
  issueIdentifier: string;
  issueUrl: string | null;
  prUrl: string | null;
  runUrl: string | null;
  previous?: FiledBefore;
};

const linked = (text: string, url: string | null): string => (url ? `[${text}](${url})` : text);

export const guardIssue = (guard: Guard, context: GuardContext): FindingIssue => {
  const title = flatten(guard.title);
  const raised = [
    `Raised while working on ${linked(context.issueIdentifier, context.issueUrl)}`,
    context.prUrl ? ` in ${linked('its PR', context.prUrl)}` : '',
    `; it didn't fit there${context.runUrl ? ` ([run log](${context.runUrl}))` : ''}.`
  ].join('');
  return {
    title: title.length > MAX_TITLE - 7 ? `Guard: ${title.slice(0, MAX_TITLE - 8)}…` : `Guard: ${title}`,
    description: [
      '## The class of problem',
      '',
      neutraliseMarkdown(guard.problem),
      '',
      '## The guard',
      '',
      neutraliseMarkdown(guard.guard),
      '',
      '---',
      '',
      context.previous
        ? `${raised} It came back after [${context.previous.identifier}](${context.previous.url}) was done.`
        : raised,
      `Fingerprint: \`${guardFingerprint(context.issueIdentifier, guard)}\``
    ].join('\n'),
    priority: 4,
    estimate: null
  };
};
