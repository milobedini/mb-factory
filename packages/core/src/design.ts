import { z } from 'zod';

const MAX_WHY = 500;
const MAX_COMPONENTS = 20;
const MAX_NAME = 80;

export const COMPONENT_CHANGES = ['new', 'changed'] as const;

export type ComponentChange = (typeof COMPONENT_CHANGES)[number];

// A Dino component the design will use that doesn't exist yet (`new`, which blocks the feature) or needs a new
// variant, size or state (`changed`, built in the feature's own PR).
export type SpecComponent = { name: string; change: ComponentChange };

export type SpecDesign = { needed: true; why: string; components: SpecComponent[] } | { needed: false; why: string };

const componentSchema = z.looseObject({
  name: z.string().trim().min(1).max(MAX_NAME),
  change: z.enum(COMPONENT_CHANGES)
});

const designSchema = z.looseObject({
  decision: z.enum(['needed', 'skip']),
  why: z.string().trim().min(1).max(MAX_WHY),
  components: z.array(z.unknown()).nullish()
});

const reportDesignSchema = z.looseObject({ design: z.unknown() });

const componentsOf = (listed: unknown[] | null | undefined): SpecComponent[] =>
  (listed ?? [])
    .flatMap((component) => {
      const read = componentSchema.safeParse(component);
      return read.success ? [{ name: read.data.name, change: read.data.change }] : [];
    })
    .filter((component, index, all) => all.findIndex(({ name }) => name === component.name) === index)
    .slice(0, MAX_COMPONENTS);

// The spec's call on whether the work goes through the design stage, from a spec run's report; null when the report
// makes none (a project without `docs/design.md`, or a malformed call).
export const readSpecDesign = (report: unknown): SpecDesign | null => {
  const read = designSchema.safeParse(reportDesignSchema.safeParse(report).data?.design);
  if (!read.success) {
    return null;
  }
  const { decision, why, components } = read.data;
  return decision === 'needed' ? { needed: true, why, components: componentsOf(components) } : { needed: false, why };
};

// The call of the newest spec report that makes one, from reports newest first: a revision that only changed the
// spec's text may leave `design` out, which keeps the earlier call.
export const latestSpecDesign = (reportsNewestFirst: unknown[]): SpecDesign | null =>
  reportsNewestFirst.reduce<SpecDesign | null>((found, report) => found ?? readSpecDesign(report), null);

// A Design canvas on claude.ai, as the design run reports it.
const CANVAS_URL = /^https:\/\/claude\.ai\/(code\/)?artifact\/[A-Za-z0-9_-]{1,64}$/;

const reportCanvasSchema = z.looseObject({ canvas: z.string().trim().regex(CANVAS_URL) });

export const readCanvas = (report: unknown): string | null => reportCanvasSchema.safeParse(report).data?.canvas ?? null;

// A variant of the design's main board, drawn side by side with the others for the person to pick from. The first is
// the one recommended, and the only one drawn in full; it always fits the spec. Another may need the spec changed
// first: `specChange` says how.
export type DesignVariant = { name: string; title: string; specChange: string | null };

const MAX_VARIANTS = 3;
const MAX_SPEC_CHANGE = 300;

const variantSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[A-Z]$/),
  title: z.string().trim().min(1).max(MAX_NAME),
  specChange: z.string().trim().min(1).max(MAX_SPEC_CHANGE).nullish()
});

const reportVariantsSchema = z.looseObject({ variants: z.array(variantSchema).min(2).max(MAX_VARIANTS) });

// The variants a design run drew, recommended first; none unless the report lists two or three with distinct names.
export const readDesignVariants = (report: unknown): DesignVariant[] => {
  const variants = reportVariantsSchema.safeParse(report).data?.variants ?? [];
  return new Set(variants.map(({ name }) => name)).size === variants.length
    ? variants.map(({ name, title, specChange }, index) => ({
        name,
        title,
        specChange: index === 0 ? null : (specChange ?? null)
      }))
    : [];
};

const SPEC_CHANGING = ', which changes the spec';

// The reply a variant's button sends: not an approval, so the design run revises the canvas around that variant, or,
// when the variant changes the spec, the spec is revised first with the reply as what to change.
export const useVariantReply = ({ name, title, specChange }: DesignVariant): string =>
  specChange
    ? `Use variant ${name}${SPEC_CHANGING}: ${title}. ${specChange} Record the pick in the spec's Decisions, so the design is redrawn around variant ${name} once the spec is approved.`
    : `Use variant ${name}: ${title}`;

const VARIANT_PICK = /^use variant ([A-Z])\b/i;
const SPEC_CHANGING_PICK = /^use variant [A-Z], which changes the spec\b/i;

// Whether a reply picks a variant that needs the spec changed first, as its Use button words it.
export const picksSpecChange = (body: string): boolean => SPEC_CHANGING_PICK.test(body.trim());

// The variant a reply picks, as the Use button words it; null for any other reply.
export const readVariantPick = (body: string): string | null =>
  VARIANT_PICK.exec(body.trim())?.[1]?.toUpperCase() ?? null;

// The canvas of the newest design report that names one, from reports newest first: each round revises the same one.
export const latestCanvas = (reportsNewestFirst: unknown[]): string | null =>
  reportsNewestFirst.reduce<string | null>((found, report) => found ?? readCanvas(report), null);

// What a design run is told, in the text the console fires the design routine with.
export type DesignBrief = {
  runId: string;
  // Where the session reports, and the pass it reports with: signed for this run only.
  reportUrl: string;
  pass: string;
  issue: { identifier: string; url: string; title: string | null };
  repository: string;
  branch: string | null;
  pr: number | null;
  trigger: string;
  // The person's reply, or the suggestions they approved the spec with.
  prompt: string | null;
  // The canvas an earlier round drew, to revise rather than start again.
  canvas: string | null;
  design: SpecDesign | null;
  // The project's Design System artifact, to bring up to date and draw with.
  designSystem: { url: string; build: string; out: string } | null;
};

export const designFireText = (brief: DesignBrief): string =>
  ['mb-factory design run. The brief, as JSON:', '', '```json', JSON.stringify(brief, null, 2), '```'].join('\n');

const firedSchema = z.object({
  claude_code_session_id: z.string().min(1),
  claude_code_session_url: z.url()
});

export type FiredSession = { sessionId: string; sessionUrl: string };

// The routine's `/fire` response: the session it started.
export const readFiredSession = (body: unknown): FiredSession | null => {
  const fired = firedSchema.safeParse(body);
  return fired.success
    ? { sessionId: fired.data.claude_code_session_id, sessionUrl: fired.data.claude_code_session_url }
    : null;
};

const designReportBodySchema = z.object({ report: z.unknown() });

// What a design session posts to the console: its stage report, as a stage workflow would write it.
export const readDesignReportBody = (body: unknown): { report: unknown } | null => {
  const read = designReportBodySchema.safeParse(body);
  return read.success ? { report: read.data.report } : null;
};

// The approved design's files, as the hand-off sends them: each board's markup and picture, and the notes. Flat names
// only, so nothing lands outside the design folder; the sizes keep the request inside Vercel's 4.5 MB body limit.
const MAX_DESIGN_FILES = 60;
const MAX_DESIGN_BASE64 = 4_000_000;
const DESIGN_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(html|png|md)$/;

const designFileSchema = z.object({
  name: z.string().regex(DESIGN_FILE_NAME),
  content: z.base64()
});

export type DesignFile = { name: string; content: string };

const designFilesSchema = z.looseObject({ files: z.array(designFileSchema).min(1).max(MAX_DESIGN_FILES) });

// Undefined when the body sends no files; null when it sends files that can't be committed as they are.
export const readDesignFiles = (body: unknown): DesignFile[] | null | undefined => {
  if (!z.looseObject({ files: z.unknown() }).safeParse(body).data?.files) {
    return undefined;
  }
  const read = designFilesSchema.safeParse(body);
  if (!read.success) {
    return null;
  }
  const names = new Set(read.data.files.map(({ name }) => name));
  const size = read.data.files.reduce((total, { content }) => total + content.length, 0);
  return names.size === read.data.files.length && size <= MAX_DESIGN_BASE64
    ? read.data.files.map(({ name, content }) => ({ name, content }))
    : null;
};

export const designFolder = (issueIdentifier: string): string => `specs/${issueIdentifier}/design`;

// The console commits an approved design with a person's token, so its push reads as theirs: the subject tells it apart.
export const DESIGN_COMMIT_SUBJECT = 'Add the approved design for ';

export const designCommitMessage = (issueIdentifier: string, coAuthor: string | null): string =>
  [`${DESIGN_COMMIT_SUBJECT}${issueIdentifier}`, ...(coAuthor ? ['', `Co-authored-by: ${coAuthor}`] : [])].join('\n');

const reportComponentsSchema = z.looseObject({ components: z.array(z.unknown()).nullish() });

// The components a design run reported as new or changed.
export const readDesignComponents = (report: unknown): SpecComponent[] =>
  componentsOf(reportComponentsSchema.safeParse(report).data?.components);

// A new Dino component the approved design needs: its own issue, built before the feature that uses it.
export const dinoIssue = (
  feature: { identifier: string; url: string },
  component: SpecComponent,
  { repository, branch }: { repository: string; branch: string | null }
): { title: string; description: string } => {
  const boards = branch
    ? `https://github.com/${repository}/tree/${encodeURI(branch)}/${designFolder(feature.identifier)}`
    : null;
  return {
    title: `Add ${component.name} to Dino`,
    description: [
      `A new Dino component that [${feature.identifier}](${feature.url}) needs, from its approved design. It blocks ${feature.identifier}, which builds with it once it's done.`,
      '',
      boards
        ? `The board with every state is in [${designFolder(feature.identifier)}](${boards}), on the spec's branch until ${feature.identifier} merges.`
        : `The board with every state is in \`${designFolder(feature.identifier)}\` on ${feature.identifier}'s spec branch.`,
      '',
      'Build it in Dino with a story for each state on the board, matching the board exactly.'
    ].join('\n')
  };
};

export const dinoWaitText = (
  filed: { identifier: string; url: string }[],
  markup: 'slack' | 'markdown' = 'slack'
): string => {
  const links = filed.map(({ identifier, url }) =>
    markup === 'slack' ? `<${url}|${identifier}>` : `[${identifier}](${url})`
  );
  const what = filed.length === 1 ? 'a new Dino component' : `${filed.length} new Dino components`;
  return `The design needs ${what} first: ${links.join(', ')}. Reply here once ${filed.length === 1 ? 'it’s' : 'they’re'} done and building starts.`;
};
