import { verifySlackRequest } from '@mb-factory/core';
import { after } from 'next/server';

import { requireEnv } from '@/lib/env';
import { recordEvent } from '@/lib/events';
import { log } from '@/lib/log';
import { handleSlackAction, releaseQueueOnActivity } from '@/lib/router';

type InteractionPayload = {
  type?: string;
  user?: { id?: string };
  actions?: { action_id?: string; action_ts?: string }[];
};

const routeAction = async (payload: InteractionPayload): Promise<void> => {
  try {
    await handleSlackAction(payload);
  } catch (error) {
    log('error', 'slack action routing failed', {
      user: payload.user?.id,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

// Button taps. Slack wants an answer within 3 s, so the work happens after the response.
export const POST = async (request: Request) => {
  const rawBody = await request.text();
  const verification = verifySlackRequest({
    rawBody,
    signature: request.headers.get('x-slack-signature'),
    timestamp: request.headers.get('x-slack-request-timestamp'),
    secret: requireEnv('SLACK_SIGNING_SECRET'),
    now: new Date()
  });
  if (!verification.ok) {
    log('warn', 'slack interaction rejected', { reason: verification.reason });
    return new Response('invalid signature', { status: 401 });
  }

  const payload = JSON.parse(new URLSearchParams(rawBody).get('payload') ?? '{}') as InteractionPayload;
  const [action] = payload.actions ?? [];
  const isNew = await recordEvent({
    source: 'slack',
    deliveryId: action?.action_ts ? `action:${payload.user?.id}:${action.action_ts}` : undefined,
    type: payload.type ?? 'interaction',
    action: action?.action_id,
    payload
  });
  log('info', 'slack interaction received', { type: payload.type, action: action?.action_id, duplicate: !isNew });

  after(() => releaseQueueOnActivity('slack interaction'));
  if (isNew && payload.type === 'block_actions') {
    after(() => routeAction(payload));
  }
  return new Response(null, { status: 200 });
};
