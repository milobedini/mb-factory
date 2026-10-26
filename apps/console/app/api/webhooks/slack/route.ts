import { verifySlackRequest } from '@mb-factory/core';
import { after } from 'next/server';

import { requireEnv } from '@/lib/env';
import { recordEvent } from '@/lib/events';
import { log } from '@/lib/log';
import { handleSlackMention, handleSlackMessage } from '@/lib/router';

type SlackPayload =
  | { type: 'url_verification'; challenge: string }
  | { type: 'event_callback'; event_id: string; event: { type: string; channel?: string; user?: string } };

const routeEvent = async (payload: SlackPayload, handle: (payload: unknown) => Promise<void>): Promise<void> => {
  try {
    await handle(payload);
  } catch (error) {
    log('error', 'slack event routing failed', {
      type: payload.type === 'event_callback' ? payload.event.type : payload.type,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

// Thread replies steer work and top-level mentions start it. A mention in a thread arrives as both; the `message`
// is the one acted on, and the mention handler ignores it.
const HANDLERS: Record<string, (payload: unknown) => Promise<void>> = {
  message: handleSlackMessage,
  app_mention: handleSlackMention
};

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

  const handle = HANDLERS[payload.event.type];
  if (isNew && handle) {
    after(() => routeEvent(payload, handle));
  }

  return new Response(null, { status: 200 });
};
