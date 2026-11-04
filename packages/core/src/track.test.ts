import { describe, expect, it } from 'vitest';

import { trackFor } from './track';

describe('trackFor', () => {
  it('takes the project’s track when the issue has no track label', () => {
    expect(trackFor('express', ['factory', 'Bug'])).toBe('express');
    expect(trackFor('careful', [])).toBe('careful');
  });

  it('lets a label override it, in either direction, whatever its case', () => {
    expect(trackFor('express', ['Careful'])).toBe('careful');
    expect(trackFor('careful', ['express '])).toBe('express');
  });

  it('keeps careful when the issue has both', () => {
    expect(trackFor('express', ['express', 'careful'])).toBe('careful');
  });
});
