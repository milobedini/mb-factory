import { encryptSecret } from '@mb-factory/core';
import { cookies } from 'next/headers';

import { getDb } from '@/db/client';
import { linearInstallations } from '@/db/schema';
import { requireEnv } from '@/lib/env';
import {
  exchangeCode,
  fetchInstallationIdentity,
  normaliseScopes,
  revokeToken,
  STATE_COOKIE
} from '@/lib/linear-oauth';
import { log } from '@/lib/log';

export const GET = async (request: Request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete({ name: STATE_COOKIE, path: '/api/linear/oauth' });

  if (!code || !state || state !== expectedState) {
    log('warn', 'linear oauth callback rejected', { reason: 'state mismatch or missing code' });
    return new Response('Invalid OAuth state', { status: 400 });
  }

  const token = await exchangeCode(code);
  const identity = await fetchInstallationIdentity(token.access_token);

  if (identity.organizationId !== requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID')) {
    await revokeToken(token.access_token);
    log('warn', 'linear install from unexpected workspace revoked', { organizationId: identity.organizationId });
    return new Response('This factory is not available for that Linear workspace', { status: 403 });
  }

  const key = requireEnv('TOKEN_ENCRYPTION_KEY');
  const values = {
    organizationName: identity.organizationName,
    appUserId: identity.appUserId,
    accessToken: encryptSecret(token.access_token, key),
    refreshToken: encryptSecret(token.refresh_token, key),
    accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
    scopes: normaliseScopes(token.scope),
    updatedAt: new Date()
  };

  await getDb()
    .insert(linearInstallations)
    .values({ organizationId: identity.organizationId, ...values })
    .onConflictDoUpdate({ target: linearInstallations.organizationId, set: values });

  log('info', 'linear app installed', {
    organizationId: identity.organizationId,
    appUserId: identity.appUserId,
    scopes: values.scopes
  });

  return Response.redirect(`${requireEnv('CONSOLE_URL')}/?linear=installed`, 302);
};
