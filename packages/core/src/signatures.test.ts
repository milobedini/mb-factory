import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { verifyGitHubWebhook, verifyLinearWebhook, verifySlackRequest } from './signatures';

const secret = 'test-secret';
const now = new Date('2026-10-24T12:00:00Z');
const sign = (payload: string) => createHmac('sha256', secret).update(payload).digest('hex');

describe('verifyLinearWebhook', () => {
  const body = JSON.stringify({ type: 'AgentSessionEvent', webhookTimestamp: now.getTime() - 5_000 });

  it('accepts a correctly signed, fresh delivery', () => {
    expect(verifyLinearWebhook({ rawBody: body, signature: sign(body), secret, now })).toEqual({ ok: true });
  });

  it('rejects a delivery signed with another secret', () => {
    const forged = createHmac('sha256', 'other').update(body).digest('hex');
    expect(verifyLinearWebhook({ rawBody: body, signature: forged, secret, now })).toEqual({
      ok: false,
      reason: 'signature mismatch'
    });
  });

  it('rejects a correctly signed delivery older than a minute', () => {
    const old = JSON.stringify({ webhookTimestamp: now.getTime() - 120_000 });
    expect(verifyLinearWebhook({ rawBody: old, signature: sign(old), secret, now })).toEqual({
      ok: false,
      reason: 'stale or missing webhookTimestamp'
    });
  });
});

describe('verifySlackRequest', () => {
  const body = 'token=x&event=app_mention';
  const timestamp = String(now.getTime() / 1000 - 10);

  it('accepts a correctly signed, recent request', () => {
    const signature = `v0=${sign(`v0:${timestamp}:${body}`)}`;
    expect(verifySlackRequest({ rawBody: body, signature, timestamp, secret, now })).toEqual({ ok: true });
  });

  it('rejects a replayed request older than five minutes', () => {
    const oldTimestamp = String(now.getTime() / 1000 - 600);
    const signature = `v0=${sign(`v0:${oldTimestamp}:${body}`)}`;
    expect(verifySlackRequest({ rawBody: body, signature, timestamp: oldTimestamp, secret, now })).toEqual({
      ok: false,
      reason: 'stale slack request timestamp'
    });
  });
});

describe('verifyGitHubWebhook', () => {
  const body = JSON.stringify({ action: 'closed' });

  it('accepts the sha256 signature GitHub sends', () => {
    expect(verifyGitHubWebhook({ rawBody: body, signature: `sha256=${sign(body)}`, secret })).toEqual({ ok: true });
  });

  it('rejects a missing signature header', () => {
    expect(verifyGitHubWebhook({ rawBody: body, signature: null, secret })).toEqual({
      ok: false,
      reason: 'missing x-hub-signature-256 header'
    });
  });
});
