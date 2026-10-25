import { deriveKey } from '@mb-factory/core';
import { errors, jwtVerify, SignJWT } from 'jose';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { requireEnv } from './env';

export const SESSION_COOKIE = 'console_session';

const SESSION_SECONDS = 30 * 24 * 60 * 60;
const ISSUER = 'mb-factory-console';

export type ConsoleUser = { id: number; login: string };

const sessionKey = (): Uint8Array => deriveKey(requireEnv('TOKEN_ENCRYPTION_KEY'), 'console-session');

// GitHub user IDs, which unlike logins never change hands.
export const allowedGitHubUserIds = (): number[] =>
  requireEnv('CONSOLE_GITHUB_USER_IDS')
    .split(',')
    .map((id) => Number(id.trim()))
    .filter(Number.isInteger);

export const startSession = async ({ id, login }: ConsoleUser): Promise<void> => {
  const token = await new SignJWT({ login })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(id))
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(sessionKey());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_SECONDS,
    path: '/'
  });
};

export const endSession = async (): Promise<void> => {
  (await cookies()).delete({ name: SESSION_COOKIE, path: '/' });
};

// Checks the allow-list on every read, so removing an ID ends its sessions.
export const getConsoleUser = async (): Promise<ConsoleUser | undefined> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) {
    return undefined;
  }
  try {
    const { payload } = await jwtVerify(token, sessionKey(), { issuer: ISSUER, algorithms: ['HS256'] });
    const id = Number(payload.sub);
    return typeof payload.login === 'string' && allowedGitHubUserIds().includes(id)
      ? { id, login: payload.login }
      : undefined;
  } catch (error) {
    if (error instanceof errors.JOSEError) {
      return undefined;
    }
    throw error;
  }
};

// For pages and Server Actions: each checks the session itself, close to the data.
export const requireConsoleUser = async (): Promise<ConsoleUser> => (await getConsoleUser()) ?? redirect('/login');
