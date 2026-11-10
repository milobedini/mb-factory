import { z } from 'zod';

import type { SentryIssue } from './health';
import type { SlackBlock, SlackMessage } from './slack';
import { button, escapeSlack } from './slack';

// The watch after an auto-merge (docs/express.md, "After merging"): for 30 minutes the console checks the production
// deploy of the merge and looks for new Sentry issues. On a problem it offers Revert, which opens GitHub's revert PR
// and merges it once its checks pass. It never reverts by itself.

export const WATCH_MINUTES = 30;
const WATCH_MS = WATCH_MINUTES * 60 * 1000;

export const MERGE_WATCH_EVENT = 'merge_watch';
export const MERGE_WATCH_END_EVENT = 'merge_watch_end';
export const REVERT_EVENT = 'revert';
export const REVERT_ACTION = 'revert';

// A watch as recorded when the factory's App merged a PR. A routine Dependabot update has no work item: its watch
// replies under its card instead.
export const mergeWatchSchema = z.object({
  workItemId: z.uuid().nullable(),
  repository: z.string().min(1),
  prNumber: z.int().positive(),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  mergedAt: z.iso.datetime(),
  endsAt: z.iso.datetime()
});

export type MergeWatch = z.infer<typeof mergeWatchSchema>;

export const mergeWatch = (merged: Omit<MergeWatch, 'mergedAt' | 'endsAt'>, at: Date): MergeWatch => ({
  ...merged,
  mergedAt: at.toISOString(),
  endsAt: new Date(at.getTime() + WATCH_MS).toISOString()
});

export const readMergeWatch = (payload: unknown): MergeWatch | undefined => mergeWatchSchema.safeParse(payload).data;

// A revert PR the console opened, merged by itself once its checks pass.
export const revertSchema = z.object({
  workItemId: z.uuid(),
  repository: z.string().min(1),
  // The PR it reverts, and the revert PR itself.
  of: z.int().positive(),
  prNumber: z.int().positive(),
  url: z.url(),
  // The revert commit GitHub made: only that head merges by itself, so nothing pushed onto the branch since goes in
  // unreviewed.
  head: z.string().regex(/^[0-9a-f]{40}$/)
});

export type Revert = z.infer<typeof revertSchema>;

export const readRevert = (payload: unknown): Revert | undefined => revertSchema.safeParse(payload).data;

// The production deploy of the merge, as GitHub's deployments record it: Vercel reports each one.
export type DeployState = 'success' | 'failed' | 'deploying' | 'none';

// GitHub's deployment status states, as the watch reads them.
export const deployStateOf = (state: string): DeployState =>
  state === 'success'
    ? 'success'
    : state === 'failure' || state === 'error'
      ? 'failed'
      : state === 'inactive'
        ? 'success'
        : 'deploying';

export type WatchFindings = {
  deploy: DeployState;
  deployUrl: string | null;
  deployedAt: string | null;
  // Already said in the thread when it failed, from its webhook.
  deployFailureSaid: boolean;
  // Null when Sentry couldn't be read, or the project doesn't report to it: nothing is claimed about new issues.
  issues: SentryIssue[] | null;
};

const section = (text: string): SlackBlock => ({ type: 'section', text: { type: 'mrkdwn', text } });

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

const SHOWN_ISSUES = 5;

// Revert, with Slack's confirm first: it changes production.
export const revertButton = (workItemId: string, prNumber: number): SlackBlock => ({
  ...button(REVERT_ACTION, `Revert PR #${prNumber}`, { v: workItemId }),
  style: 'danger',
  confirm: {
    title: { type: 'plain_text', text: `Revert PR #${prNumber}?` },
    text: {
      type: 'plain_text',
      text: `I’ll open GitHub’s revert PR as the factory. It merges itself once its checks pass, which deploys the revert to production.`
    },
    confirm: { type: 'plain_text', text: 'Revert' },
    deny: { type: 'plain_text', text: 'Not yet' },
    style: 'danger'
  }
});

const linkButton = (actionId: string, text: string, url: string): SlackBlock => ({
  type: 'button',
  action_id: actionId,
  text: { type: 'plain_text', text },
  url
});

const REVERT_NOTE = 'Revert opens GitHub’s revert PR, which merges itself once its checks pass.';
// A routine update's message has no Revert button yet.
const GITHUB_REVERT_NOTE = 'If it’s the cause, revert it from the PR on GitHub.';

const revertNote = (workItemId: string | null): string => (workItemId ? REVERT_NOTE : GITHUB_REVERT_NOTE);

// Said at once when the production deploy of a merge the factory made fails.
export const slackDeployFailedMessage = (
  pr: { workItemId: string | null; prNumber: number },
  logUrl: string | null
): SlackMessage => {
  const text = `⚠️ *The production deploy failed* for PR #${pr.prNumber}, which merged itself. ${revertNote(pr.workItemId)}`;
  const buttons = [
    ...(pr.workItemId ? [revertButton(pr.workItemId, pr.prNumber)] : []),
    ...(logUrl ? [linkButton('deploy_open', 'Open the deploy', logUrl)] : [])
  ];
  return {
    text,
    blocks: [section(text), ...(buttons.length > 0 ? [{ type: 'actions', elements: buttons }] : [])]
  };
};

const issueLine = (issue: SentryIssue): string =>
  `• <${issue.url}|${escapeSlack(issue.shortId)}> ${escapeSlack(issue.title.length > 90 ? `${issue.title.slice(0, 89)}…` : issue.title)} · ${plural(issue.count, 'event')}`;

// What the watch found when its 30 minutes end: a short all-clear, or the problems with Revert.
export const slackWatchEndMessage = (
  pr: { workItemId: string | null; prNumber: number; time: string },
  found: WatchFindings
): SlackMessage => {
  const deployLine =
    found.deploy === 'failed'
      ? found.deployFailureSaid
        ? undefined
        : `The production deploy failed${found.deployUrl ? ` (<${found.deployUrl}|deploy>)` : ''}.`
      : found.deploy === 'none'
        ? 'No production deploy of the merge has appeared on GitHub, so I can’t tell it went out.'
        : found.deploy === 'deploying'
          ? 'The production deploy is still going after 30 minutes.'
          : undefined;
  const issues = found.issues ?? [];
  const sentryUnread = found.issues === null ? ['I couldn’t read Sentry, so new issues weren’t checked.'] : [];
  const issueLines =
    issues.length > 0
      ? [
          `${plural(issues.length, 'new Sentry issue')} since it merged, which may not come from it:`,
          ...issues.slice(0, SHOWN_ISSUES).map(issueLine),
          ...(issues.length > SHOWN_ISSUES ? [`…and ${issues.length - SHOWN_ISSUES} more.`] : [])
        ]
      : [];
  if (!deployLine && issueLines.length === 0 && sentryUnread.length === 0) {
    const deployed =
      found.deploy === 'success'
        ? `deployed to production${found.deployedAt ? ` at ${found.deployedAt}` : ''}`
        : 'its deploy failed (above)';
    const text = `✓ Watched PR #${pr.prNumber} for ${WATCH_MINUTES} minutes after it merged itself: ${deployed}, and no new Sentry issues.`;
    return { text, blocks: [{ type: 'context', elements: [{ type: 'mrkdwn', text }] }] };
  }
  const revertable = found.deploy === 'failed' || issues.length > 0;
  const text = [
    `⚠️ *After merging PR #${pr.prNumber}* (${WATCH_MINUTES}-minute watch, ended ${pr.time}):`,
    ...(deployLine ? [deployLine] : []),
    ...issueLines,
    ...sentryUnread,
    ...(revertable ? [revertNote(pr.workItemId)] : [])
  ].join('\n');
  return {
    text,
    blocks: [
      section(text),
      ...(revertable && pr.workItemId
        ? [{ type: 'actions', elements: [revertButton(pr.workItemId, pr.prNumber)] }]
        : [])
    ]
  };
};

export const revertOpenedText = (by: string, revert: Revert): string =>
  `${escapeSlack(by)} asked for a revert: <${revert.url}|PR #${revert.prNumber}> reverts PR #${revert.of}. It merges itself once its checks pass.`;

export const revertMergedText = (revert: Revert, identifier: string): string =>
  `✓ Reverted: <${revert.url}|PR #${revert.prNumber}> merged, so PR #${revert.of}’s change is coming out of production. ${identifier} stays Done in Linear: reopen it if the work should come back.`;

// Under a merge queue the revert goes to the front of the queue; its merge is said when the PR closes merged.
export const revertQueuedText = (revert: Revert): string =>
  `Added the revert, <${revert.url}|PR #${revert.prNumber}>, to the front of the merge queue: it merges once its checks pass on top of main.`;

export const revertRefusedText = (revert: Revert, message: string): string =>
  `I couldn’t merge the revert, <${revert.url}|PR #${revert.prNumber}>, by myself: GitHub said “${escapeSlack(message)}”. It’s yours to merge.`;

export const revertMovedText = (revert: Revert): string =>
  `The revert, <${revert.url}|PR #${revert.prNumber}>, has commits besides GitHub’s revert, so it won’t merge by itself. It’s yours to review and merge.`;

export const revertExistsText = (revert: Revert): string =>
  `PR #${revert.of} already has a revert: <${revert.url}|PR #${revert.prNumber}>.`;

// The message a Revert was tapped in, as Slack sends it back: its buttons go, and a line says who asked.
export const slackRevertSettled = (blocks: SlackBlock[], line: string): SlackBlock[] => [
  ...blocks.filter((block) => block.type !== 'actions'),
  { type: 'context', elements: [{ type: 'mrkdwn', text: escapeSlack(line) }] }
];
