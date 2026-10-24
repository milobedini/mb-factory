import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

import { requireEnv } from '@/lib/env';

import * as schema from './schema';

const createDb = () => drizzle({ client: neon(requireEnv('DATABASE_URL')), schema, casing: 'snake_case' });

type Database = ReturnType<typeof createDb>;

const cache: { db?: Database } = {};

export const getDb = (): Database => {
  cache.db ??= createDb();
  return cache.db;
};
