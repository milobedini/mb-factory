import type { FiredSession } from '@mb-factory/core';
import { readFiredSession } from '@mb-factory/core';

import { requireEnv } from './env';

// The design stage's routine on claude.ai, fired with the run's brief as its text. The token is the routine's own API
// trigger token, made once on the web; the endpoint is a research preview behind a dated beta header.
const FIRE_BETA = 'experimental-cc-routine-2026-04-01';

export const fireRoutine = async (routine: string, text: string): Promise<FiredSession> => {
  const response = await fetch(
    `https://api.anthropic.com/v1/claude_code/routines/${encodeURIComponent(routine)}/fire`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${requireEnv('DESIGN_ROUTINE_TOKEN')}`,
        'anthropic-beta': FIRE_BETA,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text })
    }
  );
  if (!response.ok) {
    throw new Error(`routine fire failed: ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  const fired = readFiredSession(await response.json().catch(() => undefined));
  if (!fired) {
    throw new Error('routine fire returned no session');
  }
  return fired;
};
