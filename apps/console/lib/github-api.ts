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

type WorkflowRuns = { workflow_runs: { workflow_id: number; status: string; conclusion: string | null }[] };

// A PR branch's CI for the Inbox: the latest pull_request run of each workflow (GitHub lists newest first). Actions
// read is enough, where the check-runs API would need the Checks permission too.
export const branchChecks = async (repository: string, branch: string): Promise<ChecksState> => {
  const query = new URLSearchParams({ branch, event: 'pull_request', per_page: '50' });
  const response = await fetch(`${API_URL}/repos/${repository}/actions/runs?${query}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${requireEnv('GITHUB_DISPATCH_TOKEN')}`,
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
  if (!response.ok) {
    throw await failure('workflow runs', response);
  }
  const { workflow_runs: workflowRuns } = (await response.json()) as WorkflowRuns;
  const latest = workflowRuns.filter(
    (run, index) => workflowRuns.findIndex(({ workflow_id }) => workflow_id === run.workflow_id) === index
  );
  return checksState(latest);
};
