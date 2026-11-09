import { implementToken } from '@/lib/github-app';
import { isGithubPass } from '@/lib/github-pass';
import { log } from '@/lib/log';
import { findAnyRun, runRepository } from '@/lib/runs';

// A fresh app token for a running implement run, whose first lapses after an hour (TAS-206). Limited to the run's
// repository and the permissions the run started with; the pass is the one `/start` gave this run.
const bearer = (request: Request): string | undefined =>
  request.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1];

export const POST = async (request: Request, context: RouteContext<'/api/runs/[id]/github-token'>) => {
  const { id } = await context.params;
  const pass = bearer(request);
  if (!pass || !isGithubPass(pass, id, new Date())) {
    log('warn', 'github token refused', { runId: id, reason: 'pass' });
    return new Response('invalid pass', { status: 401 });
  }
  const found = await findAnyRun(id);
  const repository = found && runRepository(found);
  if (!found || !repository || found.run.agent !== 'implement' || found.run.status !== 'running') {
    log('warn', 'github token refused', { runId: id, reason: 'run', status: found?.run.status });
    return new Response('not a running implement run', { status: 403 });
  }
  try {
    const { token, expiresAt } = await implementToken(repository);
    log('info', 'github token given', { runId: id, repository });
    // Seconds since the epoch, which the runner's script compares with `date +%s`.
    return Response.json({ token, expiresAt: Math.floor(expiresAt / 1000) });
  } catch (error) {
    log('error', 'github token failed', { runId: id, error: error instanceof Error ? error.message : String(error) });
    return new Response('GitHub refused the token', { status: 502 });
  }
};
