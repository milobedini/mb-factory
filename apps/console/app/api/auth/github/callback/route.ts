import { cookies } from 'next/headers';

import { requireEnv } from '@/lib/env';
import { exchangeCode, fetchGitHubUser, OAUTH_COOKIE, OAUTH_COOKIE_PATH, revokeToken } from '@/lib/github-oauth';
import { log } from '@/lib/log';
import { allowedGitHubUserIds, startSession } from '@/lib/session';

const readStart = (value: string | undefined): { state: string; verifier: string } | undefined => {
  try {
    const parsed = JSON.parse(value ?? '') as { state?: unknown; verifier?: unknown };
    return typeof parsed.state === 'string' && typeof parsed.verifier === 'string'
      ? { state: parsed.state, verifier: parsed.verifier }
      : undefined;
  } catch {
    return undefined;
  }
};

export const GET = async (request: Request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const cookieStore = await cookies();
  const started = readStart(cookieStore.get(OAUTH_COOKIE)?.value);
  cookieStore.delete({ name: OAUTH_COOKIE, path: OAUTH_COOKIE_PATH });

  if (!code || !started || url.searchParams.get('state') !== started.state) {
    log('warn', 'console sign-in rejected', { reason: 'state mismatch or missing code' });
    return new Response('Sign-in expired or was tampered with. Start again from /login.', { status: 400 });
  }

  const accessToken = await exchangeCode(code, started.verifier);
  const user = await fetchGitHubUser(accessToken);
  await revokeToken(accessToken).catch((error: unknown) =>
    log('warn', 'github token revoke failed', { error: error instanceof Error ? error.message : String(error) })
  );

  if (!allowedGitHubUserIds().includes(user.id)) {
    log('warn', 'console sign-in by a GitHub user who is not allowed', { githubUserId: user.id, login: user.login });
    return new Response('This console is only open to its operator.', { status: 403 });
  }
  await startSession(user);
  log('info', 'console sign-in', { login: user.login });
  return Response.redirect(`${requireEnv('CONSOLE_URL')}/usage`, 302);
};
