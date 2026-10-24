type LogLevel = 'info' | 'warn' | 'error';

export const log = (level: LogLevel, message: string, fields: Record<string, unknown> = {}) => {
  process.stdout.write(`${JSON.stringify({ level, message, ...fields, at: new Date().toISOString() })}\n`);
};
