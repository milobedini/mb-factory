import type { DispatchPayload } from '@mb-factory/core';
import { DISPATCH_EVENT } from '@mb-factory/core';

import { requireEnv } from './env';

const API_URL = 'https://api.github.com';

const githubRequest = async (path: string, body?: unknown): Promise<Response> =>
  fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${requireEnv('GITHUB_DISPATCH_TOKEN')}`,
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
