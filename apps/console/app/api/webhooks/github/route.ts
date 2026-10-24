import { verifyGitHubWebhook } from '@mb-factory/core';

import { requireEnv } from '@/lib/env';
import { log } from '@/lib/log';

type GitHubWebhook = {
  action?: string;
  repository?: { full_name?: string };
  pull_request?: { number?: number; merged?: boolean };
};

export const POST = async (request: Request) => {
  const rawBody = await request.text();
  const verification = verifyGitHubWebhook({
    rawBody,
    signature: request.headers.get('x-hub-signature-256'),
    secret: requireEnv('GITHUB_WEBHOOK_SECRET')
  });

  if (!verification.ok) {
    log('warn', 'github webhook rejected', { reason: verification.reason });
    return new Response('invalid signature', { status: 401 });
  }

  const event = JSON.parse(rawBody) as GitHubWebhook;
  log('info', 'github webhook received', {
    delivery: request.headers.get('x-github-delivery'),
    event: request.headers.get('x-github-event'),
    action: event.action,
    repository: event.repository?.full_name,
    pullRequest: event.pull_request?.number,
    merged: event.pull_request?.merged
  });

  return new Response(null, { status: 200 });
};
