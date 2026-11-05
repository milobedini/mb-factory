import type { ChecksState } from './inbox';
import { escapeSlack, slackEmoji } from './slack';

// The checks on a PR's head as GitHub shows them under the PR: each check run (an Actions job, or another app's check)
// and each commit status (Vercel's deployment), by name.

export type HeadCheckState = 'passed' | 'failed' | 'running';

export type HeadCheck = { name: string; state: HeadCheckState; url: string | null; finishedAt: Date | null };

export type ChecksSummary = {
  state: ChecksState;
  // Every check on the head, plus those that ran on the commit before it and haven't started on this one yet.
  total: number;
  passed: number;
  running: string[];
  // A check that ran on the commit before counts as still to come until it reports here: a PR's preview checks start
  // only once its preview has deployed, so without this the head would look green before they began.
  waiting: string[];
  failed: { name: string; url: string | null }[];
  // When the last check finished, once every one has passed.
  finishedAt: Date | null;
};

const PASSED_CONCLUSIONS = ['success', 'neutral', 'skipped'];

// A check run from GitHub's check-runs API. Anything completed that didn't pass counts as failed, as branch protection
// counts it: a cancelled check on the head isn't green.
export const checkRunState = ({ status, conclusion }: { status: string; conclusion: string | null }): HeadCheckState =>
  status !== 'completed' ? 'running' : PASSED_CONCLUSIONS.includes(conclusion ?? '') ? 'passed' : 'failed';

// A commit status: success, pending, failure or error.
export const commitStatusState = (state: string): HeadCheckState =>
  state === 'success' ? 'passed' : state === 'pending' ? 'running' : 'failed';

// The newest of each name: GitHub lists a re-run beside the run it replaced. Newest first in, first of each name kept.
const latestByName = (checks: HeadCheck[]): HeadCheck[] =>
  checks.filter((check, index) => checks.findIndex(({ name }) => name === check.name) === index);

// Events whose Actions runs also land on a PR's own commits. Runs from any other event (the factory's stage dispatches,
// schedules, manual runs, Dependabot's updates and dependency-graph submissions, which GitHub calls `dynamic`) are filed
// on the default branch's head whatever started them, so a PR's first commit, whose parent is the base's head, must
// not wait for them. Listing the events that do reach a PR keeps a new kind of default-branch run from holding a merge.
export const PULL_REQUEST_EVENTS = ['push', 'pull_request', 'deployment', 'deployment_status'] as const;

// A check on the commit before the head, with the check suite it came from (null for a commit status).
export type PreviousCheck = { name: string; suiteId: number | null };

// The names of the earlier commit's checks the head should wait for: all but those from an Actions run whose event
// never reaches a PR. Other apps' checks and commit statuses have no Actions run, so they're kept.
export const checksToWaitFor = (previous: PreviousCheck[], runs: { event: string; suiteId: number }[]): string[] => {
  const pullRequestEvents: readonly string[] = PULL_REQUEST_EVENTS;
  const skipped = new Set(runs.filter(({ event }) => !pullRequestEvents.includes(event)).map(({ suiteId }) => suiteId));
  return previous.filter(({ suiteId }) => suiteId === null || !skipped.has(suiteId)).map(({ name }) => name);
};

export const summariseChecks = (headChecks: HeadCheck[], previousNames: string[]): ChecksSummary => {
  const head = latestByName(headChecks);
  const onHead = new Set(head.map(({ name }) => name));
  const waiting = [...new Set(previousNames)].filter((name) => !onHead.has(name)).sort();
  const running = head.filter(({ state }) => state === 'running').map(({ name }) => name);
  const failed = head.filter(({ state }) => state === 'failed').map(({ name, url }) => ({ name, url }));
  const passed = head.filter(({ state }) => state === 'passed');
  const total = head.length + waiting.length;
  const state: ChecksState =
    total === 0 ? 'none' : failed.length > 0 ? 'failing' : running.length + waiting.length > 0 ? 'pending' : 'passing';
  const finishedTimes = passed.map(({ finishedAt }) => finishedAt?.getTime() ?? 0);
  return {
    state,
    total,
    passed: passed.length,
    running,
    waiting,
    failed,
    finishedAt:
      state === 'passing' && finishedTimes.some((time) => time > 0) ? new Date(Math.max(...finishedTimes)) : null
  };
};

// "A", "A and B", "A, B and C".
const listText = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

const clock = (at: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);

// A check's link comes from whoever reported it (a commit status's target URL is anyone's with status access), so it's
// linked only when it's plain https that can't close Slack's `<url|text>` early.
const linkable = (url: string | null): url is string => url !== null && /^https:\/\/[^\s<>|]+$/.test(url);

const CHECKS_EMOJI: Record<Exclude<ChecksState, 'none'>, string> = {
  passing: 'done',
  pending: 'running',
  failing: 'blocked'
};

// The card's line under Ready to merge; undefined when the head has no checks.
export const checksLine = (
  summary: ChecksSummary,
  { timeZone, emojiPrefix }: { timeZone: string; emojiPrefix: string }
): string | undefined => {
  if (summary.state === 'none') {
    return undefined;
  }
  const emoji = slackEmoji(emojiPrefix, CHECKS_EMOJI[summary.state]);
  const count = `${summary.passed} of ${summary.total}`;
  if (summary.state === 'passing') {
    const at = summary.finishedAt ? ` at ${clock(summary.finishedAt, timeZone)}` : '';
    return `${emoji} *Checks passed:* ${count}${at}.`;
  }
  if (summary.state === 'failing') {
    const names = summary.failed.map(({ name, url }) =>
      linkable(url) ? `<${url}|${escapeSlack(name)}>` : escapeSlack(name)
    );
    return `${emoji} *Checks failing:* ${listText(names)}.`;
  }
  const running = summary.running.map(escapeSlack);
  const waiting = summary.waiting.map(escapeSlack);
  const clauses = [
    running.length > 0 ? `${listText(running)} ${running.length === 1 ? 'is' : 'are'} running` : undefined,
    waiting.length > 0 ? `${listText(waiting)} ${waiting.length === 1 ? 'hasn’t' : 'haven’t'} started` : undefined
  ].filter((clause) => clause !== undefined);
  return `${emoji} *Checks running:* ${count} passed. ${clauses.join('; ')}.`;
};

// The thread's reply once the checks pass on a head the console brought up to date.
export const checksPassedText = (prNumber: number, summary: ChecksSummary): string =>
  `Checks passed on PR #${prNumber} (${summary.passed} of ${summary.total}) after bringing it up to date. Approve and merge is on the card.`;
