import { parseSlashCommand, verifySlackRequest } from '@mb-factory/core';
import { after } from 'next/server';

import { handleSlashCommand } from '@/lib/commands';
import { requireEnv } from '@/lib/env';
import { recordEvent } from '@/lib/events';
import { log } from '@/lib/log';
import { releaseQueueOnActivity } from '@/lib/router';

// The slash command. Slack wants an answer within 3 s, so the reply goes to the response URL after this one; an empty
// 200 shows nothing in Slack.
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
    log('warn', 'slack command rejected', { reason: verification.reason });
    return new Response('invalid signature', { status: 401 });
  }

  const form = new URLSearchParams(rawBody);
  // The verification token is deprecated and unused (the signature replaces it), so it isn't stored.
  form.delete('token');
  const command = parseSlashCommand(form);
  if (!command) {
    log('warn', 'slack command unreadable', { command: form.get('command') });
    return new Response(null, { status: 200 });
  }
  const isNew = await recordEvent({
    source: 'slack',
    deliveryId: `command:${command.triggerId}`,
    type: 'slash_command',
    action: command.text.split(/\s+/)[0] || 'status',
    payload: Object.fromEntries(form)
  });
  log('info', 'slack command received', { command: command.command, user: command.userId, duplicate: !isNew });

  after(() => releaseQueueOnActivity('slack command'));
  if (isNew) {
    after(() => handleSlashCommand(command));
  }
  return new Response(null, { status: 200 });
};
