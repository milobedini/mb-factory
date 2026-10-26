import { createHash, timingSafeEqual } from 'node:crypto';
import { readingsFromStatusLine } from '@mb-factory/core';
import { after } from 'next/server';

import { requireEnv } from '@/lib/env';
import { log } from '@/lib/log';
import { releaseQueueOnActivity } from '@/lib/router';
import { recordReadings } from '@/lib/usage';

const digest = (value: string) => createHash('sha256').update(value).digest();

const isAuthorised = (request: Request): boolean => {
  const header = request.headers.get('authorization') ?? '';
  return timingSafeEqual(digest(header), digest(`Bearer ${requireEnv('USAGE_REPORT_TOKEN')}`));
};

// Your Mac's status line (`cli/status-line.sh`) posts `rate_limits` from Claude Code's status line input.
export const POST = async (request: Request) => {
  if (!isAuthorised(request)) {
    log('warn', 'local usage report rejected');
    return new Response('invalid token', { status: 401 });
  }
  const now = new Date();
  const readings = readingsFromStatusLine(await request.json().catch(() => undefined), now);
  if (!readings) {
    return new Response('invalid body', { status: 400 });
  }
  await recordReadings(readings, 'local', now);
  // Fresh readings are the likeliest moment for a usage hold to have cleared.
  after(() => releaseQueueOnActivity('local usage reading'));
  return Response.json({ readings: readings.length });
};
