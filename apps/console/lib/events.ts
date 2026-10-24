import { randomUUID } from 'node:crypto';

import { getDb } from '@/db/client';
import { events } from '@/db/schema';

export type EventSource = 'linear' | 'slack' | 'github';

export type IncomingEvent = {
  source: EventSource;
  deliveryId: string | null | undefined;
  type: string;
  action?: string;
  payload: unknown;
};

export const recordEvent = async ({ source, deliveryId, type, action, payload }: IncomingEvent): Promise<boolean> => {
  const inserted = await getDb()
    .insert(events)
    .values({ source, deliveryId: deliveryId ?? randomUUID(), type, action, payload })
    .onConflictDoNothing()
    .returning({ id: events.id });
  return inserted.length > 0;
};
