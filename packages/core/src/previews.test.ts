import { describe, expect, it } from 'vitest';

import { type NeonBranch, previewBranchFor } from './previews';

const branches: NeonBranch[] = [
  { id: 'br-production', name: 'production' },
  { id: 'br-base', name: 'previews-base', default: true, primary: true },
  { id: 'br-tas-224', name: 'preview/tastebook/tas-224-guard-forget-every' },
  { id: 'br-tas-22', name: 'preview/tastebook/tas-22' }
];

describe('previewBranchFor', () => {
  it('finds the database branch made for a Git branch by its exact name', () => {
    expect(previewBranchFor(branches, 'tastebook/tas-224-guard-forget-every')?.id).toBe('br-tas-224');
    expect(previewBranchFor(branches, 'tastebook/tas-22')?.id).toBe('br-tas-22');
  });

  it('finds nothing for a Git branch whose previews have no database', () => {
    expect(previewBranchFor(branches, 'tastebook/tas-2')).toBeUndefined();
    expect(previewBranchFor(branches, 'production')).toBeUndefined();
  });

  it('never picks the default, primary or a protected branch, whatever its name', () => {
    const named = (flags: Partial<NeonBranch>): NeonBranch[] => [{ id: 'br-kept', name: 'preview/main', ...flags }];
    expect(previewBranchFor(named({ default: true }), 'main')).toBeUndefined();
    expect(previewBranchFor(named({ primary: true }), 'main')).toBeUndefined();
    expect(previewBranchFor(named({ protected: true }), 'main')).toBeUndefined();
    expect(previewBranchFor(named({}), 'main')?.id).toBe('br-kept');
  });
});
