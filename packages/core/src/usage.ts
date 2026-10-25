import { z } from 'zod';

import type { UsageReading, UsageWindow } from './governor';
import { staleWindows } from './governor';
import type { RunUsageReading } from './run-report';
import { isPlausibleReset } from './run-report';

// Claude Code's status line input: `used_percentage` is 0–100 and `resets_at` is epoch seconds. Either window may be absent.
const statusLineWindowSchema = z.object({
  used_percentage: z.number().min(0),
  resets_at: z.number().positive()
});

export const statusLineUsageSchema = z.object({
  five_hour: statusLineWindowSchema.nullish(),
  seven_day: statusLineWindowSchema.nullish()
});

const STATUS_LINE_WINDOWS = { five_hour: 'fiveHour', seven_day: 'sevenDay' } as const;

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

// Usage only grows within a window, so a probe can't release a hold early; it only matters before releasing something.
export const needsProbe = ({
  readings,
  waiting,
  staleAfterMinutes,
  now
}: {
  readings: Partial<Record<UsageWindow, UsageReading>>;
  waiting: number;
  staleAfterMinutes: number;
  now: Date;
}): boolean => waiting > 0 && staleWindows(readings, now, staleAfterMinutes).length > 0;
