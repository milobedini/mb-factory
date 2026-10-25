import { z } from 'zod';

export const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';

export const STAGE_WORKFLOW = 'milobedini/mb-factory/.github/workflows/stage.yml';

const claimsSchema = z.looseObject({
  repository: z.string().min(1),
  job_workflow_ref: z.string().min(1),
  run_id: z.string().min(1),
  event_name: z.string().min(1)
});

export type StageRunClaims = z.infer<typeof claimsSchema>;

export type ClaimCheck = { ok: true; claims: StageRunClaims } | { ok: false; reason: string };

// Signature, issuer, audience and expiry are checked by the caller before this; these are the factory's own rules.
export const checkStageRunClaims = ({
  claims,
  repository,
  actionsRunId
}: {
  claims: unknown;
  repository: string;
  actionsRunId: string | null;
}): ClaimCheck => {
  const parsed = claimsSchema.safeParse(claims);
  if (!parsed.success) {
    return { ok: false, reason: 'token is missing workflow claims' };
  }
  const { data } = parsed;
  if (data.repository.toLowerCase() !== repository.toLowerCase()) {
    return { ok: false, reason: `token is for ${data.repository}, run belongs to ${repository}` };
  }
  if (!data.job_workflow_ref.startsWith(`${STAGE_WORKFLOW}@`)) {
    return { ok: false, reason: 'token is not from the factory stage workflow' };
  }
  if (data.event_name !== 'repository_dispatch') {
    return { ok: false, reason: `token is from a ${data.event_name} run, not a dispatch` };
  }
  if (actionsRunId !== null && data.run_id !== actionsRunId) {
    return { ok: false, reason: 'token is from a different Actions run' };
  }
  return { ok: true, claims: data };
};
