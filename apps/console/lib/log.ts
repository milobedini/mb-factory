import type { ProblemLevel } from '@mb-factory/core';
import { problemHour } from '@mb-factory/core';
import { waitUntil } from '@vercel/functions';
import { sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { consoleProblems } from '@/db/schema';

type LogLevel = 'info' | ProblemLevel;

// Enough to read the latest line's fields in the health check, not a whole payload.
const MAX_FIELDS_LENGTH = 4000;

const write = (line: Record<string, unknown>) => {
  process.stdout.write(`${JSON.stringify(line)}\n`);
};

const storedFields = (fields: Record<string, unknown>): unknown => {
  const json = JSON.stringify(fields);
  return json.length > MAX_FIELDS_LENGTH ? { clipped: json.slice(0, MAX_FIELDS_LENGTH) } : JSON.parse(json);
};

// Vercel keeps logs for 30 minutes, so warnings and errors are also counted in the database for the daily health
// check. A failure there goes to stdout only, never back through `log`.
const recordProblem = async (level: ProblemLevel, message: string, fields: Record<string, unknown>, at: Date) => {
  try {
    const stored = storedFields(fields);
    await getDb()
      .insert(consoleProblems)
      .values({ hour: problemHour(at), level, message, fields: stored, lastAt: at })
      .onConflictDoUpdate({
        target: [consoleProblems.hour, consoleProblems.level, consoleProblems.message],
        set: {
          count: sql`${consoleProblems.count} + 1`,
          fields: stored,
          lastAt: sql`greatest(${consoleProblems.lastAt}, excluded.last_at)`
        }
      });
  } catch (error) {
    write({
      level: 'warn',
      message: 'console problem not recorded',
      problem: message,
      error: error instanceof Error ? error.message : String(error),
      at: new Date().toISOString()
    });
  }
};

export const log = (level: LogLevel, message: string, fields: Record<string, unknown> = {}) => {
  const at = new Date();
  write({ level, message, ...fields, at: at.toISOString() });
  if (level !== 'info') {
    waitUntil(recordProblem(level, message, fields, at));
  }
};
