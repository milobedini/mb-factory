import { z } from 'zod';

import type { FactoryConfig } from './config';
import type { DependencyPr } from './dependencies';
import { DEPENDABOT_LOGIN } from './dependencies';
import { linearStatusFor } from './router';
import type { Stage } from './stages';
import { STAGES, TERMINAL_STAGES, transition } from './stages';

// GitHub's pull_request and push webhooks: only the fields the router reads.
const repositorySchema = z.looseObject({ full_name: z.string().min(1), default_branch: z.string().nullish() });

const pullRequestEventSchema = z.looseObject({
  action: z.string(),
  repository: repositorySchema,
  pull_request: z.looseObject({
    number: z.int().positive(),
    title: z.string().nullish(),
    html_url: z.url({ protocol: /^https$/ }).nullish(),
    user: z.looseObject({ login: z.string() }).nullish(),
    merged: z.boolean().nullish(),
    merged_by: z.looseObject({ id: z.int(), login: z.string() }).nullish(),
    merge_commit_sha: z.string().nullish(),
    head: z.looseObject({ ref: z.string().min(1), repo: z.looseObject({ full_name: z.string() }).nullish() })
  })
});

const pushEventSchema = z.looseObject({
  ref: z.string(),
  deleted: z.boolean().nullish(),
  forced: z.boolean().nullish(),
  repository: repositorySchema,
  sender: z.looseObject({ login: z.string().min(1), type: z.string() }),
  commits: z.array(z.unknown()).nullish()
});

const workflowRunEventSchema = z.looseObject({
  action: z.string(),
  repository: repositorySchema,
  workflow_run: z.looseObject({
    name: z.string().min(1),
    event: z.string(),
    conclusion: z.string().nullish(),
    html_url: z.url({ protocol: /^https$/ }).nullish(),
    head_sha: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .nullish(),
    head_repository: repositorySchema.nullish(),
    pull_requests: z.array(z.looseObject({ number: z.int().positive() }))
  })
});

export type GitHubEvent =
  | {
      kind: 'pr_closed';
      repository: string;
      number: number;
      branch: string;
      merged: boolean;
      // Who merged it, and the merge commit, when it was merged.
      mergedBy: { id: number; login: string } | null;
      mergeCommitSha: string | null;
    }
  | ({ kind: 'dependency_pr_opened' } & DependencyPr)
  | { kind: 'human_push'; repository: string; branch: string; login: string; commits: number }
  | { kind: 'default_branch_moved'; repository: string; branch: string }
  | {
      kind: 'ci_failed';
      repository: string;
      prNumbers: number[];
      workflow: string;
      url: string | null;
      // A check run on a deployment (a PR's preview) names its commit, not its PR, so the console looks the PR up.
      headSha?: string;
    };

const FAILED_CONCLUSIONS = ['failure', 'timed_out'];

// A check workflow that failed on a pull request from this repository, or on a deployment of one of its commits (a
// PR's preview checks), which GitHub doesn't tie to a PR. A cancelled run was superseded, not failed.
const parseWorkflowRun = (payload: unknown): GitHubEvent | undefined => {
  const parsed = workflowRunEventSchema.safeParse(payload);
  if (!parsed.success) {
    return undefined;
  }
  const { action, repository, workflow_run: run } = parsed.data;
  if (
    action !== 'completed' ||
    !FAILED_CONCLUSIONS.includes(run.conclusion ?? '') ||
    run.head_repository?.full_name !== repository.full_name
  ) {
    return undefined;
  }
  const failure = {
    kind: 'ci_failed',
    repository: repository.full_name,
    workflow: run.name,
    url: run.html_url ?? null
  };
  if (run.event === 'pull_request' && run.pull_requests.length > 0) {
    return { ...failure, kind: 'ci_failed', prNumbers: run.pull_requests.map(({ number }) => number) };
  }
  if (run.event === 'deployment_status' && run.head_sha) {
    return { ...failure, kind: 'ci_failed', prNumbers: [], headSha: run.head_sha };
  }
  return undefined;
};

const BRANCH_REF = 'refs/heads/';

// Returns undefined for anything the router doesn't act on.
export const parseGitHubEvent = (eventName: string, payload: unknown): GitHubEvent | undefined => {
  if (eventName === 'workflow_run') {
    return parseWorkflowRun(payload);
  }
  if (eventName === 'pull_request') {
    const parsed = pullRequestEventSchema.safeParse(payload);
    if (!parsed.success) {
      return undefined;
    }
    const { action, repository, pull_request } = parsed.data;
    // Factory PRs never come from forks; anyone can open one with a factory branch's name, so they're ignored.
    if (pull_request.head.repo?.full_name !== repository.full_name) {
      return undefined;
    }
    if (action === 'opened') {
      const { title, html_url: url, user } = pull_request;
      return user?.login === DEPENDABOT_LOGIN && title && url
        ? {
            kind: 'dependency_pr_opened',
            repository: repository.full_name,
            number: pull_request.number,
            branch: pull_request.head.ref,
            title,
            url
          }
        : undefined;
    }
    if (action !== 'closed') {
      return undefined;
    }
    return {
      kind: 'pr_closed',
      repository: repository.full_name,
      number: pull_request.number,
      branch: pull_request.head.ref,
      merged: pull_request.merged === true,
      mergedBy:
        pull_request.merged && pull_request.merged_by
          ? { id: pull_request.merged_by.id, login: pull_request.merged_by.login }
          : null,
      mergeCommitSha: pull_request.merged ? (pull_request.merge_commit_sha ?? null) : null
    };
  }
  if (eventName !== 'push') {
    return undefined;
  }
  const parsed = pushEventSchema.safeParse(payload);
  if (!parsed.success) {
    return undefined;
  }
  const { ref, deleted, forced, repository, sender, commits } = parsed.data;
  const count = commits?.length ?? 0;
  // Anything landing on the default branch, a merge or a direct push, can make open PRs conflict.
  if (!deleted && repository.default_branch && ref === `${BRANCH_REF}${repository.default_branch}`) {
    return { kind: 'default_branch_moved', repository: repository.full_name, branch: repository.default_branch };
  }
  // The factory pushes as a bot, and merging a PR deletes its branch with an empty push from whoever merged.
  if (!ref.startsWith(BRANCH_REF) || deleted || sender.type !== 'User' || (count === 0 && !forced)) {
    return undefined;
  }
  return {
    kind: 'human_push',
    repository: repository.full_name,
    branch: ref.slice(BRANCH_REF.length),
    login: sender.login,
    commits: count
  };
};

export const stageAfterPrClosed = (stage: Stage, merged: boolean): Stage | undefined => {
  const result = transition(
    stage,
    { type: merged ? 'merged' : 'closed_unmerged' },
    {
      reviewRounds: 0,
      maxReviewRounds: 0
    }
  );
  return result.ok ? result.stage : undefined;
};

// Linear's Issue webhook (action `update`): `updatedFrom` holds the previous value of each field that changed.
const issueUpdateSchema = z.looseObject({
  type: z.literal('Issue'),
  // A new issue reads as one whose status was just set, so one written straight into Backlog is sized too.
  action: z.enum(['create', 'update']),
  organizationId: z.string().min(1),
  actor: z.looseObject({ id: z.string().min(1), type: z.string().nullish() }).nullish(),
  data: z.looseObject({
    id: z.string().min(1),
    identifier: z.string().min(1),
    delegateId: z.string().nullish(),
    estimate: z.number().nullish(),
    project: z.looseObject({ name: z.string().min(1), url: z.string().nullish() }).nullish(),
    projectMilestone: z.looseObject({ name: z.string().min(1) }).nullish(),
    state: z.looseObject({ name: z.string().min(1), type: z.string().min(1) }),
    team: z.looseObject({ key: z.string().min(1) }).nullish()
  }),
  updatedFrom: z.looseObject({ delegateId: z.string().nullish() }).nullish()
});

export type LinearState = { name: string; type: string };

export type IssueUpdate = {
  organizationId: string;
  issueId: string;
  identifier: string;
  teamKey: string | null;
  actorId: string | null;
  // `user` for a person (or the factory's own app user); `integration` for GitHub and the like; null when Linear names none.
  actorType: string | null;
  // The issue's current estimate, project and milestone, whether or not this update changed them.
  estimate: number | null;
  project: { name: string; url: string | null } | null;
  milestone: string | null;
  // Whether the issue is delegated now, whether or not this update changed it.
  delegated: boolean;
  // Set only when this update changed the field.
  state?: LinearState;
  delegate?: { from: string | null; to: string | null };
};

export const parseIssueUpdate = (payload: unknown): IssueUpdate | undefined => {
  const parsed = issueUpdateSchema.safeParse(payload);
  if (!parsed.success) {
    return undefined;
  }
  const { organizationId, actor, action, data, updatedFrom } = parsed.data;
  const changed = (field: string): boolean =>
    action === 'create' || (updatedFrom !== null && updatedFrom !== undefined && Object.hasOwn(updatedFrom, field));
  return {
    organizationId,
    issueId: data.id,
    identifier: data.identifier,
    teamKey: data.team?.key ?? null,
    actorId: actor?.id ?? null,
    actorType: actor?.type ?? null,
    estimate: data.estimate ?? null,
    project: data.project ? { name: data.project.name, url: data.project.url ?? null } : null,
    milestone: data.projectMilestone?.name ?? null,
    delegated: (data.delegateId ?? null) !== null,
    ...(changed('stateId') ? { state: { name: data.state.name, type: data.state.type } } : {}),
    ...(changed('delegateId')
      ? { delegate: { from: updatedFrom?.delegateId ?? null, to: data.delegateId ?? null } }
      : {})
  };
};

// A completed or canceled status settles the work item, whatever it's called; other statuses match by name.
export const stageForLinearState = (config: FactoryConfig, { name, type }: LinearState): Stage | undefined => {
  if (type === 'completed') {
    return 'done';
  }
  if (type === 'canceled') {
    return 'canceled';
  }
  return STAGES.find((stage) => linearStatusFor(config, stage) === name);
};

// Why the router cancels a work item's open runs, other than a stop from the Linear session.
export type StopCause =
  | { kind: 'undelegated' }
  | { kind: 'issue_closed'; status: string }
  | { kind: 'pr_closed'; number: number; merged: boolean }
  | { kind: 'console'; login: string };

export type IssueUpdateActions = { stage?: Stage; stop?: StopCause };

// Follows a human's status change and undelegation. The factory's own moves come back as updates too; it already recorded them.
export const decideIssueUpdate = (
  update: IssueUpdate,
  { config, appUserId, stage }: { config: FactoryConfig; appUserId: string; stage: Stage }
): IssueUpdateActions => {
  const byFactory = update.actorId === appUserId;
  const followed = !byFactory && update.state ? stageForLinearState(config, update.state) : undefined;
  const nextStage = followed !== stage ? followed : undefined;
  const undelegated = update.delegate?.from === appUserId && update.delegate.to !== appUserId;
  const closedAs = nextStage && TERMINAL_STAGES.includes(nextStage) ? update.state?.name : undefined;
  const stop: StopCause | undefined = undelegated
    ? { kind: 'undelegated' }
    : closedAs
      ? { kind: 'issue_closed', status: closedAs }
      : undefined;
  return { ...(nextStage ? { stage: nextStage } : {}), ...(stop ? { stop } : {}) };
};

export const prClosedText = (number: number, merged: boolean): string =>
  merged ? `PR #${number} merged.` : `PR #${number} closed without merging.`;

// The canceled runs' summary, and the message to Linear and Slack when there was something to stop.
export const stoppedText = (cause: StopCause): string => {
  if (cause.kind === 'undelegated') {
    return 'Stopped: the issue is no longer delegated to me. Delegate it again to carry on from the branch.';
  }
  if (cause.kind === 'issue_closed') {
    return `Stopped: the issue was moved to ${cause.status}.`;
  }
  if (cause.kind === 'console') {
    return `Stopped from the console by ${cause.login}.`;
  }
  return `Stopped: PR #${cause.number} was ${cause.merged ? 'merged' : 'closed without merging'}.`;
};
