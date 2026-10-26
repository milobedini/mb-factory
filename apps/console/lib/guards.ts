import type { FactoryConfig, Guard } from '@mb-factory/core';
import { decideFiling, GUARD_LABELS, guardFingerprint, guardIssue, readGuards } from '@mb-factory/core';
import { and, desc, eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { jobFindings } from '@/db/schema';

import { requireEnv } from './env';
import { fileTriageIssue, issueStateType } from './linear-api';
import { log } from './log';
import type { RunWithWorkItem } from './runs';

// Recorded with the jobs' findings under this reserved name, so the same filing rules apply.
const GUARD_JOB = 'guard';

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const fileGuard = async (project: FactoryConfig, { run, workItem }: RunWithWorkItem, guard: Guard): Promise<void> => {
  const fingerprint = guardFingerprint(workItem.issueIdentifier, guard);
  try {
    const organizationId = requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID');
    const [before] = await getDb()
      .select()
      .from(jobFindings)
      .where(
        and(
          eq(jobFindings.project, project.name),
          eq(jobFindings.job, GUARD_JOB),
          eq(jobFindings.fingerprint, fingerprint)
        )
      )
      .orderBy(desc(jobFindings.filedAt))
      .limit(1);
    const previous = before && {
      identifier: before.issueIdentifier,
      url: before.issueUrl,
      stateType: await issueStateType(organizationId, before.linearIssueId).catch(() => null)
    };
    const filing = decideFiling(previous);
    if (filing.kind === 'known') {
      log('info', 'guard already filed', { fingerprint, issue: filing.previous.identifier, why: filing.why });
      return;
    }
    const created = await fileTriageIssue(organizationId, {
      teamKey: project.linear.teamKey,
      ...guardIssue(guard, {
        issueIdentifier: workItem.issueIdentifier,
        issueUrl: workItem.issueUrl,
        prUrl: workItem.prNumber ? `https://github.com/${workItem.repository}/pull/${workItem.prNumber}` : null,
        runUrl: run.actionsRunUrl,
        previous: filing.kind === 'refile' ? filing.previous : undefined
      }),
      labels: GUARD_LABELS
    });
    await getDb().insert(jobFindings).values({
      project: project.name,
      job: GUARD_JOB,
      fingerprint,
      linearIssueId: created.id,
      issueIdentifier: created.identifier,
      issueUrl: created.url,
      runId: run.id
    });
    log('info', 'guard filed', { fingerprint, issue: created.identifier });
  } catch (error) {
    log('error', 'guard filing failed', { fingerprint, error: errorMessage(error) });
  }
};

// Guards an implement run couldn't fit in its PR go to the Triage inbox, one after another so they can't race to
// create the same missing label.
export const fileGuards = async (project: FactoryConfig, found: RunWithWorkItem): Promise<void> => {
  const guards = found.run.agent === 'implement' && found.run.status === 'finished' ? readGuards(found.run.report) : [];
  await guards.reduce<Promise<void>>(async (done, guard) => {
    await done;
    await fileGuard(project, found, guard);
  }, Promise.resolve());
};
