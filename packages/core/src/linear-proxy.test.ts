import { describe, expect, it } from 'vitest';

import { isLinearPassFor, isReadOnlyDocument, signLinearPass } from './linear-proxy';

describe('isReadOnlyDocument', () => {
  it('takes queries, named or not, with fragments', () => {
    expect(isReadOnlyDocument('{ viewer { id } }')).toBe(true);
    expect(isReadOnlyDocument('query Find($term: String!) { searchIssues(term: $term) { nodes { ...Row } } }')).toBe(
      true
    );
    expect(
      isReadOnlyDocument(
        'query A { viewer { ...Me } } fragment Me on User { id name } query B { teams { nodes { id } } }'
      )
    ).toBe(true);
  });

  it('refuses anything that could write, alone or beside a query', () => {
    expect(isReadOnlyDocument('mutation { issueDelete(id: "x") { success } }')).toBe(false);
    expect(isReadOnlyDocument('query A { viewer { id } } mutation B { issueDelete(id: "x") { success } }')).toBe(false);
    expect(isReadOnlyDocument('subscription { issues { id } }')).toBe(false);
  });

  it('refuses what doesn’t parse, a document with no operation, and type definitions', () => {
    expect(isReadOnlyDocument('{ viewer { id }')).toBe(false);
    expect(isReadOnlyDocument('')).toBe(false);
    expect(isReadOnlyDocument('fragment Me on User { id }')).toBe(false);
    expect(isReadOnlyDocument('type Issue { id: ID }')).toBe(false);
  });

  it('refuses a document too long to need', () => {
    expect(isReadOnlyDocument(`{ ${'viewer { id } '.repeat(600)}}`)).toBe(false);
  });
});

describe('Linear passes', () => {
  const key = new Uint8Array(32).fill(7);
  const now = new Date('2026-10-27T19:00:00Z');
  const later = new Date('2026-10-27T20:30:00Z');

  it('admit the run they were signed for until they run out', () => {
    const pass = signLinearPass('run-1', later, key);
    expect(isLinearPassFor(pass, 'run-1', now, key)).toBe(true);
    expect(isLinearPassFor(pass, 'run-1', later, key)).toBe(false);
  });

  it('admit no other run, key or edited expiry', () => {
    const pass = signLinearPass('run-1', later, key);
    expect(isLinearPassFor(pass, 'run-2', now, key)).toBe(false);
    expect(isLinearPassFor(pass, 'run-1', now, new Uint8Array(32).fill(8))).toBe(false);
    const [, signature] = pass.split('.');
    expect(isLinearPassFor(`${later.getTime() + 1}.${signature}`, 'run-1', now, key)).toBe(false);
    expect(isLinearPassFor('nonsense', 'run-1', now, key)).toBe(false);
  });
});
