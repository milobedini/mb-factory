import { connection } from 'next/server';

export const GET = async () => {
  await connection();
  return Response.json({ ok: true });
};
