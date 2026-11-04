import { connection } from 'next/server';

// Which deployment serves production, so a deployment that isn't can pass its wake-ups on (`lib/wake.ts`). The ID is
// public in every deployment URL, so this needs no auth.
export const GET = async () => {
  await connection();
  return Response.json(
    { deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null },
    { headers: { 'cache-control': 'no-store' } }
  );
};
