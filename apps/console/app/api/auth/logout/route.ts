import { requireEnv } from '@/lib/env';
import { endSession } from '@/lib/session';

export const POST = async () => {
  await endSession();
  return Response.redirect(`${requireEnv('CONSOLE_URL')}/login`, 303);
};
