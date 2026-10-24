import { verifySlackRequest } from '@mb-factory/core';

import { requireEnv } from '@/lib/env';
import { recordEvent } from '@/lib/events';
import { log } from '@/lib/log';

type SlackPayload =
  | { type: 'url_verification'; challenge: string }
  | { type: 'event_callback'; event_id: string; event: { type: string; channel?: string; user?: string } };

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
    log('warn', 'slack request rejected', { reason: verification.reason });
    return new Response('invalid signature', { status: 401 });
  }

  const payload = JSON.parse(rawBody) as SlackPayload;
  if (payload.type === 'url_verification') {
    return Response.json({ challenge: payload.challenge });
  }

  const isNew = await recordEvent({
    source: 'slack',
    deliveryId: payload.event_id,
    type: payload.event.type,
    payload
  });
  log('info', 'slack event received', {
    eventId: payload.event_id,
    duplicate: !isNew,
    type: payload.event.type,
    channel: payload.event.channel,
    retry: request.headers.get('x-slack-retry-num')
  });

  return new Response(null, { status: 200 });
};
