import type { ChosenFollowUp, FactoryConfig, FindingIssue } from '@mb-factory/core';
import { followUpIssue, GUARD_LABELS, readRequestedIssues, requestedIssue } from '@mb-factory/core';

import type { workItems } from '@/db/schema';

import { requireEnv } from './env';
import type { CreatedIssue } from './linear-api';
import { fileTriageIssue } from './linear-api';
import { log } from './log';
import type { RunWithWorkItem } from './runs';

type WorkItem = typeof workItems.$inferSelect;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const prUrlOf = (workItem: WorkItem): string | null =>
  workItem.prNumber ? `https://github.com/${workItem.repository}/pull/${workItem.prNumber}` : null;

// Filed in Triage one after another (so they can't race to create a missing label). A failure is logged and skipped:
// the decision itself is already recorded.
const fileInTriage = async (
  project: FactoryConfig,
  workItem: WorkItem,
  issues: FindingIssue[]
): Promise<CreatedIssue[]> =>
  issues.reduce<Promise<CreatedIssue[]>>(async (done, issue) => {
    const filed = await done;
    try {
      const created = await fileTriageIssue(requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID'), {
        teamKey: project.linear.teamKey,
        ...issue,
        labels: GUARD_LABELS
      });
      log('info', 'follow-up filed', { issue: workItem.issueIdentifier, filed: created.identifier });
      return [...filed, created];
    } catch (error) {
      log('error', 'follow-up filing failed', { issue: workItem.issueIdentifier, error: errorMessage(error) });
      return filed;
    }
  }, Promise.resolve([]));

// The issues a review round's answers deferred work to.
export const fileFollowUps = async (
  project: FactoryConfig,
  workItem: WorkItem,
  followUps: ChosenFollowUp[]
): Promise<CreatedIssue[]> => {
  const context = {
    issueIdentifier: workItem.issueIdentifier,
    issueUrl: workItem.issueUrl,
    prUrl: prUrlOf(workItem),
    round: workItem.reviewRounds
  };
  return fileInTriage(
    project,
    workItem,
    followUps.map((followUp) => followUpIssue(followUp, context))
  );
};

// The issues a person's reply asked a stage run to file, whatever the stage.
export const fileRequestedIssues = async (
  project: FactoryConfig,
  { run, workItem }: RunWithWorkItem
): Promise<CreatedIssue[]> => {
  const requested = run.status === 'finished' ? readRequestedIssues(run) : [];
  const context = {
    issueIdentifier: workItem.issueIdentifier,
    issueUrl: workItem.issueUrl,
    prUrl: prUrlOf(workItem),
    runUrl: run.actionsRunUrl,
    request: run.prompt
  };
  return fileInTriage(
    project,
    workItem,
    requested.map((issue) => requestedIssue(issue, context))
  );
};
