import { verifyLinearWebhook } from '@mb-factory/core';
import { after } from 'next/server';

import { requireEnv } from '@/lib/env';
import { recordEvent } from '@/lib/events';
import { createAgentActivity } from '@/lib/linear-api';
import { log } from '@/lib/log';
import { handleAgentSessionEvent } from '@/lib/router';

type LinearWebhook = {
  type: string;
  action?: string;
  organizationId: string;
  agentSession?: { id: string; issue?: { identifier?: string } };
};

// The router posts the session's first activity; if it throws first, the session still hears back within Linear's 10 s.
const routeSessionEvent = async (event: LinearWebhook): Promise<void> => {
  if (event.type !== 'AgentSessionEvent' || !event.agentSession) {
    return;
  }
  try {
    await handleAgentSessionEvent(event);
  } catch (error) {
    log('error', 'agent session routing failed', {
      agentSessionId: event.agentSession.id,
      action: event.action,
      error: error instanceof Error ? error.message : String(error)
    });
    await createAgentActivity(event.organizationId, event.agentSession.id, {
      type: 'error',
      body: 'Something went wrong on my side before I could start. It’s in the console log; reply here to try again.'
    }).catch(() => undefined);
  }
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

  if (isNew) {
    after(() => routeSessionEvent(event));
  }

  return new Response(null, { status: 200 });
};
