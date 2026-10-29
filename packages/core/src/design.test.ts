import { describe, expect, it } from 'vitest';

import { latestSpecDesign, readSpecDesign } from './design';

describe('readSpecDesign', () => {
  it('reads a call for design with the components it expects', () => {
    expect(
      readSpecDesign({
        design: {
          decision: 'needed',
          why: 'A new account menu and household screen.',
          components: [
            { name: 'Avatar', change: 'new' },
            { name: ' Button ', change: 'changed' }
          ]
        }
      })
    ).toEqual({
      needed: true,
      why: 'A new account menu and household screen.',
      components: [
        { name: 'Avatar', change: 'new' },
        { name: 'Button', change: 'changed' }
      ]
    });
  });

  it('reads a skip with its reason', () => {
    expect(
      readSpecDesign({ design: { decision: 'skip', why: 'Reuses the existing banner; no visual change.' } })
    ).toEqual({ needed: false, why: 'Reuses the existing banner; no visual change.' });
  });

  it('keeps well-formed components once each, dropping the rest', () => {
    expect(
      readSpecDesign({
        design: {
          decision: 'needed',
          why: 'A new screen.',
          components: [
            { name: 'Tabs', change: 'new' },
            { name: 'Tabs', change: 'changed' },
            { name: 'Switch', change: 'restyled' },
            { name: '', change: 'new' },
            'Avatar'
          ]
        }
      })
    ).toEqual({ needed: true, why: 'A new screen.', components: [{ name: 'Tabs', change: 'new' }] });
  });

  it('reads a call for design that lists no components', () => {
    expect(readSpecDesign({ design: { decision: 'needed', why: 'A new layout for the list.' } })).toEqual({
      needed: true,
      why: 'A new layout for the list.',
      components: []
    });
  });

  it('makes no call when the report has none or it is malformed', () => {
    expect(readSpecDesign({ summary: 'Spec written.' })).toBeNull();
    expect(readSpecDesign({ design: 'needed' })).toBeNull();
    expect(readSpecDesign({ design: { decision: 'maybe', why: 'Unsure.' } })).toBeNull();
    expect(readSpecDesign({ design: { decision: 'skip', why: ' ' } })).toBeNull();
    expect(readSpecDesign(null)).toBeNull();
  });
});

describe('latestSpecDesign', () => {
  const needed = { design: { decision: 'needed', why: 'A new screen.', components: [] } };
  const skip = { design: { decision: 'skip', why: 'No visual change.' } };

  it('takes the newest call', () => {
    expect(latestSpecDesign([skip, needed])).toEqual({ needed: false, why: 'No visual change.' });
  });

  it('keeps an earlier call when a revision leaves design out', () => {
    expect(latestSpecDesign([{ summary: 'Reworded the steps.' }, needed])).toEqual({
      needed: true,
      why: 'A new screen.',
      components: []
    });
  });

  it('makes no call when no report does', () => {
    expect(latestSpecDesign([{ summary: 'Spec written.' }])).toBeNull();
    expect(latestSpecDesign([])).toBeNull();
  });
});
