import { setTimeout as sleep } from 'node:timers/promises';
import type { ChecksState, DispatchPayload } from '@mb-factory/core';
import { checksState, DISPATCH_EVENT } from '@mb-factory/core';

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

const MERGEABLE_POLL_MS = 2000;

export type MergeState = { mergeable: boolean | null; base: string };

// Whether a PR merges into its base branch; `mergeable` is null while GitHub works it out. Asking starts that, so a
// `null` is asked again a few times, a couple of seconds apart.
export const pullMergeState = async (repository: string, prNumber: number, attempts = 5): Promise<MergeState> => {
  const { mergeable, base } = await githubGet<{ mergeable: boolean | null; base: { ref: string } }>(
    `/repos/${repository}/pulls/${prNumber}`,
    'pull request'
  );
  if (mergeable !== null || attempts <= 1) {
    return { mergeable, base: base.ref };
  }
  await sleep(MERGEABLE_POLL_MS);
  return pullMergeState(repository, prNumber, attempts - 1);
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
