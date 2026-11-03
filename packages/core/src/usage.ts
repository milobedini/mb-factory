import { z } from 'zod';

import type { UsagePolicy } from './config';
import type { Assessment, UsageReading, UsageSource, UsageWindow } from './governor';
import { assessUsage, staleWindows, USAGE_WINDOWS, weeklyPaceLimit } from './governor';
import type { RunUsageReading } from './run-report';
import { isPlausibleReset } from './run-report';

// Claude Code's status line input: `used_percentage` is 0–100 and `resets_at` is epoch seconds. Either window may be absent.
const statusLineWindowSchema = z.object({
  used_percentage: z.number().min(0),
  resets_at: z.number().positive()
});

// A `five_hour` window is ignored: the account has none since 30 Oct 2026, and others' status lines may still send it.
export const statusLineUsageSchema = z.object({
  seven_day: statusLineWindowSchema.nullish()
});

const STATUS_LINE_WINDOWS = { seven_day: 'sevenDay' } as const;

export const readingsFromStatusLine = (body: unknown, now: Date): RunUsageReading[] | undefined => {
  const parsed = statusLineUsageSchema.safeParse(body);
  if (!parsed.success) {
    return undefined;
  }
  return Object.entries(STATUS_LINE_WINDOWS).flatMap(([key, window]) => {
    const reading = parsed.data[key as keyof typeof STATUS_LINE_WINDOWS];
    const resetsAt = reading ? new Date(reading.resets_at * 1000) : undefined;
    return reading && resetsAt && isPlausibleReset(window, resetsAt, now)
      ? [{ window, utilisation: Math.min(reading.used_percentage / 100, 1), resetsAt, status: null }]
      : [];
  });
};

// Usage only grows within a window, so a probe can't release a hold early; it only matters before releasing something:
// held work, or a scheduled job about to start (`jobSoon`) while nobody's status line is reporting.
export const needsProbe = ({
  readings,
  waiting,
  jobSoon = false,
  staleAfterMinutes,
  now
}: {
  readings: Partial<Record<UsageWindow, UsageReading>>;
  waiting: number;
  jobSoon?: boolean;
  staleAfterMinutes: number;
  now: Date;
}): boolean => (waiting > 0 || jobSoon) && staleWindows(readings, now, staleAfterMinutes).length > 0;

export type WindowSummary = {
  window: UsageWindow;
  // Zero once the window has reset, whatever the last reading said.
  utilisation: number;
  resetsAt: Date | null;
  takenAt: Date | null;
  source: UsageSource | null;
  stale: boolean;
  reset: boolean;
  // Thresholds from the policy; `paceLimit` is the weekly share allowed by now when pacing is on.
  pauseAt: number;
  paceLimit: number | null;
};

export type UsageSummary = Assessment & { windows: WindowSummary[] };

// What the Usage page shows: each window as the governor sees it now, and the state it would decide on.
export const summariseUsage = ({
  policy,
  readings,
  now
}: {
  policy: UsagePolicy;
  readings: Partial<Record<UsageWindow, UsageReading>>;
  now: Date;
}): UsageSummary => {
  const stale = staleWindows(readings, now, policy.staleAfterMinutes);
  const windows = USAGE_WINDOWS.map((window): WindowSummary => {
    const reading = readings[window];
    const reset = reading ? now.getTime() >= reading.resetsAt.getTime() : false;
    return {
      window,
      utilisation: reading && !reset ? reading.utilisation : 0,
      resetsAt: reading && !reset ? reading.resetsAt : null,
      takenAt: reading?.takenAt ?? null,
      source: reading?.source ?? null,
      stale: stale.includes(window),
      reset,
      pauseAt: policy.sevenDay.pauseAt,
      paceLimit:
        policy.sevenDay.pacing && reading && !reset
          ? Math.min(weeklyPaceLimit(reading, now, policy.sevenDay.slack), 1)
          : null
    };
  });
  return { ...assessUsage(policy, readings.sevenDay, now), windows };
};

const MINUTE_MS = 60_000;

// "2 h 51 min", "4 min", "under a minute": for countdowns and reading ages.
export const formatDuration = (ms: number): string => {
  const minutes = Math.floor(Math.abs(ms) / MINUTE_MS);
  if (minutes < 1) {
    return 'under a minute';
  }
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  return [days ? `${days} d` : '', hours ? `${hours} h` : '', rest && !days ? `${rest} min` : '']
    .filter(Boolean)
    .join(' ');
};
