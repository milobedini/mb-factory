import { timingSafeEqual } from 'node:crypto';
import { connection } from 'next/server';

import { requireEnv } from '@/lib/env';
import { log } from '@/lib/log';
import { wake } from '@/lib/scheduler';

const isVercelCron = (request: Request): boolean => {
  const expected = Buffer.from(`Bearer ${requireEnv('CRON_SECRET')}`);
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
};

// The daily backstop (`vercel.json`): Vercel Cron sends `CRON_SECRET` as a bearer token. It books the next wake-up
// again in case a delayed message was lost.
export const GET = async (request: Request) => {
  await connection();
  if (!isVercelCron(request)) {
    log('warn', 'scheduler cron rejected');
    return new Response('unauthorised', { status: 401 });
  }
  return Response.json(await wake('daily cron'));
};
