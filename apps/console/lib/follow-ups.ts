import type { ChosenFollowUp, FactoryConfig } from '@mb-factory/core';
import { followUpIssue, GUARD_LABELS } from '@mb-factory/core';

import type { workItems } from '@/db/schema';

import { requireEnv } from './env';
import type { CreatedIssue } from './linear-api';
import { fileTriageIssue } from './linear-api';
import { log } from './log';

type WorkItem = typeof workItems.$inferSelect;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// The issues a review round's answers deferred work to, filed in Triage one after another (so they can't race to create
// a missing label). A failure is logged and skipped: the decision itself is already recorded.
export const fileFollowUps = async (
  project: FactoryConfig,
  workItem: WorkItem,
  followUps: ChosenFollowUp[]
): Promise<CreatedIssue[]> => {
  const context = {
    issueIdentifier: workItem.issueIdentifier,
    issueUrl: workItem.issueUrl,
    prUrl: workItem.prNumber ? `https://github.com/${workItem.repository}/pull/${workItem.prNumber}` : null,
    round: workItem.reviewRounds
  };
  return followUps.reduce<Promise<CreatedIssue[]>>(async (done, followUp) => {
    const filed = await done;
    try {
      const created = await fileTriageIssue(requireEnv('LINEAR_ALLOWED_ORGANIZATION_ID'), {
        teamKey: project.linear.teamKey,
        ...followUpIssue(followUp, context),
        labels: GUARD_LABELS
      });
      log('info', 'follow-up filed', { issue: workItem.issueIdentifier, filed: created.identifier });
      return [...filed, created];
    } catch (error) {
      log('error', 'follow-up filing failed', { issue: workItem.issueIdentifier, error: errorMessage(error) });
      return filed;
    }
  }, Promise.resolve([]));
};
