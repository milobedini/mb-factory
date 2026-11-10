import { z } from 'zod';

import type { MergeQueueState, SlackCard } from './card';
import { CARD_COLOURS, linkButton, STATUS_EMOJI } from './card';
import type { ChecksSummary } from './checks';
import { checksLine } from './checks';
import type { FactoryConfig } from './config';
import type { Bump, DependencyPr } from './dependencies';
import { DEPENDABOT_LOGIN, readBump, readGroupedBumps } from './dependencies';
import type { SlackBlock } from './slack';
import { escapeSlack, slackEmoji } from './slack';

// Dependabot's routine updates (a patch or minor, alone or in a group) merge themselves: one small card in the channel
// when Dependabot opens the PR, no Linear issue. Once every check passes and the merge rules leave it to the factory,
// the App adds it to the merge queue, and the watch after merging follows as for express. Recorded as an event, so it
// needs no table: the card's message is the record's `channel` and `ts`.

export const DEPENDENCY_UPDATE_EVENT = 'dependency_update';

const bumpSchema = z.object({ name: z.string(), from: z.string(), to: z.string() });

export const dependencyUpdateSchema = z.object({
  repository: z.string().min(1),
  prNumber: z.int().positive(),
  url: z.url(),
  branch: z.string().min(1),
  title: z.string().min(1),
  updates: z.array(bumpSchema),
  // How many updates the PR makes; a big group's description lists only some of them.
  total: z.int().nonnegative(),
  security: z.boolean(),
  // Dependabot's group, as its title names it.
  group: z.string().nullable(),
  channel: z.string().min(1),
  ts: z.string().min(1),
  openedAt: z.iso.datetime()
});

export type DependencyUpdate = z.infer<typeof dependencyUpdateSchema>;

export const readDependencyUpdate = (payload: unknown): DependencyUpdate | undefined =>
  dependencyUpdateSchema.safeParse(payload).data;

// Dependabot's branches name the ecosystem: `dependabot/npm_and_yarn/…`, `dependabot/uv/…`, `dependabot/github_actions/…`.
const ECOSYSTEMS: [string, string][] = [
  ['npm_and_yarn', 'npm'],
  ['uv', 'Python'],
  ['pip', 'Python'],
  ['github_actions', 'Actions']
];

const ecosystemOf = (branch: string): string | undefined =>
  ECOSYSTEMS.find(([segment]) => branch.split('/')[1] === segment)?.[1];

// "Bump the npm-minor-and-patch group across 1 directory with 13 updates" says how many; a single bump is one.
const countOf = (title: string, listed: number): number => {
  const counted = /\bwith (\d+) updates?\b/i.exec(title)?.[1];
  return counted ? Number(counted) : Math.max(listed, 1);
};

// What the card says the PR is, and the updates it lists, from what Dependabot opened.
export const dependencyUpdateFor = (
  pr: DependencyPr,
  message: { channel: string; ts: string },
  at: Date
): DependencyUpdate => {
  const single = readBump(pr.title);
  const updates = single ? [single] : readGroupedBumps(pr.body ?? '');
  const total = countOf(pr.title, updates.length);
  const security = /^\[security\]/i.test(pr.title.trim());
  const ecosystem = ecosystemOf(pr.branch);
  const kind = ecosystem ? `${ecosystem} ` : '';
  const title = security ? `${kind}security update` : `${total} ${kind}update${total === 1 ? '' : 's'}`;
  return {
    repository: pr.repository,
    prNumber: pr.number,
    url: pr.url,
    branch: pr.branch,
    title: title.charAt(0).toUpperCase() + title.slice(1),
    updates,
    total,
    security,
    group: /\bthe (\S+) group\b/i.exec(pr.title)?.[1] ?? null,
    ...message,
    openedAt: at.toISOString()
  };
};

const MAX_LISTED = 4;

const bumpText = ({ name, from, to }: Bump): string => `${escapeSlack(name)} ${escapeSlack(from)} → ${escapeSlack(to)}`;

// The updates by name, at most four, then how many more.
export const updatesText = ({ updates, total }: Pick<DependencyUpdate, 'updates' | 'total'>): string | undefined => {
  if (updates.length === 0) {
    return undefined;
  }
  const shown = updates.slice(0, MAX_LISTED).map(bumpText);
  const more = Math.max(total, updates.length) - shown.length;
  return [...shown, ...(more > 0 ? [`and ${more} more`] : [])].join(' · ');
};

// Where the update stands, as the card says it.
export type DependencyUpdateStatus =
  | { kind: 'checking'; checks: ChecksSummary | null }
  | { kind: 'queued'; queue: Extract<MergeQueueState, { kind: 'queued' }> }
  | { kind: 'waiting'; reasons: string[] }
  | { kind: 'handed'; issue: { identifier: string; url: string } }
  | { kind: 'merged'; at: Date; sha: string | null; watchingUntil: Date | null }
  | { kind: 'closed'; at: Date };

const ORDINALS = ['1st', '2nd', '3rd'];

const clock = (at: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);

const statusLine = (
  update: DependencyUpdate,
  status: DependencyUpdateStatus,
  { timeZone, emojiPrefix }: { timeZone: string; emojiPrefix: string }
): { colour: string; line: string } => {
  const emoji = (name: string) => slackEmoji(emojiPrefix, name);
  const pr = `PR #${update.prNumber}`;
  if (status.kind === 'checking') {
    const checks = status.checks ? checksLine(status.checks, { timeZone, emojiPrefix }) : undefined;
    // Failing checks hand the PR to the factory, which says so here once it has filed the issue.
    const then = status.checks?.state === 'failing' ? '' : 'It goes into the merge queue by itself once they all pass.';
    return {
      colour: CARD_COLOURS.running,
      line: checks ? `${checks} ${then}`.trim() : `${emoji(STATUS_EMOJI.running)} *Checks running.* ${then}`
    };
  }
  if (status.kind === 'queued') {
    const { at, ahead } = status.queue;
    const place =
      ahead === null
        ? ''
        : ahead.length === 0
          ? '\n1st in line.'
          : `\n${ORDINALS[ahead.length] ?? `${ahead.length + 1}th`} in line, behind ${ahead.map((n: number) => `#${n}`).join(', ')}.`;
    return {
      colour: CARD_COLOURS.merging,
      line: `${emoji(STATUS_EMOJI.merging)} *In the merge queue:* added ${pr} by itself at ${clock(at, timeZone)}, with every check passing.${place}`
    };
  }
  if (status.kind === 'waiting') {
    return {
      colour: CARD_COLOURS.waiting,
      line: `${emoji(STATUS_EMOJI.waiting)} *Waits for you:* ${status.reasons.map(escapeSlack).join('; ')}.`
    };
  }
  if (status.kind === 'handed') {
    const { identifier, url } = status.issue;
    return {
      colour: CARD_COLOURS.stopped,
      line: `${emoji(STATUS_EMOJI.blocked)} *Checks failing:* I filed <${url}|${escapeSlack(identifier)}> to fix it, keeping the updates. Followed in its thread from here.`
    };
  }
  if (status.kind === 'merged') {
    const commit = status.sha ? ` · ${status.sha.slice(0, 7)} on main` : '';
    const watching = status.watchingUntil
      ? ` · watching production until ${clock(status.watchingUntil, timeZone)}`
      : '';
    return {
      colour: CARD_COLOURS.merged,
      line: `${emoji(STATUS_EMOJI.merged)} *Merged by itself* at ${clock(status.at, timeZone)}${watching || commit}.`
    };
  }
  return {
    colour: CARD_COLOURS.canceled,
    line: `${emoji(STATUS_EMOJI.canceled)} *Closed* at ${clock(status.at, timeZone)} without merging.`
  };
};

const section = (text: string): SlackBlock => ({ type: 'section', text: { type: 'mrkdwn', text } });

const context = (text: string): SlackBlock => ({ type: 'context', elements: [{ type: 'mrkdwn', text }] });

// The routine update's card: the PR and what it updates, where it stands, and Open PR while it's open.
export const dependencyUpdateCard = (
  update: DependencyUpdate,
  status: DependencyUpdateStatus,
  options: { timeZone: string; emojiPrefix: string }
): SlackCard => {
  const { colour, line } = statusLine(update, status, options);
  const updates = updatesText(update);
  const { group, security } = update;
  const meta = ['Dependabot', ...(security ? ['security update'] : []), ...(group ? [escapeSlack(group)] : [])];
  const open = status.kind !== 'merged' && status.kind !== 'closed' && status.kind !== 'handed';
  return {
    text: `PR #${update.prNumber} ${update.title}`,
    blocks: [section(`*<${update.url}|PR #${update.prNumber}> ${escapeSlack(update.title)}*`)],
    attachments: [
      {
        color: colour,
        blocks: [
          ...(updates ? [context(updates)] : []),
          section(line),
          context(meta.join(' · ')),
          ...(open
            ? [{ type: 'actions', elements: [linkButton('pr_open', `Open PR #${update.prNumber}`, update.url)] }]
            : [])
        ]
      }
    ]
  };
};

// Who hears when a routine update waits or its watch finds something: everyone in the project's people with Slack.
export const dependencyMentions = ({ people }: Pick<FactoryConfig, 'people'>): string | undefined => {
  const mentions = people.flatMap(({ slack }) => (slack ? [`<@${slack}>`] : []));
  return mentions.length > 0 ? mentions.join(' ') : undefined;
};

// Dependabot's own commits are authored by it and committed and signed by GitHub. An author can be faked by email, the
// signature can't, so a PR merges itself only when every commit is so: a person's push makes it wait for them.
export const onlyDependabotCommits = (
  commits: { author: string | null; committer: string | null; verified: boolean }[]
): boolean =>
  commits.length > 0 &&
  commits.length < 100 &&
  commits.every(
    ({ author, committer, verified }) => author === DEPENDABOT_LOGIN && committer === 'web-flow' && verified
  );
