import { z } from 'zod';

import type { FindingIssue } from './jobs';
import { neutraliseMarkdown } from './jobs';
import type { ChosenFollowUp } from './questions';
import type { RunTrigger } from './runs';
import { ESTIMATES, SIZES } from './sizes';
import { escapeSlack } from './slack';

const MAX_TITLE = 80;
const MAX_REQUESTED = 3;
const MAX_REQUEST_QUOTE = 300;

const flatten = (text: string): string => text.replace(/\s+/g, ' ').trim();

export type FollowUpContext = {
  issueIdentifier: string;
  issueUrl: string | null;
  prUrl: string | null;
  round: number;
};

const linked = (text: string, url: string | null): string => (url ? `[${text}](${url})` : text);

// The review wrote the title and body from the PR, so they're made inert like a job's findings. Sized by the review,
// unprioritised: a person sets the priority when they accept it out of Triage.
export const followUpIssue = (followUp: ChosenFollowUp, context: FollowUpContext): FindingIssue => {
  const title = flatten(followUp.title);
  return {
    title: title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title,
    description: [
      neutraliseMarkdown(followUp.body),
      '',
      '---',
      '',
      `Decided in ${linked(context.issueIdentifier, context.issueUrl)}'s review, round ${context.round}${context.prUrl ? ` (${linked('its PR', context.prUrl)})` : ''}: ${neutraliseMarkdown(flatten(followUp.prompt))} → ${neutraliseMarkdown(followUp.option)}.`
    ].join('\n'),
    priority: 0,
    estimate: followUp.size ? ESTIMATES[followUp.size] : null
  };
};

const requestedSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(2000),
  size: z.enum(SIZES).nullish().catch(null)
});

export type RequestedIssue = z.infer<typeof requestedSchema>;

const requestedReportSchema = z.looseObject({ issues: z.array(z.unknown()).nullish() });

// Runs whose prompt is a person's own words. Only those can have asked for an issue, so a later run that repeats one
// from the session doesn't file it again.
const REQUESTING_TRIGGERS: readonly RunTrigger[] = ['prompted', 'spec_approved', 'answered'];

// The issues a person's reply asked a stage run to file ("file the and/or choice as its own issue"), from its report.
export const readRequestedIssues = (run: { trigger: RunTrigger; report: unknown }): RequestedIssue[] =>
  REQUESTING_TRIGGERS.includes(run.trigger)
    ? (requestedReportSchema.safeParse(run.report).data?.issues ?? [])
        .flatMap((issue) => {
          const read = requestedSchema.safeParse(issue);
          return read.success ? [read.data] : [];
        })
        .slice(0, MAX_REQUESTED)
    : [];

export type RequestedContext = {
  issueIdentifier: string;
  issueUrl: string | null;
  prUrl: string | null;
  runUrl: string | null;
  // The person's reply that asked for it: the run's prompt.
  request: string | null;
};

// As a review's follow-up: the agent wrote the text, so it's made inert, sized by the agent and left unprioritised.
export const requestedIssue = (issue: RequestedIssue, context: RequestedContext): FindingIssue => {
  const title = flatten(issue.title);
  const request = context.request && flatten(context.request);
  const quoted =
    request && (request.length > MAX_REQUEST_QUOTE ? `${request.slice(0, MAX_REQUEST_QUOTE - 1)}…` : request);
  return {
    title: title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title,
    description: [
      neutraliseMarkdown(issue.body),
      '',
      '---',
      '',
      [
        `Asked for in ${linked(context.issueIdentifier, context.issueUrl)}`,
        context.prUrl ? ` (${linked('its PR', context.prUrl)})` : '',
        quoted ? `: “${neutraliseMarkdown(quoted)}”` : '',
        context.runUrl ? ` ([run log](${context.runUrl}))` : '',
        '.'
      ].join('')
    ].join('\n'),
    priority: 0,
    estimate: issue.size ? ESTIMATES[issue.size] : null
  };
};

// Where the filed follow-ups are, in the thread (Slack's markup) or the session (Markdown).
export const filedFollowUpsText = (
  filed: { identifier: string; url: string; title: string }[],
  markup: 'slack' | 'markdown' = 'slack'
): string => {
  const links = filed.map(({ identifier, url, title }) =>
    markup === 'slack'
      ? `<${url}|${escapeSlack(identifier)}> ${escapeSlack(title)}`
      : `[${identifier}](${url}) ${neutraliseMarkdown(title)}`
  );
  return `Filed the follow-up${filed.length === 1 ? '' : 's'} in Triage: ${links.join('; ')}.`;
};
