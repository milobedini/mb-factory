import type { FindingIssue } from './jobs';
import { neutraliseMarkdown } from './jobs';
import type { ChosenFollowUp } from './questions';
import { escapeSlack } from './slack';

const MAX_TITLE = 80;

const flatten = (text: string): string => text.replace(/\s+/g, ' ').trim();

export type FollowUpContext = {
  issueIdentifier: string;
  issueUrl: string | null;
  prUrl: string | null;
  round: number;
};

const linked = (text: string, url: string | null): string => (url ? `[${text}](${url})` : text);

// The review wrote the title and body from the PR, so they're made inert like a job's findings. Unsized and unprioritised:
// a person sizes it when they accept it out of Triage.
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
    estimate: null
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
