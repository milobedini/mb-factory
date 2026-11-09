import { deriveKey, isLinearPassFor, signLinearPass } from '@mb-factory/core';

import { requireEnv } from './env';

// An implement run's pass to `/github-token`, which hands it a fresh app token once its first nears the hour GitHub
// allows. Signed for that one run, as a question's Linear pass is, under a key of its own.
const passKey = (): Uint8Array => deriveKey(requireEnv('TOKEN_ENCRYPTION_KEY'), 'github-pass');

export const githubPass = (runId: string, expiresAt: Date): string => signLinearPass(runId, expiresAt, passKey());

export const isGithubPass = (pass: string, runId: string, now: Date): boolean =>
  isLinearPassFor(pass, runId, now, passKey());
