export const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
};
