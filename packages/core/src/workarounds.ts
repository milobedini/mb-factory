import { z } from 'zod';

import type { GuardContext } from './guards';
import { flatten, slug } from './guards';
import type { FindingIssue } from './jobs';
import { neutraliseMarkdown } from './jobs';
import { ESTIMATES } from './sizes';
import { escapeSlack } from './slack';

// Something broken in the project that a run patched locally to get its own work done, outside its issue's scope. It
// reports it as data and the console files the fix in Triage, so the patch isn't repeated run after run unseen.
const workaroundSchema = z.object({
  // What's broken, named so another run hitting it would name it the same.
  title: z.string().trim().min(1).max(200),
  // What the run patched, and where.
  patch: z.string().trim().min(1).max(2000)
});

export type Workaround = z.infer<typeof workaroundSchema>;

const workaroundsReportSchema = z.looseObject({ workarounds: z.array(z.unknown()).nullish() });

const MAX_WORKAROUNDS = 3;
const MAX_TITLE = 80;
const PREFIX = 'Fix: ';

// Malformed ones are dropped one by one; a run can't flood the Triage inbox.
export const readWorkarounds = (report: unknown): Workaround[] =>
  (workaroundsReportSchema.safeParse(report).data?.workarounds ?? [])
    .flatMap((workaround) => {
      const read = workaroundSchema.safeParse(workaround);
      return read.success ? [read.data] : [];
    })
    .slice(0, MAX_WORKAROUNDS);

// One per project and title, unlike a guard: the same breakage met by another issue's run finds the first filing.
export const workaroundFingerprint = ({ title }: Workaround): string => `workaround:${slug(title)}`;

export const workaroundIssue = (workaround: Workaround, context: GuardContext): FindingIssue => {
  const title = flatten(workaround.title);
  const raised = [
    `Worked around while working on ${context.issueUrl ? `[${context.issueIdentifier}](${context.issueUrl})` : context.issueIdentifier}`,
    context.prUrl ? ` in [its PR](${context.prUrl})` : '',
    `, and left unfixed as out of its scope${context.runUrl ? ` ([run log](${context.runUrl}))` : ''}.`
  ].join('');
  return {
    title:
      title.length > MAX_TITLE - PREFIX.length
        ? `${PREFIX}${title.slice(0, MAX_TITLE - PREFIX.length - 1)}…`
        : `${PREFIX}${title}`,
    description: [
      '## What’s broken',
      '',
      neutraliseMarkdown(workaround.title),
      '',
      '## The workaround',
      '',
      neutraliseMarkdown(workaround.patch),
      '',
      '---',
      '',
      context.previous
        ? `${raised} It came back after [${context.previous.identifier}](${context.previous.url}) was done.`
        : raised,
      `Fingerprint: \`${workaroundFingerprint(workaround)}\``
    ].join('\n'),
    priority: 3,
    estimate: ESTIMATES.S
  };
};

// Said in the thread and session once the fixes are filed, or found already open.
export const workaroundsText = (
  issues: { identifier: string; url: string; title: string }[],
  markup: 'slack' | 'markdown' = 'slack'
): string => {
  const links = issues.map(({ identifier, url, title }) =>
    markup === 'slack'
      ? `<${url}|${escapeSlack(identifier)}> ${escapeSlack(title)}`
      : `[${identifier}](${url}) ${neutraliseMarkdown(title)}`
  );
  return `This run patched the project locally to get its work done; the fix${issues.length === 1 ? ' is' : 'es are'} tracked in ${links.join('; ')}.`;
};
