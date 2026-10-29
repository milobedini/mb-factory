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
