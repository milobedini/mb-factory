import { cookies } from 'next/headers';

import { OAUTH_COOKIE, OAUTH_COOKIE_PATH, startAuthorization } from '@/lib/github-oauth';

export const GET = async () => {
  const { state, verifier, url } = startAuthorization();
  (await cookies()).set(OAUTH_COOKIE, JSON.stringify({ state, verifier }), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: OAUTH_COOKIE_PATH
  });
  return Response.redirect(url, 302);
};
