import { handleCallback } from '@vercel/queue';

import { log } from '@/lib/log';
import { wake } from '@/lib/scheduler';
import { isOwnWake } from '@/lib/wake';

// Vercel Queues delivers the console's own delayed wake-ups here (`vercel.json` registers the topic). A push delivery
// can run this on the request body before the queue service vouches for it, so only a message the console signed
// wakes anything; the rest are acknowledged and dropped. Throwing leaves a message for redelivery, which waking
// tolerates.
export const POST = handleCallback(async (message: unknown) => {
  if (!isOwnWake(message)) {
    log('warn', 'unsigned wake-up ignored');
    return;
  }
  await wake('queued wake-up');
});
