import { personForGitHub } from '@mb-factory/core';
import { cookies } from 'next/headers';

import { requireEnv } from '@/lib/env';
import { CONNECT_COOKIE, CONNECT_COOKIE_PATH, exchangeConnectCode, saveConnection } from '@/lib/github-connect';
import { fetchGitHubUser } from '@/lib/github-oauth';
import { log } from '@/lib/log';
import { allProjects } from '@/lib/projects';

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

// Keeps the connection only for someone a project lists in `people` with their GitHub user ID.
export const GET = async (request: Request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const cookieStore = await cookies();
  const started = readStart(cookieStore.get(CONNECT_COOKIE)?.value);
  cookieStore.delete({ name: CONNECT_COOKIE, path: CONNECT_COOKIE_PATH });

  if (!code || !started || url.searchParams.get('state') !== started.state) {
    log('warn', 'github connect rejected', { reason: 'state mismatch or missing code' });
    return new Response('Connecting expired or was tampered with. Tap Connect GitHub in Slack again.', { status: 400 });
  }

  const token = await exchangeConnectCode(code, started.verifier);
  const user = await fetchGitHubUser(token.accessToken);
  if (!allProjects().some((project) => personForGitHub(project, user.id))) {
    log('warn', 'github connect by someone no project lists', { githubUserId: user.id, login: user.login });
    return new Response(
      'No project lists your GitHub account in its people, so nothing was kept. Ask to be added in factory.yaml.',
      { status: 403 }
    );
  }
  await saveConnection(user, token);
  log('info', 'github connected', { login: user.login });
  return Response.redirect(
    `${requireEnv('CONSOLE_URL')}/github/connected?login=${encodeURIComponent(user.login)}`,
    302
  );
};
