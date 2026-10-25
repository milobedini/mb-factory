import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { decryptSecret, deriveKey, encryptSecret } from './secrets';

const key = randomBytes(32).toString('base64');

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a token without storing it in plain text', () => {
    const sealed = encryptSecret('lin_oauth_abc123', key);
    expect(sealed).not.toContain('lin_oauth_abc123');
    expect(decryptSecret(sealed, key)).toBe('lin_oauth_abc123');
  });

  it('refuses to decrypt with a different key', () => {
    const sealed = encryptSecret('lin_oauth_abc123', key);
    expect(() => decryptSecret(sealed, randomBytes(32).toString('base64'))).toThrow();
  });

  it('refuses a tampered ciphertext', () => {
    const [version, iv, tag, ciphertext] = encryptSecret('lin_oauth_abc123', key).split(':');
    const flipped = Buffer.from(ciphertext ?? '', 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => decryptSecret([version, iv, tag, flipped.toString('base64')].join(':'), key)).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => encryptSecret('x', Buffer.from('short').toString('base64'))).toThrow(
      'Encryption key must be 32 bytes, base64-encoded'
    );
  });
});

describe('deriveKey', () => {
  const key = randomBytes(32).toString('base64');

  it('derives a stable 32-byte key per purpose, different from other purposes and other keys', () => {
    const session = deriveKey(key, 'console-session');
    expect(session).toHaveLength(32);
    expect(deriveKey(key, 'console-session')).toEqual(session);
    expect(deriveKey(key, 'something-else')).not.toEqual(session);
    expect(deriveKey(randomBytes(32).toString('base64'), 'console-session')).not.toEqual(session);
  });
});
