import { deriveKey, isLinearPassFor, signLinearPass } from '@mb-factory/core';

import { requireEnv } from './env';

const passKey = (): Uint8Array => deriveKey(requireEnv('TOKEN_ENCRYPTION_KEY'), 'linear-pass');

export const linearPass = (runId: string, expiresAt: Date): string => signLinearPass(runId, expiresAt, passKey());

export const isLinearPass = (pass: string, runId: string, now: Date): boolean =>
  isLinearPassFor(pass, runId, now, passKey());
