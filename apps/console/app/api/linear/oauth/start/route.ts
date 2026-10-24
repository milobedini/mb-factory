import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';

import { buildAuthorizeUrl, STATE_COOKIE } from '@/lib/linear-oauth';

export const GET = async () => {
  const state = randomBytes(24).toString('base64url');
  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/linear/oauth'
  });
  return Response.redirect(buildAuthorizeUrl(state), 302);
};
