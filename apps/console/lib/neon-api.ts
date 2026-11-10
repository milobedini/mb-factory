import type { FactoryConfig, NeonBranch } from '@mb-factory/core';
import { previewBranchFor } from '@mb-factory/core';

import { requireEnv } from './env';

type Neon = NonNullable<FactoryConfig['neon']>;

const NEON_API = 'https://console.neon.tech/api/v2';

const neonFetch = (path: string, init?: RequestInit) =>
  fetch(`${NEON_API}${path}`, {
    ...init,
    headers: { Accept: 'application/json', Authorization: `Bearer ${requireEnv('NEON_API_KEY')}` }
  });

// Deletes the database branch a Git branch's previews used, and says its name; nothing when there's none. Neon's own
// cleanup may delete it first, so a branch already gone counts as deleted. A free project holds 10 branches, which one
// page lists.
export const deletePreviewBranch = async ({ project }: Neon, gitBranch: string): Promise<string | undefined> => {
  const branchesPath = `/projects/${encodeURIComponent(project)}/branches`;
  const listed = await neonFetch(branchesPath);
  if (!listed.ok) {
    throw new Error(`Neon branches failed with ${listed.status}: ${(await listed.text()).slice(0, 200)}`);
  }
  const { branches } = (await listed.json()) as { branches: NeonBranch[] };
  const branch = previewBranchFor(branches, gitBranch);
  if (!branch) {
    return undefined;
  }
  const deleted = await neonFetch(`${branchesPath}/${encodeURIComponent(branch.id)}`, { method: 'DELETE' });
  if (!deleted.ok && deleted.status !== 404) {
    throw new Error(`Neon branch delete failed with ${deleted.status}: ${(await deleted.text()).slice(0, 200)}`);
  }
  return branch.name;
};
