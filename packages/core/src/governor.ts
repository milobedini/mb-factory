import type { UsagePolicy } from './config';

export const USAGE_WINDOWS = ['fiveHour', 'sevenDay'] as const;

export type UsageWindow = (typeof USAGE_WINDOWS)[number];

export const USAGE_SOURCES = ['run', 'probe', 'local', 'estimate'] as const;

export type UsageSource = (typeof USAGE_SOURCES)[number];

// As reported by Claude Code's rate-limit telemetry for each window.
export const USAGE_STATUSES = ['allowed', 'allowed_warning', 'rejected'] as const;

export type UsageStatus = (typeof USAGE_STATUSES)[number];

export type UsageReading = {
  window: UsageWindow;
  utilisation: number;
  resetsAt: Date;
  takenAt: Date;
  source: UsageSource;
};

export const PRIORITIES = ['urgent', 'in_flight', 'feature', 'scheduled'] as const;

export type Priority = (typeof PRIORITIES)[number];

export type GovernorState = 'open' | 'throttled' | 'paused';

export const HOLD_REASONS = [
  'concurrency',
  'work_item_busy',
  'manual_pause',
  'five_hour_throttle',
  'five_hour_pause',
  'weekly_pacing',
  'weekly_pause'
] as const;

export type HoldReason = (typeof HOLD_REASONS)[number];

// Holds a human can override with "allow once": the usage limits and the console's pause, not the run caps.
export const USAGE_HOLD_REASONS: HoldReason[] = [
  'five_hour_throttle',
  'five_hour_pause',
  'weekly_pacing',
  'weekly_pause',
  'manual_pause'
];

export type Decision =
  | { kind: 'dispatch'; state: GovernorState; downshift: boolean }
  | { kind: 'hold'; state: GovernorState; reason: HoldReason; releaseAt?: Date }
  | { kind: 'probe'; stale: UsageWindow[] };

export type DispatchRequest = {
  policy: UsagePolicy;
  readings: Partial<Record<UsageWindow, UsageReading>>;
  priority: Priority;
  runningCount: number;
  maxRuns: number;
  now: Date;
  // Decide on whatever readings exist instead of asking for a probe.
  acceptStale?: boolean;
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const THROTTLE_ALLOWS: Priority[] = ['urgent', 'in_flight'];

const effectiveUtilisation = (reading: UsageReading, now: Date): number =>
  now.getTime() >= reading.resetsAt.getTime() ? 0 : reading.utilisation;

const isStale = (reading: UsageReading | undefined, now: Date, staleAfterMinutes: number): boolean =>
  !reading ||
  (now.getTime() < reading.resetsAt.getTime() &&
    now.getTime() - reading.takenAt.getTime() > staleAfterMinutes * 60 * 1000);

// Windows with no reading, or whose reading is older than the limit and hasn't reset since.
export const staleWindows = (
  readings: Partial<Record<UsageWindow, UsageReading>>,
  now: Date,
  staleAfterMinutes: number
): UsageWindow[] => USAGE_WINDOWS.filter((window) => isStale(readings[window], now, staleAfterMinutes));

export const weeklyPaceLimit = (reading: UsageReading, now: Date, slack: number): number => {
  const windowStart = reading.resetsAt.getTime() - WEEK_MS;
  const elapsed = Math.min(Math.max((now.getTime() - windowStart) / WEEK_MS, 0), 1);
  return elapsed + slack;
};

const paceReleaseAt = (reading: UsageReading, slack: number): Date => {
  const windowStart = reading.resetsAt.getTime() - WEEK_MS;
  const neededElapsed = Math.max(reading.utilisation - slack, 0);
  return new Date(windowStart + neededElapsed * WEEK_MS);
};

export type Assessment = { state: GovernorState; reason?: HoldReason; releaseAt?: Date };

export const assessUsage = (
  policy: UsagePolicy,
  fiveHour: UsageReading | undefined,
  sevenDay: UsageReading | undefined,
  now: Date
): Assessment => {
  const fiveHourUsed = fiveHour ? effectiveUtilisation(fiveHour, now) : 0;
  const sevenDayUsed = sevenDay ? effectiveUtilisation(sevenDay, now) : 0;

  if (sevenDay && sevenDayUsed >= policy.sevenDay.pauseAt) {
    return { state: 'paused', reason: 'weekly_pause', releaseAt: sevenDay.resetsAt };
  }
  if (fiveHour && fiveHourUsed >= policy.fiveHour.pauseAt) {
    return { state: 'paused', reason: 'five_hour_pause', releaseAt: fiveHour.resetsAt };
  }
  if (fiveHour && fiveHourUsed >= policy.fiveHour.throttleAt) {
    return { state: 'throttled', reason: 'five_hour_throttle', releaseAt: fiveHour.resetsAt };
  }
  if (sevenDay && policy.sevenDay.pacing && sevenDayUsed > weeklyPaceLimit(sevenDay, now, policy.sevenDay.slack)) {
    return { state: 'throttled', reason: 'weekly_pacing', releaseAt: paceReleaseAt(sevenDay, policy.sevenDay.slack) };
  }
  return { state: 'open' };
};

export const decideDispatch = ({
  policy,
  readings,
  priority,
  runningCount,
  maxRuns,
  now,
  acceptStale = false
}: DispatchRequest): Decision => {
  const stale = staleWindows(readings, now, policy.staleAfterMinutes);
  if (stale.length > 0 && !acceptStale) {
    return { kind: 'probe', stale };
  }

  const { state, reason, releaseAt } = assessUsage(policy, readings.fiveHour, readings.sevenDay, now);

  if (runningCount >= maxRuns) {
    return { kind: 'hold', state, reason: 'concurrency' };
  }
  if (state === 'paused' && reason) {
    return { kind: 'hold', state, reason, releaseAt };
  }
  if (state === 'throttled' && reason && !THROTTLE_ALLOWS.includes(priority)) {
    return { kind: 'hold', state, reason, releaseAt };
  }
  return { kind: 'dispatch', state, downshift: state === 'throttled' };
};
