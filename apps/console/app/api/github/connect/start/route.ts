import { cookies } from 'next/headers';

import { CONNECT_COOKIE, CONNECT_COOKIE_PATH, startConnect } from '@/lib/github-connect';

// Connect GitHub, from Slack's button or the Usage page: GitHub asks the person to authorise the factory's app.
export const GET = async () => {
  const { state, verifier, url } = startConnect();
  (await cookies()).set(CONNECT_COOKIE, JSON.stringify({ state, verifier }), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: CONNECT_COOKIE_PATH
  });
  return Response.redirect(url, 302);
};
