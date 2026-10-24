import { createHmac, timingSafeEqual } from 'node:crypto';

export type Verification = { ok: true } | { ok: false; reason: string };

const LINEAR_MAX_AGE_MS = 60_000;
const SLACK_MAX_AGE_S = 5 * 60;

const hmacHex = (secret: string, payload: string): string => createHmac('sha256', secret).update(payload).digest('hex');

const safeEqual = (expected: string, received: string): boolean => {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
};

const fail = (reason: string): Verification => ({ ok: false, reason });

export const verifyLinearWebhook = ({
  rawBody,
  signature,
  secret,
  now
}: {
  rawBody: string;
  signature: string | null;
  secret: string;
  now: Date;
}): Verification => {
  if (!signature) {
    return fail('missing linear-signature header');
  }
  if (!safeEqual(hmacHex(secret, rawBody), signature)) {
    return fail('signature mismatch');
  }
  const { webhookTimestamp } = JSON.parse(rawBody) as { webhookTimestamp?: number };
  if (typeof webhookTimestamp !== 'number' || Math.abs(now.getTime() - webhookTimestamp) > LINEAR_MAX_AGE_MS) {
    return fail('stale or missing webhookTimestamp');
  }
  return { ok: true };
};

export const verifySlackRequest = ({
  rawBody,
  signature,
  timestamp,
  secret,
  now
}: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  secret: string;
  now: Date;
}): Verification => {
  if (!signature || !timestamp) {
    return fail('missing slack signature headers');
  }
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > SLACK_MAX_AGE_S) {
    return fail('stale slack request timestamp');
  }
  const expected = `v0=${hmacHex(secret, `v0:${timestamp}:${rawBody}`)}`;
  return safeEqual(expected, signature) ? { ok: true } : fail('signature mismatch');
};

export const verifyGitHubWebhook = ({
  rawBody,
  signature,
  secret
}: {
  rawBody: string;
  signature: string | null;
  secret: string;
}): Verification => {
  if (!signature) {
    return fail('missing x-hub-signature-256 header');
  }
  return safeEqual(`sha256=${hmacHex(secret, rawBody)}`, signature) ? { ok: true } : fail('signature mismatch');
};
