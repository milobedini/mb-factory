import { createHmac, timingSafeEqual } from 'node:crypto';
import { Kind, parse } from 'graphql';

// Question runs only read Linear, so they get no token that could write. They get a pass instead, signed by the console
// for one run, and send their GraphQL through the console, which forwards only plain queries with the app's token.

// Far more than any query a question needs, and a bound on the parser's work.
const MAX_TOKENS = 2000;

// A document whose every operation is a query: no mutation or subscription, and nothing that doesn't parse.
export const isReadOnlyDocument = (query: string): boolean => {
  try {
    const { definitions } = parse(query, { maxTokens: MAX_TOKENS, noLocation: true });
    const operations = definitions.filter(({ kind }) => kind === Kind.OPERATION_DEFINITION);
    return (
      operations.length > 0 &&
      definitions.every(
        (definition) =>
          definition.kind === Kind.FRAGMENT_DEFINITION ||
          (definition.kind === Kind.OPERATION_DEFINITION && definition.operation === 'query')
      )
    );
  } catch {
    return false;
  }
};

const signatureOf = (runId: string, expiresAt: number, key: Uint8Array): string =>
  createHmac('sha256', key).update(`linear-pass:${runId}:${expiresAt}`).digest('hex');

export const signLinearPass = (runId: string, expiresAt: Date, key: Uint8Array): string =>
  `${expiresAt.getTime()}.${signatureOf(runId, expiresAt.getTime(), key)}`;

// Whether a pass was signed for this run and hasn't run out.
export const isLinearPassFor = (pass: string, runId: string, now: Date, key: Uint8Array): boolean => {
  const [expires, signature] = pass.split('.');
  const expiresAt = Number(expires);
  if (!signature || !Number.isSafeInteger(expiresAt) || expiresAt <= now.getTime()) {
    return false;
  }
  const expected = Buffer.from(signatureOf(runId, expiresAt, key), 'hex');
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
};
