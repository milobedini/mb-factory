import { describe, expect, it } from 'vitest';

import { onlyAsksForChanges, readGate, slackChunks, slackMarkdown } from './gates';

describe('readGate', () => {
  const options = ['Create them', 'Change something', 'Keep as one'];

  it('reads a reported gate', () => {
    expect(readGate({ stage: 'triage', gate: { body: ' Split into 16. ', options } })).toEqual({
      body: 'Split into 16.',
      options
    });
  });

  it('leaves out a missing or malformed gate', () => {
    expect(readGate({ stage: 'triage' })).toBeUndefined();
    expect(readGate(null)).toBeUndefined();
    expect(readGate({ gate: { body: 'Split?', options: ['Create them'] } })).toBeUndefined();
    expect(readGate({ gate: { body: 'Split?', options: ['Yes', 'yes'] } })).toBeUndefined();
    expect(readGate({ gate: { body: '', options } })).toBeUndefined();
  });
});

describe('onlyAsksForChanges', () => {
  it('matches the bare option, not a reply that says what to change', () => {
    expect(onlyAsksForChanges('Change something')).toBe(true);
    expect(onlyAsksForChanges(' change something. ')).toBe(true);
    expect(onlyAsksForChanges('Change something: copy the photos to Blob')).toBe(false);
  });
});

describe('slackMarkdown', () => {
  it('turns headings, bold, bullets and links into Slack’s markup', () => {
    expect(slackMarkdown('## Risks\n**Code**\n- one\n  * two\n[PRD](https://linear.app/doc)')).toBe(
      '*Risks*\n*Code*\n• one\n  • two\n<https://linear.app/doc|PRD>'
    );
  });

  it('escapes text so it can’t mention or link anything itself', () => {
    expect(slackMarkdown('<!channel> & <https://x.test|y>')).toBe('&lt;!channel&gt; &amp; &lt;https://x.test|y&gt;');
  });
});

describe('slackChunks', () => {
  it('packs lines into pieces within the limit and cuts a line that is too long', () => {
    expect(slackChunks('aaa\nbbb\nccc', 7)).toEqual(['aaa\nbbb', 'ccc']);
    expect(slackChunks('abcdefghij', 5)).toEqual(['abcd…']);
  });
});
