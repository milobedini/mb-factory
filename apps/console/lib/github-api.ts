import type { DispatchPayload } from '@mb-factory/core';
import { DISPATCH_EVENT } from '@mb-factory/core';

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
