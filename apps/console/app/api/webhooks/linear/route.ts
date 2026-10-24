import { verifyLinearWebhook } from '@mb-factory/core';

import { requireEnv } from '@/lib/env';
import { recordEvent } from '@/lib/events';
import { log } from '@/lib/log';

type LinearWebhook = {
  type: string;
  action?: string;
  agentSession?: { id: string; issue?: { identifier?: string } };
};

export const POST = async (request: Request) => {
  const rawBody = await request.text();
  const verification = verifyLinearWebhook({
    rawBody,
    signature: request.headers.get('linear-signature'),
    secret: requireEnv('LINEAR_WEBHOOK_SECRET'),
    now: new Date()
  });

  if (!verification.ok) {
    log('warn', 'linear webhook rejected', { reason: verification.reason });
    return new Response('invalid signature', { status: 401 });
  }

  const event = JSON.parse(rawBody) as LinearWebhook;
  const delivery = request.headers.get('linear-delivery');
  const isNew = await recordEvent({
    source: 'linear',
    deliveryId: delivery,
    type: event.type,
    action: event.action,
    payload: event
  });
  log('info', 'linear webhook received', {
    delivery,
    duplicate: !isNew,
    type: event.type,
    action: event.action,
    agentSessionId: event.agentSession?.id,
    issue: event.agentSession?.issue?.identifier
  });

  return new Response(null, { status: 200 });
};
