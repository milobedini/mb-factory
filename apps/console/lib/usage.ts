import type { RunUsageReading, UsageReading, UsageSource, UsageWindow } from '@mb-factory/core';
import { USAGE_WINDOWS } from '@mb-factory/core';
import { desc, eq, isNull } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { queue, usageReadings } from '@/db/schema';

const latestReading = async (window: UsageWindow) => {
  const [row] = await getDb()
    .select()
    .from(usageReadings)
    .where(eq(usageReadings.window, window))
    .orderBy(desc(usageReadings.takenAt))
    .limit(1);
  return row;
};

export const latestReadings = async (): Promise<Partial<Record<UsageWindow, UsageReading>>> => {
  const latest = await Promise.all(USAGE_WINDOWS.map(latestReading));
  return Object.fromEntries(
    latest
      .filter((row) => row !== undefined)
      .map(({ window, utilisation, resetsAt, takenAt, source }) => [
        window,
        { window, utilisation, resetsAt, takenAt, source }
      ])
  );
};

export const countWaiting = async (): Promise<number> => getDb().$count(queue, isNull(queue.releasedAt));

// The status line reports many times a minute while you work: an unchanged local reading only refreshes its time.
const recordReading = async (reading: RunUsageReading, source: UsageSource, now: Date): Promise<void> => {
  const db = getDb();
  const latest = source === 'local' ? await latestReading(reading.window) : undefined;
  if (
    latest?.source === 'local' &&
    latest.utilisation === reading.utilisation &&
    latest.resetsAt.getTime() === reading.resetsAt.getTime()
  ) {
    await db.update(usageReadings).set({ takenAt: now }).where(eq(usageReadings.id, latest.id));
    return;
  }
  await db.insert(usageReadings).values({ ...reading, source, takenAt: now });
};

export const recordReadings = async (readings: RunUsageReading[], source: UsageSource, now: Date): Promise<void> => {
  await Promise.all(readings.map((reading) => recordReading(reading, source, now)));
};
