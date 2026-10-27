import { setTimeout as sleep } from 'node:timers/promises';
import type { ChangedFile, ChecksState, DispatchPayload, ReviewThread, ScheduledRun } from '@mb-factory/core';
import { checksState, currentMergeable, DISPATCH_EVENT } from '@mb-factory/core';

import { requireEnv } from './env';

const API_URL = 'https://api.github.com';

// GITHUB_DISPATCH_TOKEN reaches project repos; GITHUB_GOVERNOR_TOKEN only runs this repo's governor workflow.
type TokenName = 'GITHUB_DISPATCH_TOKEN' | 'GITHUB_GOVERNOR_TOKEN';

const githubRequest = async (path: string, body?: unknown, token: TokenName = 'GITHUB_DISPATCH_TOKEN') =>
  fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${requireEnv(token)}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

const failure = async (action: string, response: Response): Promise<Error> =>
  new Error(`GitHub ${action} failed with ${response.status}: ${(await response.text()).slice(0, 200)}`);

// The project's `factory.yml` turns this into a stage run.
export const sendStageDispatch = async (repository: string, payload: DispatchPayload): Promise<void> => {
  const response = await githubRequest(`/repos/${repository}/dispatches`, {
    event_type: DISPATCH_EVENT,
    client_payload: payload
  });
  if (!response.ok) {
    throw await failure('repository dispatch', response);
  }
};

// 409 means the run already finished, which is what cancelling wanted.
export const cancelActionsRun = async (repository: string, actionsRunId: string): Promise<void> => {
  const response = await githubRequest(`/repos/${repository}/actions/runs/${encodeURIComponent(actionsRunId)}/cancel`);
  if (!response.ok && response.status !== 409) {
    throw await failure('run cancel', response);
  }
};

// Asking someone already requested changes nothing, so a PR that comes back to the gate asks again harmlessly.
export const requestReviewers = async (repository: string, prNumber: number, reviewers: string[]): Promise<void> => {
  const response = await githubRequest(`/repos/${repository}/pulls/${prNumber}/requested_reviewers`, { reviewers });
  if (!response.ok) {
    throw await failure('review request', response);
  }
};

// A comment on the PR's conversation, such as the decisions taken on review's questions.
export const commentOnPullRequest = async (repository: string, prNumber: number, body: string): Promise<void> => {
  const response = await githubRequest(`/repos/${repository}/issues/${prNumber}/comments`, { body });
  if (!response.ok) {
    throw await failure('PR comment', response);
  }
};

const githubGraphql = async <T>(query: string, variables: Record<string, unknown>, action: string): Promise<T> => {
  const response = await githubRequest('/graphql', { query, variables });
  if (!response.ok) {
    throw await failure(action, response);
  }
  const { data, errors } = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (errors?.length || !data) {
    throw new Error(`GitHub ${action} failed: ${errors?.map(({ message }) => message).join('; ') ?? 'no data'}`);
  }
  return data;
};

type ThreadsData = {
  repository: {
    pullRequest: {
      reviewThreads: {
        nodes: { id: string; isResolved: boolean; comments: { nodes: { author: { login: string } | null }[] } }[];
      };
    } | null;
  } | null;
};

// A PR's review threads with who started each; a factory PR stays well under a hundred.
export const pullReviewThreads = async (repository: string, prNumber: number): Promise<ReviewThread[]> => {
  const [owner, name] = repository.split('/');
  const data = await githubGraphql<ThreadsData>(
    `query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          reviewThreads(first: 100) { nodes { id isResolved comments(first: 1) { nodes { author { login } } } } }
        }
      }
    }`,
    { owner, name, number: prNumber },
    'review threads'
  );
  return (data.repository?.pullRequest?.reviewThreads.nodes ?? []).map((thread) => ({
    id: thread.id,
    isResolved: thread.isResolved,
    author: thread.comments.nodes[0]?.author?.login ?? null
  }));
};

export const resolveReviewThread = async (threadId: string): Promise<void> => {
  await githubGraphql(
    'mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id } } }',
    { id: threadId },
    'resolve review thread'
  );
};

// The Usage page's Refresh: one governor run that probes whatever the readings say.
export const startGovernorProbe = async (): Promise<void> => {
  const response = await githubRequest(
    '/repos/milobedini/mb-factory/actions/workflows/governor.yml/dispatches',
    { ref: 'main', inputs: { probe: 'true' } },
    'GITHUB_GOVERNOR_TOKEN'
  );
  if (!response.ok) {
    throw await failure('governor dispatch', response);
  }
};

const githubGet = async <T>(path: string, action: string): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${requireEnv('GITHUB_DISPATCH_TOKEN')}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (!response.ok) {
    throw await failure(action, response);
  }
  return (await response.json()) as T;
};

// GitHub usually answers within seconds but has taken longer than 20 s after a merge (TAS-33, 26 Oct), so the pauses
// grow to a little over two minutes in all; the push check runs after the webhook has been answered.
const MERGEABLE_PAUSES_MS = [2, 2, 2, 2, 2, 5, 10, 20, 30, 60].map((seconds) => seconds * 1000);

export type MergeState = { mergeable: boolean | null; base: string };

type Pull = {
  mergeable: boolean | null;
  merge_commit_sha: string | null;
  base: { ref: string };
  head: { sha: string };
};

// Whether a PR merges into its base branch; `mergeable` is null while GitHub works it out, and can be an answer for
// the old heads just after a push (`currentMergeable`). Asking starts the work, so an unknown is asked again after each
// pause in turn.
export const pullMergeState = async (
  repository: string,
  prNumber: number,
  pauses: number[] = MERGEABLE_PAUSES_MS
): Promise<MergeState> => {
  const pull = await githubGet<Pull>(`/repos/${repository}/pulls/${prNumber}`, 'pull request');
  const [branch, testMerge] = await Promise.all([
    githubGet<{ commit: { sha: string } }>(
      `/repos/${repository}/branches/${encodeURIComponent(pull.base.ref)}`,
      'base branch'
    ),
    pull.mergeable && pull.merge_commit_sha
      ? githubGet<{ parents: { sha: string }[] }>(`/repos/${repository}/commits/${pull.merge_commit_sha}`, 'test merge')
      : undefined
  ]);
  const mergeable = currentMergeable({
    mergeable: pull.mergeable,
    testMergeParents: testMerge?.parents.map(({ sha }) => sha),
    baseHead: branch.commit.sha,
    prHead: pull.head.sha
  });
  const [pause, ...rest] = pauses;
  if (mergeable !== null || pause === undefined) {
    return { mergeable, base: pull.base.ref };
  }
  await sleep(pause);
  return pullMergeState(repository, prNumber, rest);
};

type WorkflowRuns = { workflow_runs: { workflow_id: number; status: string; conclusion: string | null }[] };

// A PR branch's CI for the Inbox: the latest pull_request run of each workflow (GitHub lists newest first). Actions
// read is enough, where the check-runs API would need the Checks permission too.
export const branchChecks = async (repository: string, branch: string): Promise<ChecksState> => {
  const query = new URLSearchParams({ branch, event: 'pull_request', per_page: '50' });
  const { workflow_runs: workflowRuns } = await githubGet<WorkflowRuns>(
    `/repos/${repository}/actions/runs?${query}`,
    'workflow runs'
  );
  const latest = workflowRuns.filter(
    (run, index) => workflowRuns.findIndex(({ workflow_id }) => workflow_id === run.workflow_id) === index
  );
  return checksState(latest);
};

type ScheduledRuns = {
  workflow_runs: { name: string | null; conclusion: string | null; created_at: string; html_url: string }[];
};

// A repo's scheduled Actions runs created since a moment, for the health check; a day's worth fits one page.
export const scheduledRuns = async (repository: string, since: Date): Promise<ScheduledRun[]> => {
  const query = new URLSearchParams({ event: 'schedule', created: `>=${since.toISOString()}`, per_page: '100' });
  const { workflow_runs: workflowRuns } = await githubGet<ScheduledRuns>(
    `/repos/${repository}/actions/runs?${query}`,
    'scheduled runs'
  );
  return workflowRuns.map((run) => ({
    repository,
    workflow: run.name ?? 'unnamed workflow',
    conclusion: run.conclusion,
    createdAt: new Date(run.created_at),
    url: run.html_url
  }));
};

// A PR's head commit and base branch now.
export const pullHead = async (repository: string, prNumber: number): Promise<{ head: string; base: string }> => {
  const pull = await githubGet<{ head: { sha: string }; base: { ref: string } }>(
    `/repos/${repository}/pulls/${prNumber}`,
    'pull request'
  );
  return { head: pull.head.sha, base: pull.base.ref };
};

export const defaultBranch = async (repository: string): Promise<string> =>
  (await githubGet<{ default_branch: string }>(`/repos/${repository}`, 'repository')).default_branch;

// Whether a branch already holds a commit: comparing the commit to the branch finds the branch ahead or the same.
export const branchContains = async (repository: string, branch: string, sha: string): Promise<boolean> => {
  const { status } = await githubGet<{ status: string }>(
    `/repos/${repository}/compare/${sha}...${encodeURIComponent(branch)}`,
    'compare'
  );
  return status === 'ahead' || status === 'identical';
};

export const commitParents = async (repository: string, sha: string): Promise<string[]> =>
  (await githubGet<{ parents: { sha: string }[] }>(`/repos/${repository}/commits/${sha}`, 'commit')).parents.map(
    (parent) => parent.sha
  );

// The files `head` changes since its merge base with `base`, or undefined past GitHub's 300-file page, which is too
// big a change to judge from a compare.
export const compareFiles = async (
  repository: string,
  base: string,
  head: string
): Promise<ChangedFile[] | undefined> => {
  const { files } = await githubGet<{ files?: ChangedFile[] }>(
    `/repos/${repository}/compare/${base}...${head}`,
    'compare'
  );
  return files && files.length < 300
    ? files.map(({ filename, status, sha, patch }) => ({ filename, status, sha, patch }))
    : undefined;
};

const PULL_FILES_PAGE = 100;
// GitHub lists at most 3,000 of a PR's files.
const PULL_FILES_PAGES = 30;

// The paths a PR changes, page by page until a short page.
export const pullFiles = async (repository: string, prNumber: number, page = 1): Promise<string[]> => {
  const files = await githubGet<{ filename: string }[]>(
    `/repos/${repository}/pulls/${prNumber}/files?per_page=${PULL_FILES_PAGE}&page=${page}`,
    'pull request files'
  );
  const names = files.map(({ filename }) => filename);
  return files.length < PULL_FILES_PAGE || page >= PULL_FILES_PAGES
    ? names
    : [...names, ...(await pullFiles(repository, prNumber, page + 1))];
};

export type PullRequestInfo = {
  author: string;
  title: string;
  url: string;
  branch: string;
  // Where the head branch lives: a fork's PR is never taken on.
  headRepository: string | null;
};

export const pullRequestInfo = async (repository: string, prNumber: number): Promise<PullRequestInfo> => {
  const pull = await githubGet<{
    user: { login: string };
    title: string;
    html_url: string;
    head: { ref: string; repo: { full_name: string } | null };
  }>(`/repos/${repository}/pulls/${prNumber}`, 'pull request');
  return {
    author: pull.user.login,
    title: pull.title,
    url: pull.html_url,
    branch: pull.head.ref,
    headRepository: pull.head.repo?.full_name ?? null
  };
};
