import { checkGovernorClaims, GITHUB_OIDC_ISSUER } from '@mb-factory/core';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';

import { requireEnv } from './env';
import { log } from './log';

const jwks = createRemoteJWKSet(new URL(`${GITHUB_OIDC_ISSUER}/.well-known/jwks`));

export type OidcVerification = { ok: true; claims: unknown } | { ok: false; reason: string };

// The stage workflow requests its token with the console's URL as the audience.
export const verifyGitHubOidc = async (request: Request): Promise<OidcVerification> => {
  const header = request.headers.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  if (!token) {
    return { ok: false, reason: 'missing bearer token' };
  }
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: GITHUB_OIDC_ISSUER,
      audience: requireEnv('CONSOLE_URL'),
      algorithms: ['RS256']
    });
    return { ok: true, claims: payload };
  } catch (error) {
    if (error instanceof errors.JOSEError) {
      return { ok: false, reason: error.code };
    }
    throw error;
  }
};

// For the governor's endpoints: a response to send back when the caller isn't the scheduled governor workflow.
export const rejectUnlessGovernor = async (request: Request, endpoint: string): Promise<Response | undefined> => {
  const verification = await verifyGitHubOidc(request);
  const check = verification.ok ? checkGovernorClaims(verification.claims) : verification;
  if (check.ok) {
    return undefined;
  }
  log('warn', `${endpoint} rejected`, { reason: check.reason });
  return new Response('not the governor workflow', { status: verification.ok ? 403 : 401 });
};
