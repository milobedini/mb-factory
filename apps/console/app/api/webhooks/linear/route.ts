import { requireEnv } from '@/lib/env';
import { log } from '@/lib/log';
import { verifyLinearWebhook } from '@mb-factory/core';

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
  log('info', 'linear webhook received', {
    delivery: request.headers.get('linear-delivery'),
    type: event.type,
    action: event.action,
    agentSessionId: event.agentSession?.id,
    issue: event.agentSession?.issue?.identifier
  });

  return new Response(null, { status: 200 });
};
