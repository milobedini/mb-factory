import { isNull } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { pauses } from '@/db/schema';

export type Pause = typeof pauses.$inferSelect;

export const currentPause = async (): Promise<Pause | undefined> => {
  const [pause] = await getDb().select().from(pauses).where(isNull(pauses.resumedAt)).limit(1);
  return pause;
};

// At most one pause is open (a unique index), so pausing twice changes nothing.
export const pauseFactory = async (login: string): Promise<void> => {
  await getDb().insert(pauses).values({ pausedBy: login }).onConflictDoNothing();
};

export const resumeFactory = async (login: string): Promise<boolean> => {
  const resumed = await getDb()
    .update(pauses)
    .set({ resumedBy: login, resumedAt: new Date() })
    .where(isNull(pauses.resumedAt))
    .returning({ id: pauses.id });
  return resumed.length > 0;
};
