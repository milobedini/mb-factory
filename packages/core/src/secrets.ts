import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';

const parseKey = (base64Key: string): Buffer => {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error('Encryption key must be 32 bytes, base64-encoded');
  }
  return key;
};

export const encryptSecret = (plaintext: string, base64Key: string): string => {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, parseKey(base64Key), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join(
    ':'
  );
};

export const decryptSecret = (sealed: string, base64Key: string): string => {
  const [version, iv, tag, ciphertext] = sealed.split(':');
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error('Unrecognised secret format');
  }
  const decipher = createDecipheriv(ALGORITHM, parseKey(base64Key), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
};
