import { describe, expect, it } from 'vitest';

import type { MergeRules } from './auto-merge';
import { globMatcher, majorBumps, mergeRoute, mergeRulesSchema, readHumanMerge } from './auto-merge';
import type { ChangedFile } from './router';

const rules: MergeRules = mergeRulesSchema.parse({
  size: { lines: 400, files: 20 },
  uncounted: ['**/*.md', 'specs/', 'pnpm-lock.yaml', 'frontend/visual/baselines/'],
  tests: ['**/*.test.{ts,tsx}', 'backend/tests/', 'frontend/e2e/'],
  safetyNet: ['biome.json', 'frontend/vitest.config.ts', 'frontend/lighthouserc.json'],
  humanMerge: ['backend/*/migrations/', 'backend/config/', '.github/workflows/']
});

const file = (filename: string, overrides: Partial<ChangedFile> = {}): ChangedFile => ({
  filename,
  status: 'modified',
  sha: 'abc',
  patch: '@@ -1 +1 @@\n-old\n+new',
  additions: 1,
  deletions: 1,
  ...overrides
});

const reasons = (files: ChangedFile[] | undefined, tightened?: string): string[] => {
  const route = mergeRoute(rules, { files, tightened });
  return route.route === 'person' ? route.reasons : [];
};

describe('globMatcher', () => {
  it('keeps `*` within a folder and lets `**` cross them', () => {
    const matches = globMatcher(['src/*.ts', 'docs/**/*.md']);
    expect(matches('src/a.ts')).toBe(true);
    expect(matches('src/deep/a.ts')).toBe(false);
    expect(matches('docs/a.md')).toBe(true);
    expect(matches('docs/x/y/a.md')).toBe(true);
  });

  it('takes everything under a folder ending in a slash, and either side of a brace', () => {
    const matches = globMatcher(['backend/*/migrations/', '**/*.test.{ts,tsx}']);
    expect(matches('backend/recipes/migrations/0013_x.py')).toBe(true);
    expect(matches('backend/recipes/models.py')).toBe(false);
    expect(matches('frontend/src/a.test.tsx')).toBe(true);
    expect(matches('a.test.ts')).toBe(true);
  });

  it('treats dots and other characters literally', () => {
    expect(globMatcher(['biome.json'])('biomeXjson')).toBe(false);
  });
});

describe('mergeRoute', () => {
  it('merges a small PR that touches nothing risky by itself', () => {
    expect(mergeRoute(rules, { files: [file('frontend/src/recipes/page.tsx')] })).toEqual({ route: 'auto' });
  });

  it('sends a PR over the line or file cap to the person, counting source only', () => {
    expect(reasons([file('frontend/src/a.tsx', { additions: 300, deletions: 101 })])).toEqual([
      '401 source lines changed, over 400'
    ]);
    const many = Array.from({ length: 21 }, (_, index) => file(`frontend/src/f${index}.tsx`));
    expect(reasons(many)).toEqual(['21 source files changed, over 20']);
    expect(
      reasons([
        file('pnpm-lock.yaml', { additions: 3000, patch: null }),
        file('frontend/src/a.test.tsx', { additions: 900 }),
        file('specs/TAS-1/plan.md', { additions: 500 }),
        file('frontend/visual/baselines/home.png', { patch: null, additions: 0, deletions: 0 })
      ])
    ).toEqual([]);
  });

  it('sends a PR touching a risky path to the person, a renamed one by either name', () => {
    expect(reasons([file('backend/recipes/migrations/0013_x.py')])).toEqual([
      'touches backend/recipes/migrations/0013_x.py'
    ]);
    expect(
      reasons([file('backend/recipes/old.py', { status: 'renamed', previousFilename: 'backend/config/settings.py' })])
    ).toEqual(['touches backend/recipes/old.py']);
  });

  it('names at most three files', () => {
    const workflows = ['a', 'b', 'c', 'd', 'e'].map((name) => file(`.github/workflows/${name}.yml`));
    expect(reasons(workflows)).toEqual([
      'touches .github/workflows/a.yml, .github/workflows/b.yml, .github/workflows/c.yml and 2 more'
    ]);
  });

  it('sends a deleted test, or one renamed out of the tests, to the person', () => {
    expect(reasons([file('frontend/src/a.test.tsx', { status: 'removed' })])).toEqual([
      'deletes a test: frontend/src/a.test.tsx'
    ]);
    expect(
      reasons([file('frontend/src/a.helper.tsx', { status: 'renamed', previousFilename: 'frontend/src/a.test.tsx' })])
    ).toEqual(['deletes a test: frontend/src/a.helper.tsx']);
  });

  it('sends a skip added to a test to the person, but not one only moved', () => {
    const skip = (patch: string) => reasons([file('frontend/src/a.test.tsx', { patch })]);
    expect(skip("@@ -1 +1 @@\n+  it.skip('shows the list', () => {")).toEqual([
      'skips a test in frontend/src/a.test.tsx'
    ]);
    expect(skip("@@\n+  test.only('a', () => {")).toHaveLength(1);
    expect(skip('@@\n+@pytest.mark.skip(reason="flaky")')).toHaveLength(1);
    expect(skip("@@\n-  it.skip('a', () => {\n+  it.skip('a renamed', () => {")).toEqual([]);
  });

  it('sends a change to lint, type or test settings to the person', () => {
    expect(reasons([file('frontend/lighthouserc.json')])).toEqual([
      'changes lint, type or test settings: frontend/lighthouserc.json'
    ]);
  });

  it('sends a suppression added anywhere to the person, but not one only moved', () => {
    expect(reasons([file('frontend/src/a.tsx', { patch: '@@\n+  // biome-ignore lint/x: because' })])).toEqual([
      'adds biome-ignore in frontend/src/a.tsx'
    ]);
    expect(reasons([file('backend/recipes/views.py', { patch: '@@\n+import os  # noqa: F401' })])).toEqual([
      'adds noqa in backend/recipes/views.py'
    ]);
    expect(
      reasons([file('frontend/src/a.test.tsx', { patch: '@@\n+  // @ts-expect-error: wrong on purpose' })])
    ).toEqual(['adds @ts-expect-error in frontend/src/a.test.tsx']);
    expect(reasons([file('specs/TAS-1.md', { patch: '@@\n+Add a `biome-ignore` with a reason.' })])).toEqual([]);
    expect(
      reasons([
        file('frontend/src/a.tsx', {
          patch: '@@\n-  x(); // biome-ignore lint/x: y\n+  x( ); // biome-ignore lint/x: y'
        })
      ])
    ).toEqual([]);
  });

  it('sends a dependency moved up a major version to the person', () => {
    const packageJson = file('frontend/package.json', {
      patch: '@@\n-    "react": "^18.3.1",\n+    "react": "^19.0.0",\n-    "zod": "^4.1.0",\n+    "zod": "^4.2.0",'
    });
    expect(reasons([packageJson])).toEqual(['a major version: react 18 → 19']);
  });

  it('sends a PR to the person when review asked, or GitHub can’t show it', () => {
    expect(reasons([file('frontend/src/a.tsx')], 'It changes who can see a private recipe.')).toEqual([
      'review asked for your merge: It changes who can see a private recipe.'
    ]);
    expect(reasons(undefined)).toEqual(['too many files for GitHub to list']);
    expect(reasons([file('frontend/src/big.tsx', { patch: null, additions: 40 })])).toEqual([
      'GitHub shows no diff for frontend/src/big.tsx, so it can’t be checked'
    ]);
  });

  it('gives every reason that holds', () => {
    expect(
      reasons([
        file('backend/recipes/migrations/0013_x.py'),
        file('biome.json'),
        file('frontend/src/a.tsx', { additions: 500 })
      ])
    ).toEqual([
      '505 source lines changed, over 400',
      'touches backend/recipes/migrations/0013_x.py',
      'changes lint, type or test settings: biome.json'
    ]);
  });
});

describe('majorBumps', () => {
  it('reads Python manifests, extras and all', () => {
    const pyproject = file('backend/pyproject.toml', {
      patch:
        '@@\n-    "django>=6.1.2",\n+    "django>=7.0.0",\n-    "django-allauth[mfa]>=65.21.0",\n+    "django-allauth[mfa]>=66.0.0",'
    });
    expect(majorBumps(pyproject)).toEqual(['django 6 → 7', 'django-allauth 65 → 66']);
    expect(majorBumps(file('requirements.txt', { patch: '@@\n-requests==2.32.0\n+requests==3.0.0' }))).toEqual([
      'requests 2 → 3'
    ]);
  });

  it('ignores the package’s own version, new dependencies and other files', () => {
    expect(majorBumps(file('package.json', { patch: '@@\n-  "version": "1.0.0",\n+  "version": "2.0.0",' }))).toEqual(
      []
    );
    expect(majorBumps(file('package.json', { patch: '@@\n+    "react": "^19.0.0",' }))).toEqual([]);
    expect(majorBumps(file('src/a.ts', { patch: '@@\n-"react": "^18.0.0"\n+"react": "^19.0.0"' }))).toEqual([]);
  });
});

describe('readHumanMerge', () => {
  it('reads review’s reason as one line, and nothing when it gave none', () => {
    expect(readHumanMerge({ humanMerge: '  Changes who\n can see a recipe. ' })).toBe('Changes who can see a recipe.');
    expect(readHumanMerge({ humanMerge: ' ' })).toBeUndefined();
    expect(readHumanMerge({ verdict: 'accepted' })).toBeUndefined();
  });
});
