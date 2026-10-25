import { z } from 'zod';

import type { UsageStatus, UsageWindow } from './governor';
import { USAGE_STATUSES } from './governor';
import type { RunOutcome, RunStatus } from './runs';
import { RUN_OUTCOMES } from './runs';
import { AGENT_ROLES } from './stages';

// The branch is echoed into later briefs and git commands, so it must be a plain ref name.
const branchSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/)
  .refine(
    (branch) => !branch.includes('..') && !branch.includes('//') && !branch.endsWith('/') && !branch.endsWith('.lock'),
    {
      message: 'not a valid branch name'
    }
  );

export const stageReportSchema = z.looseObject({
  stage: z.enum(AGENT_ROLES),
  outcome: z.enum(RUN_OUTCOMES),
  summary: z.string().min(1),
  next: z.string().nullish(),
  pr: z.int().positive().nullish(),
  branch: branchSchema.nullish(),
  followUps: z.array(z.string()).nullish(),
  findings: z.array(z.unknown()).nullish()
});

export type StageReport = z.infer<typeof stageReportSchema>;

// What the stage workflow posts back: the agent's report file and the few execution events the console reads.
export const runReportSchema = z.object({
  conclusion: z.string().nullish(),
  report: z.unknown(),
  events: z.array(z.unknown()).max(1000)
});

export type RunReport = z.infer<typeof runReportSchema>;

// Claude Code's stream-json events are undocumented, so each one is parsed on its own and skipped if it doesn't fit.
const rateLimitWindowSchema = z.object({
  utilization: z
    .number()
    .min(0)
    .transform((utilization) => Math.min(utilization, 1)),
  resetsAt: z.number().positive(),
  status: z.string().optional()
});

const rateLimitEventSchema = z.object({
  type: z.literal('rate_limit_event'),
  rate_limit_info: z.object({
    status: z.string().optional(),
    unifiedWindows: z
      .object({ five_hour: rateLimitWindowSchema.optional(), seven_day: rateLimitWindowSchema.optional() })
      .optional()
  })
});

const modelUsageSchema = z.object({
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  cacheReadInputTokens: z.number().default(0),
  cacheCreationInputTokens: z.number().default(0)
});

const resultEventSchema = z.object({
  type: z.literal('result'),
  subtype: z.string(),
  is_error: z.boolean(),
  num_turns: z.number().optional(),
  duration_ms: z.number().optional(),
  total_cost_usd: z.number().optional(),
  modelUsage: z.record(z.string(), modelUsageSchema).optional()
});

type RateLimitEvent = z.infer<typeof rateLimitEventSchema>;
type ResultEvent = z.infer<typeof resultEventSchema>;

export type RunUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number | null;
  durationMs: number | null;
  numTurns: number | null;
};

export type RunUsageReading = {
  window: UsageWindow;
  utilisation: number;
  resetsAt: Date;
  status: UsageStatus | null;
};

export type RunSummary = {
  status: Extract<RunStatus, 'finished' | 'limit_hit'>;
  outcome: RunOutcome | null;
  summary: string;
  report: StageReport | null;
  usage: RunUsage | null;
  readings: RunUsageReading[];
};

const WINDOW_KEYS = { five_hour: 'fiveHour', seven_day: 'sevenDay' } as const;

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_LENGTH_MS: Record<UsageWindow, number> = { fiveHour: 5 * HOUR_MS, sevenDay: 7 * 24 * HOUR_MS };
const RESET_TOLERANCE_MS = 10 * 60 * 1000;

// The agent shares the runner with the report step, so a reading must at least look like a real window.
export const isPlausibleReset = (window: UsageWindow, resetsAt: Date, now: Date): boolean => {
  const fromNow = resetsAt.getTime() - now.getTime();
  return fromNow > -RESET_TOLERANCE_MS && fromNow <= WINDOW_LENGTH_MS[window] + RESET_TOLERANCE_MS;
};

const lastMatch = <T>(events: unknown[], schema: z.ZodType<T>): T | undefined =>
  events.reduce<T | undefined>((found, event) => {
    const parsed = schema.safeParse(event);
    return parsed.success ? parsed.data : found;
  }, undefined);

const toUsageStatus = (status: string | undefined): UsageStatus | null =>
  USAGE_STATUSES.find((known) => known === status) ?? null;

const toReadings = (event: RateLimitEvent | undefined, now: Date): RunUsageReading[] =>
  Object.entries(WINDOW_KEYS).flatMap(([key, window]) => {
    const reading = event?.rate_limit_info.unifiedWindows?.[key as keyof typeof WINDOW_KEYS];
    const resetsAt = reading ? new Date(reading.resetsAt * 1000) : undefined;
    return reading && resetsAt && isPlausibleReset(window, resetsAt, now)
      ? [{ window, utilisation: reading.utilization, resetsAt, status: toUsageStatus(reading.status) }]
      : [];
  });

const toUsage = (result: ResultEvent | undefined): RunUsage | null => {
  if (!result) {
    return null;
  }
  const models = Object.values(result.modelUsage ?? {});
  const sum = (field: keyof z.infer<typeof modelUsageSchema>) =>
    models.reduce((total, model) => total + model[field], 0);
  return {
    inputTokens: sum('inputTokens'),
    outputTokens: sum('outputTokens'),
    cacheReadInputTokens: sum('cacheReadInputTokens'),
    cacheCreationInputTokens: sum('cacheCreationInputTokens'),
    costUsd: result.total_cost_usd ?? null,
    durationMs: result.duration_ms ?? null,
    numTurns: result.num_turns ?? null
  };
};

// The usage windows from the last rate-limit event in a stream-json transcript.
export const readingsFromEvents = (events: unknown[], now: Date): RunUsageReading[] =>
  toReadings(lastMatch(events, rateLimitEventSchema), now);

const isRejected = (event: RateLimitEvent | undefined, readings: RunUsageReading[]): boolean =>
  event?.rate_limit_info.status === 'rejected' || readings.some(({ status }) => status === 'rejected');

const missingReportSummary = (result: ResultEvent | undefined, conclusion: string | null | undefined): string => {
  const detail = result?.is_error ? ` Claude Code ended with ${result.subtype}.` : '';
  const failed = conclusion === 'failure' ? ' The workflow step failed.' : '';
  return `The stage ended without a valid report.${detail}${failed}`;
};

export const summariseRun = ({ conclusion, report, events }: RunReport, now: Date): RunSummary => {
  const stageReport = stageReportSchema.safeParse(report);
  const rateLimit = lastMatch(events, rateLimitEventSchema);
  const result = lastMatch(events, resultEventSchema);
  const readings = toReadings(rateLimit, now);
  const usage = toUsage(result);

  if (stageReport.success) {
    return {
      status: 'finished',
      outcome: stageReport.data.outcome,
      summary: stageReport.data.summary,
      report: stageReport.data,
      usage,
      readings
    };
  }
  if (isRejected(rateLimit, readings)) {
    return {
      status: 'limit_hit',
      outcome: null,
      summary: 'Hit the usage limit before the stage finished.',
      report: null,
      usage,
      readings
    };
  }
  return {
    status: 'finished',
    outcome: 'failed',
    summary: missingReportSummary(result, conclusion),
    report: null,
    usage,
    readings
  };
};
