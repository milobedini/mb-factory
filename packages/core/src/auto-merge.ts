import { z } from 'zod';

import { readBeforeMerging } from './merge';
import type { ChangedFile } from './router';

// Who merges an express PR (docs/express.md, "Who merges"): the factory itself once every check passes, unless a rule
// below sends it to the person. Every rule reads the diff GitHub gives, except review's own call, which can only send a
// PR to the person. Nothing an agent says lets a PR skip a rule.

// A path pattern from the repo root: `*` stays within a folder, `**` crosses folders, `{a,b}` is either.
const globSchema = z.string().regex(/^(?!\/)[^\s]+$/, { message: 'not a glob from the repo root' });

export const mergeRulesSchema = z.object({
  // Whether the factory merges a PR the rules leave to it. Off, Ready to merge only says which way each PR would go.
  // Needs the repo's rulesets to let the factory's App merge without an approval, and the App's key in the console.
  auto: z.boolean().default(false),
  // More than either is too big to merge without a person.
  size: z
    .object({ lines: z.int().min(1).default(400), files: z.int().min(1).default(20) })
    .default({ lines: 400, files: 20 }),
  // Not counted in the size: generated output, data, docs, specs and baselines. Tests never count either.
  uncounted: z.array(globSchema).default([]),
  // Test files: deleting one, or adding a skip to one, weakens the safety net.
  tests: z.array(globSchema).default([]),
  // Lint, type and test configuration and thresholds: changing any weakens the safety net.
  safetyNet: z.array(globSchema).default([]),
  // Risky paths: migrations, auth and session code, settings, CI workflows.
  humanMerge: z.array(globSchema).default([])
});

export type MergeRules = z.infer<typeof mergeRulesSchema>;

export type MergeRoute = { route: 'auto' } | { route: 'person'; reasons: string[] };

const escapeRegExp = (text: string): string => text.replace(/[.+^$()|[\]\\]/g, '\\$&');

const globSource = (glob: string): string =>
  glob
    .split(/(\*\*\/|\*\*|\*|\?|\{[^}]*\})/)
    .map((part) => {
      if (part === '**/') {
        return '(?:.*/)?';
      }
      if (part === '**') {
        return '.*';
      }
      if (part === '*') {
        return '[^/]*';
      }
      if (part === '?') {
        return '[^/]';
      }
      if (part.startsWith('{') && part.endsWith('}')) {
        return `(?:${part.slice(1, -1).split(',').map(globSource).join('|')})`;
      }
      return escapeRegExp(part);
    })
    .join('');

// A glob ending in `/` takes everything under that folder.
export const globMatcher = (globs: string[]): ((path: string) => boolean) => {
  const patterns = globs.map((glob) => new RegExp(`^${globSource(glob.endsWith('/') ? `${glob}**` : glob)}$`));
  return (path) => patterns.some((pattern) => pattern.test(path));
};

const paths = (file: ChangedFile): string[] => [
  file.filename,
  ...(file.previousFilename ? [file.previousFilename] : [])
];

const SHOWN = 3;

const listed = (names: string[]): string => {
  const shown = names.slice(0, SHOWN).join(', ');
  return names.length > SHOWN ? `${shown} and ${names.length - SHOWN} more` : shown;
};

const lines = (patch: string | null | undefined, sign: '+' | '-'): string[] =>
  (patch ?? '')
    .split('\n')
    .filter((line) => line.startsWith(sign))
    .map((line) => line.slice(1));

const SUPPRESSIONS: [string, RegExp][] = [
  ['biome-ignore', /biome-ignore/g],
  ['eslint-disable', /eslint-disable/g],
  ['@ts-expect-error', /@ts-expect-error/g],
  ['@ts-ignore', /@ts-ignore/g],
  ['@ts-nocheck', /@ts-nocheck/g],
  ['noqa', /#\s*noqa\b/g],
  ['type: ignore', /#\s*type:\s*ignore\b/g],
  ['pragma: no cover', /#\s*pragma:\s*no cover\b/g]
];

const SKIPS: [string, RegExp][] = [
  ['.skip', /\b(?:it|test|describe|suite)\s*\.\s*(?:skip|todo)\b/g],
  ['.only', /\b(?:it|test|describe|suite)\s*\.\s*only\b/g],
  ['.fixme', /\btest\s*\.\s*fixme\b/g],
  ['xit', /\bx(?:it|describe|test)\s*\(/g],
  ['@pytest.mark.skip', /@pytest\.mark\.(?:skip|skipif|xfail)\b/g],
  ['@unittest.skip', /@unittest\.(?:skip|skipIf|skipUnless|expectedFailure)\b/g],
  ['pytest.skip', /\bpytest\.skip\s*\(/g]
];

const count = (texts: string[], pattern: RegExp): number =>
  texts.reduce((total, text) => total + (text.match(pattern)?.length ?? 0), 0);

// The markers a file's diff adds more of than it takes away, so a line only moved or reformatted adds none.
const addedMarkers = (file: ChangedFile, markers: [string, RegExp][]): string[] => {
  const [added, removed] = [lines(file.patch, '+'), lines(file.patch, '-')];
  return markers.flatMap(([name, pattern]) => (count(added, pattern) > count(removed, pattern) ? [name] : []));
};

// A dependency's major version on a manifest line: `"react": "^19.1.0"` in package.json, `"django>=6.1.2",` in
// pyproject.toml, `django==6.1.2` in requirements.txt.
const PACKAGE_JSON_LINE = /^\s*"(@?[^"\s]+)"\s*:\s*"(?:npm:|workspace:)?[\^~>=<v\s]*(\d+)\.?/;
const PYTHON_LINE = /^\s*"?([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*(?:===|==|>=|~=|>)\s*(\d+)/;
const NOT_DEPENDENCIES = new Set(['version', 'requires-python', 'node', 'pnpm', 'npm']);

const manifestLine = (filename: string): RegExp | undefined => {
  const base = filename.split('/').at(-1) ?? '';
  if (base === 'package.json') {
    return PACKAGE_JSON_LINE;
  }
  return base === 'pyproject.toml' || /^requirements.*\.txt$/.test(base) ? PYTHON_LINE : undefined;
};

const majors = (texts: string[], pattern: RegExp): Map<string, number> =>
  new Map(
    texts.flatMap((text) => {
      const [, name, major] = pattern.exec(text) ?? [];
      return name && major && !NOT_DEPENDENCIES.has(name.toLowerCase())
        ? [[name.toLowerCase(), Number(major)] as const]
        : [];
    })
  );

// Dependencies a manifest's diff moves up a major version, as "django 6 → 7".
export const majorBumps = (file: ChangedFile): string[] => {
  const pattern = manifestLine(file.filename);
  if (!pattern) {
    return [];
  }
  const before = majors(lines(file.patch, '-'), pattern);
  return [...majors(lines(file.patch, '+'), pattern)].flatMap(([name, major]) => {
    const was = before.get(name);
    return was !== undefined && major > was ? [`${name} ${was} → ${major}`] : [];
  });
};

const changed = (file: ChangedFile): number => (file.additions ?? 0) + (file.deletions ?? 0);

// The route an express PR takes to `main`. `files` is GitHub's list of what the PR changes, undefined when GitHub
// can't list them all; `held` is what review left for the person (`reviewHolds`).
export const mergeRoute = (
  rules: MergeRules,
  { files, held = [] }: { files: ChangedFile[] | undefined; held?: string[] }
): MergeRoute => {
  const review = held;
  if (!files) {
    return { route: 'person', reasons: [...review, 'too many files for GitHub to list'] };
  }
  const isTest = globMatcher(rules.tests);
  const isUncounted = globMatcher(rules.uncounted);
  const isSafetyNet = globMatcher(rules.safetyNet);
  const isRisky = globMatcher(rules.humanMerge);
  const source = files.filter(({ filename }) => !isTest(filename) && !isUncounted(filename));
  const sourceLines = source.reduce((total, file) => total + changed(file), 0);
  const unread = files.filter(
    (file) => !file.patch && changed(file) > 0 && (isTest(file.filename) || !isUncounted(file.filename))
  );
  const risky = files.filter((file) => paths(file).some(isRisky));
  const bumps = files.flatMap(majorBumps);
  const testsGone = files.filter(
    (file) =>
      (file.status === 'removed' && isTest(file.filename)) ||
      (file.status === 'renamed' && file.previousFilename && isTest(file.previousFilename) && !isTest(file.filename))
  );
  const skipped = files.filter((file) => isTest(file.filename) && addedMarkers(file, SKIPS).length > 0);
  const configs = files.filter((file) => paths(file).some(isSafetyNet));
  // In code only: a doc or spec may name a suppression without adding one.
  const suppressed = files
    .filter(({ filename }) => isTest(filename) || !isUncounted(filename))
    .flatMap((file) => addedMarkers(file, SUPPRESSIONS).map((marker) => ({ file, marker })));
  const names = (picked: ChangedFile[]): string => listed(picked.map(({ filename }) => filename));
  const reasons = [
    ...review,
    ...(sourceLines > rules.size.lines ? [`${sourceLines} source lines changed, over ${rules.size.lines}`] : []),
    ...(source.length > rules.size.files ? [`${source.length} source files changed, over ${rules.size.files}`] : []),
    ...(risky.length > 0 ? [`touches ${names(risky)}`] : []),
    ...(bumps.length > 0 ? [`a major version: ${listed(bumps)}`] : []),
    ...(testsGone.length > 0 ? [`deletes a test: ${names(testsGone)}`] : []),
    ...(skipped.length > 0 ? [`skips a test in ${names(skipped)}`] : []),
    ...(configs.length > 0 ? [`changes lint, type or test settings: ${names(configs)}`] : []),
    ...(suppressed.length > 0
      ? [`adds ${listed(suppressed.map(({ file, marker }) => `${marker} in ${file.filename}`))}`]
      : []),
    ...(unread.length > 0 ? [`GitHub shows no diff for ${names(unread)}, so it can’t be checked`] : [])
  ];
  return reasons.length > 0 ? { route: 'person', reasons } : { route: 'auto' };
};

// What review left for the person, from its accepted report: its reason to send the PR to them (`humanMerge`), a check
// it asks them to make first (`beforeMerging`), and findings it left for them to choose.
export const reviewHolds = (report: unknown, findingsLeft: number): string[] => {
  const [reason, check] = [readHumanMerge(report), readBeforeMerging(report)];
  return [
    ...(reason ? [`review asked for your merge: ${reason}`] : []),
    ...(check ? [`review asks you to check first: ${check}`] : []),
    ...(findingsLeft > 0
      ? [`review left ${findingsLeft === 1 ? 'a finding' : `${findingsLeft} findings`} for you to choose`]
      : [])
  ];
};

// Review's reason for sending a PR to the person's merge, from its report's `humanMerge`: one line.
export const readHumanMerge = (report: unknown): string | undefined => {
  const parsed = z.object({ humanMerge: z.string() }).safeParse(report);
  const reason = parsed.success ? parsed.data.humanMerge.replace(/\s+/g, ' ').trim() : '';
  return reason ? (reason.length > 200 ? `${reason.slice(0, 199)}…` : reason) : undefined;
};
