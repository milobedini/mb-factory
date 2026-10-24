import { verifyLinearWebhook } from '@mb-factory/core';
import { after } from 'next/server';

import { requireEnv } from '@/lib/env';
import { recordEvent } from '@/lib/events';
import { createAgentActivity } from '@/lib/linear-api';
import { log } from '@/lib/log';

type LinearWebhook = {
  type: string;
  action?: string;
  organizationId: string;
  agentSession?: { id: string; issue?: { identifier?: string } };
};

const ACKNOWLEDGEMENT =
  'Picked this up. The factory is still being set up, so no stages run yet. This session is recorded in the console.';

const acknowledgeSession = async (event: LinearWebhook): Promise<void> => {
  if (event.type !== 'AgentSessionEvent' || event.action !== 'created' || !event.agentSession) {
    return;
  }
  try {
    await createAgentActivity(event.organizationId, event.agentSession.id, { type: 'thought', body: ACKNOWLEDGEMENT });
  } catch (error) {
    log('error', 'linear acknowledgement failed', {
      agentSessionId: event.agentSession.id,
      error: error instanceof Error ? error.message : String(error)
    });
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
    after(() => acknowledgeSession(event));
  }

  return new Response(null, { status: 200 });
};
