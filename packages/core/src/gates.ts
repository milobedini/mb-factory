import { z } from 'zod';

// A gate a stage reports rather than posts, such as slicing approval: the router posts it in the Linear session with
// one-tap options and in the Slack thread with buttons, and an answer from either goes back to the stage as a reply.
// The spec approval gate is older and posted by the spec agent itself.
export type Gate = { body: string; options: string[] };

const MAX_OPTIONS = 4;
const MAX_OPTION_LENGTH = 75;
const MAX_BODY_LENGTH = 40_000;

// The option that only asks for changes: the router asks what to change instead of starting a run.
export const GATE_CHANGE = 'Change something';

export const GATE_CHANGES_QUESTION = 'What should change? Reply here with the changes and I’ll revise the proposal.';

export const GATE_GONE = 'That’s already been answered, or the work moved on.';

const gateSchema = z.object({
  body: z.string().trim().min(1).max(MAX_BODY_LENGTH),
  options: z
    .array(z.string().trim().min(1).max(MAX_OPTION_LENGTH))
    .min(2)
    .max(MAX_OPTIONS)
    .refine((options) => new Set(options.map((option) => option.toLowerCase())).size === options.length, {
      message: 'options must be distinct'
    })
});

const reportGateSchema = z.looseObject({ gate: z.unknown().nullish() });

// The gate a stage reported, if it's well formed; a malformed one is left out and the run closes as usual.
export const readGate = (report: unknown): Gate | undefined => {
  const gate = reportGateSchema.safeParse(report).data?.gate;
  return gate ? gateSchema.safeParse(gate).data : undefined;
};

// Whether a reply only picks "Change something", with nothing said about what to change.
export const onlyAsksForChanges = (body: string): boolean =>
  body
    .trim()
    .replace(/[.!]+$/, '')
    .toLowerCase() === GATE_CHANGE.toLowerCase();

const escapeSlack = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Linear's markdown as Slack's mrkdwn, as far as a gate needs it: headings and bold as bold, bullets, links. Text is
// escaped first, so nothing in the body becomes a Slack mention or link it didn't ask for.
export const slackMarkdown = (markdown: string): string =>
  markdown
    .split('\n')
    .map((line) => {
      const escaped = escapeSlack(line);
      const heading = escaped.match(/^#{1,6}\s+(.*)$/);
      const text = heading?.[1] ? `*${heading[1].replace(/\*\*/g, '')}*` : escaped;
      return text
        .replace(/^(\s*)[-*]\s+/, '$1• ')
        .replace(/\*\*(.+?)\*\*/g, '*$1*')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<$2|$1>');
    })
    .join('\n');

// Splits text at line breaks into pieces Slack's sections can hold; a single longer line is cut.
export const slackChunks = (text: string, limit: number): string[] => {
  const pack = ([line, ...rest]: string[], chunks: string[]): string[] => {
    if (line === undefined) {
      return chunks;
    }
    const piece = line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
    const last = chunks.at(-1);
    return pack(
      rest,
      last !== undefined && last.length + piece.length + 1 <= limit
        ? [...chunks.slice(0, -1), `${last}\n${piece}`]
        : [...chunks, piece]
    );
  };
  return pack(text.split('\n'), []);
};
