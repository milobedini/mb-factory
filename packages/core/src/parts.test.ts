import { describe, expect, it } from 'vitest';

import { latestSpecParts, partDescription, partStateId, partsFiledText, readSpecParts } from './parts';

describe('readSpecParts', () => {
  it('reads the later parts in order, with their sizes as Linear estimates', () => {
    expect(
      readSpecParts({
        parts: [
          { title: 'Enamel part 2: the components', scope: 'Every component on /styleguide.', size: 'L' },
          { title: 'Enamel part 3: the pages', scope: 'Move the four pages.', size: 'big' }
        ]
      })
    ).toEqual([
      { title: 'Enamel part 2: the components', scope: 'Every component on /styleguide.', estimate: 5, blockedBy: [] },
      { title: 'Enamel part 3: the pages', scope: 'Move the four pages.', estimate: null, blockedBy: [] }
    ]);
  });

  // TAS-47, 27 Oct: part 2 builds on TAS-60's filter panel, outside the split, so it was filed blocked only by TAS-47.
  it('reads blockers outside the split, keeping only issue identifiers', () => {
    expect(
      readSpecParts({
        parts: [
          {
            title: 'Diet and ingredient filters, part 2',
            scope: 'The page.',
            size: 'L',
            blockedBy: ['TAS-60', ' TAS-60 ', 'the filter panel', 42, 'tas-61']
          }
        ]
      })[0]?.blockedBy
    ).toEqual(['TAS-60']);
  });

  it('stops at a malformed part, since each builds on the one before', () => {
    expect(
      readSpecParts({ parts: [{ title: 'Part 2', scope: 'x' }, { title: '' }, { title: 'Part 4', scope: 'y' }] })
    ).toEqual([{ title: 'Part 2', scope: 'x', estimate: null, blockedBy: [] }]);
    expect(readSpecParts({ summary: 'One PR.' })).toEqual([]);
  });
});

describe('latestSpecParts', () => {
  const split = { parts: [{ title: 'Diet and ingredient filters, part 2', scope: 'The page.', size: 'L' }] };

  // TAS-47, 27 Oct: the revision after "Change something" left `parts` out, and approval filed nothing.
  it('keeps the split from an earlier report when a revision leaves parts out', () => {
    expect(latestSpecParts([{ summary: 'Recorded the choice in the spec.' }, split, { questions: [] }])).toEqual([
      { title: 'Diet and ingredient filters, part 2', scope: 'The page.', estimate: 5, blockedBy: [] }
    ]);
  });

  it('drops the split when the newest report lists no parts', () => {
    expect(latestSpecParts([{ parts: [] }, split])).toEqual([]);
    expect(latestSpecParts([{ summary: 'One PR.' }])).toEqual([]);
  });
});

describe('part text', () => {
  it('points the sub-issue at the approved spec and sends triage to implement', () => {
    const description = partDescription(
      { identifier: 'TAS-29' },
      { title: 'Part 2', scope: 'Every component.', estimate: 5, blockedBy: [] },
      { number: 2, total: 3 }
    );
    expect(description).toContain('Part 2 of 3 of TAS-29. The spec is approved: `specs/TAS-29.md` on `main`');
    expect(description).toContain('send this straight to implement');
    expect(description).toContain('Every component.');
  });

  it('says what was filed', () => {
    expect(
      partsFiledText({ identifier: 'TAS-29' }, [
        { identifier: 'TAS-30', url: 'https://linear.app/t/TAS-30' },
        { identifier: 'TAS-31', url: 'https://linear.app/t/TAS-31' }
      ])
    ).toBe(
      'Split into 3 parts: TAS-29 is part 1, and I filed <https://linear.app/t/TAS-30|TAS-30> (part 2), <https://linear.app/t/TAS-31|TAS-31> (part 3) as sub-issues. Each is posted in the channel to delegate once the one before merges.'
    );
  });
});

describe('partStateId', () => {
  it("files parts in the team's first Backlog status, so they don't land in Triage", () => {
    expect(
      partStateId([
        { id: 'later', position: 2 },
        { id: 'backlog', position: 0 }
      ])
    ).toBe('backlog');
    expect(partStateId([])).toBeUndefined();
  });
});
