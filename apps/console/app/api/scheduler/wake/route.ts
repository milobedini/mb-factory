import { handleCallback } from '@vercel/queue';

import { wake } from '@/lib/scheduler';

// Vercel Queues delivers the console's own delayed wake-ups here (`vercel.json` registers the topic). Throwing leaves
// the message for redelivery, which the wake-up tolerates.
export const POST = handleCallback(async (message: { cause?: string }) => {
  await wake(`queued wake-up (${message.cause ?? 'unknown'})`);
});
