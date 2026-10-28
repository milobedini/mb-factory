import { z } from 'zod';

import { neutraliseMarkdown } from './jobs';
import type { Size } from './sizes';
import { ESTIMATES, SIZES } from './sizes';
import type { IssueUpdate } from './work-item-events';

const SIZING_STATES = ['backlog', 'unstarted'];
const MAX_WHY = 500;

// A person moved an unsized issue nobody has delegated into Backlog or Todo (accepting it out of Triage, most often), or
// wrote one there. A person, because the run starts an agent on the issue's text without a Delegate tap: never for an
// integration's issue or one Linear names no actor for. Triage sizes a delegated issue itself, and the factory's own
// moves are its own.
export const needsSizing = (update: IssueUpdate, appUserId: string): boolean =>
  update.actorType === 'user' &&
  update.actorId !== appUserId &&
  update.state !== undefined &&
  SIZING_STATES.includes(update.state.type) &&
  update.estimate === null &&
  !update.delegated;

const sizeReportSchema = z.looseObject({
  outcome: z.literal('done'),
  size: z.enum(SIZES),
  why: z.string().trim().min(1).max(MAX_WHY)
});

export type SizeReport = { size: Size; estimate: number; why: string };

// A size run's answer: the size as Linear's estimate, and one line on why.
export const readSizeReport = (report: unknown): SizeReport | undefined => {
  const read = sizeReportSchema.safeParse(report);
  return read.success ? { size: read.data.size, estimate: ESTIMATES[read.data.size], why: read.data.why } : undefined;
};

const runLog = (runUrl: string | null): string => (runUrl ? ` ([run log](${runUrl}))` : '');

// Posted on the issue when the run gave no size, so it isn't left unsized without a word.
export const unsizedComment = (summary: string | null, runUrl: string | null): string =>
  `**The factory couldn't size this** on accepting${summary ? `: ${neutraliseMarkdown(summary.replace(/\s+/g, ' ').trim())}` : '.'}${runLog(runUrl)}\n\nSize it by hand, or rewrite it and move it to Backlog again.`;

// Posted on the issue with the estimate, so the call can be challenged where it's seen. The agent wrote `why`, so it's
// made inert.
export const sizedComment = ({ size, why }: SizeReport, runUrl: string | null): string =>
  `**Sized ${size}** by the factory on accepting: ${neutraliseMarkdown(why.replace(/\s+/g, ' ').trim())}${runLog(runUrl)}\n\nChange the estimate if it's off.`;
