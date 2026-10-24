import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const linearInstallations = pgTable('linear_installations', {
  id: uuid().primaryKey().defaultRandom(),
  organizationId: text().notNull().unique(),
  organizationName: text().notNull(),
  appUserId: text().notNull(),
  accessToken: text().notNull(),
  refreshToken: text().notNull(),
  accessTokenExpiresAt: timestamp({ withTimezone: true }).notNull(),
  scopes: text().array().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
});

export const events = pgTable(
  'events',
  {
    id: uuid().primaryKey().defaultRandom(),
    source: text({ enum: ['linear', 'slack', 'github'] }).notNull(),
    deliveryId: text().notNull(),
    type: text().notNull(),
    action: text(),
    payload: jsonb().notNull(),
    receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow()
  },
  (table) => [uniqueIndex('events_source_delivery_idx').on(table.source, table.deliveryId)]
);
