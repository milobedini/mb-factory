import { describe, expect, it } from 'vitest';

import { partDescription, partStateId, partsFiledText, readSpecParts } from './parts';

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
      { title: 'Enamel part 2: the components', scope: 'Every component on /styleguide.', estimate: 5 },
      { title: 'Enamel part 3: the pages', scope: 'Move the four pages.', estimate: null }
    ]);
  });

  it('stops at a malformed part, since each builds on the one before', () => {
    expect(
      readSpecParts({ parts: [{ title: 'Part 2', scope: 'x' }, { title: '' }, { title: 'Part 4', scope: 'y' }] })
    ).toEqual([{ title: 'Part 2', scope: 'x', estimate: null }]);
    expect(readSpecParts({ summary: 'One PR.' })).toEqual([]);
  });
});

describe('part text', () => {
  it('points the sub-issue at the approved spec and sends triage to implement', () => {
    const description = partDescription(
      { identifier: 'TAS-29' },
      { title: 'Part 2', scope: 'Every component.', estimate: 5 },
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
