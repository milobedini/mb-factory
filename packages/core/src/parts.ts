import { z } from 'zod';

const MAX_PARTS = 5;
const MAX_TITLE = 80;
const MAX_SCOPE = 2000;

// Linear's T-shirt estimates as stored.
const ESTIMATES = { XS: 1, S: 2, M: 3, L: 5, XL: 8 } as const;

const partSchema = z.looseObject({
  title: z.string().trim().min(1).max(MAX_TITLE),
  // What this part builds and how it's checked, from the spec; becomes the sub-issue's description.
  scope: z.string().trim().min(1).max(MAX_SCOPE),
  size: z.enum(['XS', 'S', 'M', 'L', 'XL']).nullish().catch(null)
});

export type SpecPart = { title: string; scope: string; estimate: number | null };

const reportPartsSchema = z.looseObject({ parts: z.array(z.unknown()).nullish() });

// The later parts a spec split its work into: the issue itself is part 1, so these are parts 2 onwards, in order. A
// malformed part ends the list, since each part builds on the one before.
export const readSpecParts = (report: unknown): SpecPart[] => {
  const listed = reportPartsSchema.safeParse(report).data?.parts ?? [];
  const firstBad = listed.findIndex((part) => !partSchema.safeParse(part).success);
  return (firstBad === -1 ? listed : listed.slice(0, firstBad)).slice(0, MAX_PARTS).flatMap((part) => {
    const read = partSchema.safeParse(part);
    return read.success
      ? [
          {
            title: read.data.title,
            scope: read.data.scope,
            estimate: read.data.size ? ESTIMATES[read.data.size] : null
          }
        ]
      : [];
  });
};

// A sub-issue for one later part. Triage reads the first lines and sends it straight to implement.
export const partDescription = (
  parent: { identifier: string },
  part: SpecPart,
  { number, total }: { number: number; total: number }
): string =>
  [
    `Part ${number} of ${total} of ${parent.identifier}. The spec is approved: \`specs/${parent.identifier}.md\` on \`main\` (it lands with part 1). This issue builds part ${number} of it.`,
    '',
    '**Triage:** the spec is approved, so send this straight to implement; don’t write another spec.',
    '',
    part.scope,
    '',
    `The PR's first line is \`Fixes <this issue>\`, so each part closes its own issue.`
  ].join('\n');

// Parts are filed in the team's first Backlog status, so each is ready to delegate once unblocked; without one, Linear
// would put an issue filed by the app in Triage, as work nobody has accepted yet.
export const partStateId = (backlogStates: { id: string; position: number }[]): string | undefined =>
  backlogStates.toSorted((a, b) => a.position - b.position)[0]?.id;

// The thread's note once the parts are filed.
export const partsFiledText = (parent: { identifier: string }, filed: { identifier: string; url: string }[]): string =>
  `Split into ${filed.length + 1} parts: ${parent.identifier} is part 1, and I filed ${filed
    .map(({ identifier, url }, index) => `<${url}|${identifier}> (part ${index + 2})`)
    .join(', ')} as sub-issues. Each is posted in the channel to delegate once the one before merges.`;
