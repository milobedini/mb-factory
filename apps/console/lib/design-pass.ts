import { deriveKey, isLinearPassFor, signLinearPass } from '@mb-factory/core';

import { requireEnv } from './env';

// A design run reports from a claude.ai session, which has no GitHub token to prove itself with, so the console signs
// it a pass for that one run, as it does a question's Linear pass, under a key of its own.
const passKey = (): Uint8Array => deriveKey(requireEnv('TOKEN_ENCRYPTION_KEY'), 'design-pass');

export const designPass = (runId: string, expiresAt: Date): string => signLinearPass(runId, expiresAt, passKey());

export const isDesignPass = (pass: string, runId: string, now: Date): boolean =>
  isLinearPassFor(pass, runId, now, passKey());
