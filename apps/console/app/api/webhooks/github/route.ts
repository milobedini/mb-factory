import { verifyGitHubWebhook } from '@mb-factory/core';
import { after } from 'next/server';

import { requireEnv } from '@/lib/env';
import { recordEvent } from '@/lib/events';
import { log } from '@/lib/log';
import { handleGitHubEvent, releaseQueueOnActivity } from '@/lib/router';

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
  const delivery = request.headers.get('x-github-delivery');
  const eventName = request.headers.get('x-github-event') ?? 'unknown';
  const isNew = await recordEvent({
    source: 'github',
    deliveryId: delivery,
    type: eventName,
    action: event.action,
    payload: event
  });
  log('info', 'github webhook received', {
    delivery,
    duplicate: !isNew,
    event: eventName,
    action: event.action,
    repository: event.repository?.full_name,
    pullRequest: event.pull_request?.number,
    merged: event.pull_request?.merged
  });

  after(() => releaseQueueOnActivity('github webhook'));
  if (isNew) {
    after(async () => {
      try {
        await handleGitHubEvent(eventName, event);
      } catch (error) {
        log('error', 'github event routing failed', {
          delivery,
          event: eventName,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }

  return new Response(null, { status: 200 });
};
