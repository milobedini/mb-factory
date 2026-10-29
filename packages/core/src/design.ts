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
