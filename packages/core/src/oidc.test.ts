import { describe, expect, it } from 'vitest';

import { checkGovernorClaims, checkStageRunClaims } from './oidc';

const claims = {
  iss: 'https://token.actions.githubusercontent.com',
  aud: 'https://mb-factory-console.vercel.app',
  repository: 'milobedini/tastebook',
  job_workflow_ref: 'milobedini/mb-factory/.github/workflows/stage.yml@refs/heads/main',
  run_id: '40169112940',
  event_name: 'repository_dispatch'
};

const check = (overrides: Record<string, unknown> = {}, actionsRunId: string | null = null) =>
  checkStageRunClaims({ claims: { ...claims, ...overrides }, repository: 'milobedini/tastebook', actionsRunId });

describe('checkStageRunClaims', () => {
  it('accepts the stage workflow dispatched in the run’s repository', () => {
    expect(check()).toEqual({ ok: true, claims });
  });

  it('accepts the stage workflow from any ref of the factory repo', () => {
    expect(check({ job_workflow_ref: 'milobedini/mb-factory/.github/workflows/stage.yml@refs/heads/try-x' }).ok).toBe(
      true
    );
  });

  it('matches the repository case-insensitively, as GitHub does', () => {
    expect(check({ repository: 'MiloBedini/Tastebook' }).ok).toBe(true);
  });

  it('accepts the Actions run recorded at start', () => {
    expect(check({}, '40169112940').ok).toBe(true);
  });

  it.each([
    [
      'another repository',
      { repository: 'someone/tastebook' },
      'token is for someone/tastebook, run belongs to milobedini/tastebook'
    ],
    [
      'another workflow',
      { job_workflow_ref: 'milobedini/tastebook/.github/workflows/factory.yml@refs/heads/main' },
      'token is not from the factory stage workflow'
    ],
    [
      'a lookalike workflow path',
      { job_workflow_ref: 'milobedini/mb-factory/.github/workflows/stage.yml.evil@refs/heads/main' },
      'token is not from the factory stage workflow'
    ],
    ['a pull request run', { event_name: 'pull_request' }, 'token is from a pull_request run, not a dispatch'],
    ['missing claims', { run_id: undefined }, 'token is missing workflow claims']
  ])('rejects %s', (_label, overrides, reason) => {
    expect(check(overrides)).toEqual({ ok: false, reason });
  });

  it('rejects a token from a different Actions run once one is recorded', () => {
    expect(check({}, '1')).toEqual({ ok: false, reason: 'token is from a different Actions run' });
  });
});

describe('checkGovernorClaims', () => {
  const governor = {
    ...claims,
    repository: 'milobedini/mb-factory',
    job_workflow_ref: 'milobedini/mb-factory/.github/workflows/governor.yml@refs/heads/main',
    event_name: 'schedule'
  };

  it('accepts the governor workflow on main, scheduled or run by hand', () => {
    expect(checkGovernorClaims(governor).ok).toBe(true);
    expect(checkGovernorClaims({ ...governor, event_name: 'workflow_dispatch' }).ok).toBe(true);
  });

  it('rejects the governor workflow from another branch, which anyone with a branch could edit', () => {
    expect(
      checkGovernorClaims({
        ...governor,
        job_workflow_ref: 'milobedini/mb-factory/.github/workflows/governor.yml@refs/heads/try-x'
      })
    ).toEqual({ ok: false, reason: 'token is not from the governor workflow on main' });
  });

  it('rejects other workflows, repos and events', () => {
    expect(checkGovernorClaims({ ...governor, job_workflow_ref: claims.job_workflow_ref }).ok).toBe(false);
    expect(checkGovernorClaims({ ...governor, repository: 'milobedini/tastebook' }).ok).toBe(false);
    expect(checkGovernorClaims({ ...governor, event_name: 'pull_request' }).ok).toBe(false);
  });
});
