import type { FactoryConfig, FiledBefore, FindingIssue, GuardContext } from '@mb-factory/core';
import {
  decideFiling,
  GUARD_LABELS,
  guardFingerprint,
  guardIssue,
  readGuards,
  readWorkarounds,
  workaroundFingerprint,
  workaroundIssue
} from '@mb-factory/core';
import { and, desc, eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { jobFindings } from '@/db/schema';

import { requireEnv } from './env';
import { fileTriageIssue, issueStateType } from './linear-api';
import { log } from './log';
import type { RunWithWorkItem } from './runs';

// Recorded with the jobs' findings under these reserved names, so the same filing rules apply.
const GUARD_JOB = 'guard';
const WORKAROUND_JOB = 'workaround';

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

type Tracked = { identifier: string; url: string; title: string };

// Files one issue a run reported in Triage, unless its fingerprint's issue is still open or was declined. Returns the
// issue that tracks it now (new or open), or nothing when declined or filing failed.
const fileOnce = async (
  project: FactoryConfig,
  { run, workItem }: RunWithWorkItem,
  { job, fingerprint, issue }: { job: string; fingerprint: string; issue: (context: GuardContext) => FindingIssue }
): Promise<Tracked | undefined> => {
  try {
    const organizationId = requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID');
    const [before] = await getDb()
      .select()
      .from(jobFindings)
      .where(
        and(eq(jobFindings.project, project.name), eq(jobFindings.job, job), eq(jobFindings.fingerprint, fingerprint))
      )
      .orderBy(desc(jobFindings.filedAt))
      .limit(1);
    const previous: FiledBefore | undefined = before && {
      identifier: before.issueIdentifier,
      url: before.issueUrl,
      stateType: await issueStateType(organizationId, before.linearIssueId).catch(() => null)
    };
    const filing = decideFiling(previous);
    const context: GuardContext = {
      issueIdentifier: workItem.issueIdentifier,
      issueUrl: workItem.issueUrl,
      prUrl: workItem.prNumber ? `https://github.com/${workItem.repository}/pull/${workItem.prNumber}` : null,
      runUrl: run.actionsRunUrl,
      previous: filing.kind === 'refile' ? filing.previous : undefined
    };
    const filed = issue(context);
    if (filing.kind === 'known') {
      log('info', `${job} already filed`, { fingerprint, issue: filing.previous.identifier, why: filing.why });
      return filing.why === 'open'
        ? { identifier: filing.previous.identifier, url: filing.previous.url, title: filed.title }
        : undefined;
    }
    const created = await fileTriageIssue(organizationId, {
      teamKey: project.linear.teamKey,
      ...filed,
      labels: GUARD_LABELS
    });
    await getDb().insert(jobFindings).values({
      project: project.name,
      job,
      fingerprint,
      linearIssueId: created.id,
      issueIdentifier: created.identifier,
      issueUrl: created.url,
      runId: run.id
    });
    log('info', `${job} filed`, { fingerprint, issue: created.identifier });
    return { identifier: created.identifier, url: created.url, title: filed.title };
  } catch (error) {
    log('error', `${job} filing failed`, { fingerprint, error: errorMessage(error) });
    return undefined;
  }
};

// One after another, so they can't race to create the same missing label.
const fileInTurn = <T>(items: T[], file: (item: T) => Promise<Tracked | undefined>): Promise<Tracked[]> =>
  items.reduce<Promise<Tracked[]>>(async (done, item) => {
    const tracked = await done;
    const next = await file(item);
    return next ? [...tracked, next] : tracked;
  }, Promise.resolve([]));

// Guards an implement run couldn't fit in its PR go to the Triage inbox.
export const fileGuards = async (project: FactoryConfig, found: RunWithWorkItem): Promise<void> => {
  const guards = found.run.agent === 'implement' && found.run.status === 'finished' ? readGuards(found.run.report) : [];
  await fileInTurn(guards, (guard) =>
    fileOnce(project, found, {
      job: GUARD_JOB,
      fingerprint: guardFingerprint(found.workItem.issueIdentifier, guard),
      issue: (context) => guardIssue(guard, context)
    })
  );
};

// What any run patched locally to get its work done goes to the Triage inbox as a fix, once per breakage across the
// project. Returns the issues tracking them, for the thread.
export const fileWorkarounds = async (project: FactoryConfig, found: RunWithWorkItem): Promise<Tracked[]> => {
  const workarounds = found.run.status === 'finished' ? readWorkarounds(found.run.report) : [];
  return fileInTurn(workarounds, (workaround) =>
    fileOnce(project, found, {
      job: WORKAROUND_JOB,
      fingerprint: workaroundFingerprint(workaround),
      issue: (context) => workaroundIssue(workaround, context)
    })
  );
};
