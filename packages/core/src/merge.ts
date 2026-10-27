import { z } from 'zod';

import type { ChecksState } from './inbox';
import type { SlackBlock, SlackMessage } from './slack';
import { button, escapeSlack } from './slack';

// Approve and merge from Slack: a PR review accepted is approved on GitHub as the person who tapped, with their own
// GitHub connection, and merged with a merge commit. Never without a tap, and only the commit review accepted.

export const MERGE_ACTION = 'merge';
export const MERGE_BUTTON = 'Approve and merge';

const BEFORE_MERGING_LIMIT = 500;
// Slack caps a confirm dialog's text at 300 characters.
const CONFIRM_TEXT_LIMIT = 300;
const SHORT_SHA = 7;

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

const clip = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

const section = (text: string): SlackBlock => ({ type: 'section', text: { type: 'mrkdwn', text } });

// What review says to check before merging, when it says anything: one line, from its report's `beforeMerging`.
export const readBeforeMerging = (report: unknown): string | undefined => {
  const parsed = z.object({ beforeMerging: z.string() }).safeParse(report);
  const note = parsed.success ? oneLine(parsed.data.beforeMerging) : '';
  return note ? clip(note, BEFORE_MERGING_LIMIT) : undefined;
};

const BEFORE_MERGING = '*Before merging:* ';

export const beforeMergingLine = (note: string): string => `${BEFORE_MERGING}${escapeSlack(note)}`;

// Slack's own confirm dialog, shown before anything is sent to GitHub. Plain text: the dialog shows mrkdwn's asterisks.
export const mergeConfirm = (prNumber: number, beforeMerging: string | undefined): SlackBlock => {
  const base = `You’ll approve PR #${prNumber} on GitHub as yourself and merge it, which deploys it to production.`;
  const text = beforeMerging ? `${base}\n\nBefore merging: ${beforeMerging}` : base;
  return {
    title: { type: 'plain_text', text: `Merge PR #${prNumber}?` },
    text: { type: 'plain_text', text: clip(text, CONFIRM_TEXT_LIMIT) },
    confirm: { type: 'plain_text', text: MERGE_BUTTON },
    deny: { type: 'plain_text', text: 'Not yet' },
    style: 'primary'
  };
};

export const mergeButton = (workItemId: string, prNumber: number, beforeMerging: string | undefined): SlackBlock => ({
  ...button(MERGE_ACTION, MERGE_BUTTON, { m: workItemId }, true),
  confirm: mergeConfirm(prNumber, beforeMerging)
});

const openPrButton = (prNumber: number, prUrl: string): SlackBlock => ({
  type: 'button',
  action_id: 'pr_open',
  text: { type: 'plain_text', text: `Open PR #${prNumber}` },
  url: prUrl
});

export type AcceptedPr = { workItemId: string; prNumber: number; prUrl: string; beforeMerging: string | undefined };

// Review's finished message when the PR is ready to merge: what it said, what to check first, and the buttons.
export const slackAcceptedMessage = (finishedText: string, pr: AcceptedPr): SlackMessage => {
  const note = pr.beforeMerging ? beforeMergingLine(pr.beforeMerging) : undefined;
  return {
    text: note ? `${finishedText}\n${note}` : finishedText,
    blocks: [
      section(finishedText),
      ...(note ? [section(note)] : []),
      {
        type: 'actions',
        elements: [mergeButton(pr.workItemId, pr.prNumber, pr.beforeMerging), openPrButton(pr.prNumber, pr.prUrl)]
      }
    ]
  };
};

const isMergeActions = (block: SlackBlock): boolean =>
  block.type === 'actions' &&
  Array.isArray(block.elements) &&
  block.elements.some((element: { action_id?: unknown }) => element.action_id === MERGE_ACTION);

// The accepted message once its PR is merged or closed, as Slack sends it back: the buttons go, a line says what
// happened.
export const slackMergeSettled = (blocks: SlackBlock[], line: string): SlackBlock[] => [
  ...blocks.filter((block) => !isMergeActions(block)),
  section(line)
];

export const mergedLine = ({
  by,
  time,
  repository,
  sha
}: {
  by: string | null;
  time: string;
  repository: string;
  sha: string | null;
}): string => {
  const who = by ? ` by ${escapeSlack(by)}` : '';
  const commit = sha ? ` · <https://github.com/${repository}/commit/${sha}|${sha.slice(0, SHORT_SHA)}>` : '';
  return `✓ Merged${who} at ${time}${commit}`;
};

export const closedLine = (prNumber: number): string => `PR #${prNumber} was closed without merging.`;

const connectButton = (connectUrl: string, primary: boolean): SlackBlock => ({
  type: 'button',
  action_id: 'github_connect',
  text: { type: 'plain_text', text: 'Connect GitHub' },
  url: connectUrl,
  ...(primary ? { style: 'primary' } : {})
});

// A Home tab for someone who hasn't connected GitHub: Connect GitHub where Approve and merge would be.
export const withConnectInstead = (blocks: SlackBlock[], connectUrl: string): SlackBlock[] =>
  blocks.map((block) =>
    (block.accessory as SlackBlock | undefined)?.action_id === MERGE_ACTION
      ? { ...block, accessory: connectButton(connectUrl, false) }
      : block
  );

// Connecting GitHub, from a tap by someone who hasn't yet or whose connection ran out.
export const connectGitHubMessage = (connectUrl: string, expired: boolean): SlackMessage => {
  const text = expired
    ? 'Your GitHub connection has run out, so nothing was merged. Connect again, then tap Approve and merge.'
    : 'Connect your GitHub account once so I can approve and merge as you. It only reaches the repos the factory’s GitHub app is installed on.';
  return {
    text,
    blocks: [section(text), { type: 'actions', elements: [connectButton(connectUrl, true)] }]
  };
};

export const mergeNotSetUpText = (alias: string): string =>
  `You’re not set up to merge ${alias} PRs from Slack: ask to be added to people in factory.yaml with your GitHub user ID. Nothing was merged.`;

export const notWaitingToMergeText = (identifier: string): string =>
  `${identifier} isn’t waiting to merge any more, so nothing was merged.`;

export type PullForMerge = {
  state: 'open' | 'closed';
  merged: boolean;
  draft: boolean;
  head: string;
  // Null while GitHub works out whether it merges.
  mergeable: boolean | null;
};

const short = (sha: string): string => sha.slice(0, SHORT_SHA);

// Why a PR mustn't be merged from a tap, checked before anything is sent to GitHub; undefined when it can be.
// `acceptedHead` is the commit review accepted, null when that can't be told.
export const mergeRefusal = (
  prNumber: number,
  { pull, acceptedHead, checks }: { pull: PullForMerge; acceptedHead: string | null; checks: ChecksState }
): string | undefined => {
  if (pull.merged) {
    return `PR #${prNumber} is already merged, so there’s nothing to do.`;
  }
  if (pull.state === 'closed') {
    return `PR #${prNumber} is closed, so nothing was merged.`;
  }
  if (pull.draft) {
    return `PR #${prNumber} is a draft, so nothing was merged.`;
  }
  if (!acceptedHead) {
    return `I can’t tell which commit review accepted on PR #${prNumber}, so nothing was merged. Merge it on GitHub after a look.`;
  }
  if (pull.head !== acceptedHead) {
    return `PR #${prNumber} has commits review hasn’t seen (it accepted ${short(acceptedHead)}; the head is now ${short(pull.head)}), so nothing was merged. Look at it on GitHub, or ask for another review here.`;
  }
  if (checks === 'failing') {
    return `A check failed on PR #${prNumber}, so nothing was merged.`;
  }
  if (checks === 'pending') {
    return `PR #${prNumber}’s checks are still running, so nothing was merged. Tap again once they’re green.`;
  }
  if (pull.mergeable === false) {
    return `GitHub can’t merge PR #${prNumber}: it conflicts with its base branch. Nothing was merged.`;
  }
  if (pull.mergeable === null) {
    return `GitHub is still working out whether PR #${prNumber} merges cleanly, so nothing was merged. Tap again in a minute.`;
  }
  return undefined;
};

export const approveRefusedText = (prNumber: number, message: string): string =>
  `GitHub refused the approval on PR #${prNumber}: “${escapeSlack(clip(oneLine(message), 200))}”. Nothing was merged.`;

export const mergeRefusedText = (prNumber: number, message: string): string =>
  `I approved PR #${prNumber} as you, but GitHub refused the merge: “${escapeSlack(clip(oneLine(message), 200))}”. Tap again, or merge it on GitHub.`;
