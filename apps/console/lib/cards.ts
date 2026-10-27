import type { CardInput, FactoryConfig } from '@mb-factory/core';
import { canRerun, readGate, readNextIssues, slackMessageUrl, workItemCard } from '@mb-factory/core';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { questions, queue, runs, workItems } from '@/db/schema';

import { log } from './log';
import { findProject } from './projects';
import { slackWorkspaceUrl, updateSlackMessage } from './slack-api';

// Each work item's thread starts with a card (core `workItemCard`), redrawn from the database whenever the work item or
// its runs change (`touchCard` in `redraw.ts`).

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

type WorkItem = typeof workItems.$inferSelect;

// Everything a work item's card is drawn from. `channel` is where its thread is, for the questions' link.
export const loadCardInput = async (
  workItem: WorkItem,
  project: FactoryConfig,
  channel: string
): Promise<CardInput> => {
  const db = getDb();
  const itemRuns = await db.select().from(runs).where(eq(runs.workItemId, workItem.id)).orderBy(asc(runs.createdAt));
  const latest = itemRuns.at(-1);
  const asked =
    itemRuns.length === 0
      ? []
      : await db
          .select()
          .from(questions)
          .where(
            inArray(
              questions.runId,
              itemRuns.map(({ id }) => id)
            )
          );
  // The latest round is the latest run's that asked anything, as on the Inbox.
  const askingRun = itemRuns.findLast(({ id }) => asked.some(({ runId }) => runId === id));
  const round = askingRun ? asked.filter(({ runId }) => runId === askingRun.id) : [];
  const [hold] =
    latest?.status === 'queued'
      ? await db
          .select({ reason: queue.reason, releaseAt: queue.releaseAt })
          .from(queue)
          .where(and(eq(queue.runId, latest.id), isNull(queue.releasedAt)))
          .limit(1)
      : [];
  // A gate a stage reported waits while its message does; the spec gate is the stage itself.
  const gateRun = itemRuns.findLast(({ status, outcome }) => status === 'finished' && outcome === 'needs_input');
  const gate = workItem.gateSlackTs && workItem.stage !== 'spec_review' ? readGate(gateRun?.report) : undefined;
  const questionsTs = round.find(({ answeredAt, closedAt }) => answeredAt === null && closedAt === null)?.slackTs;
  const questionsUrl = questionsTs ? slackMessageUrl(await slackWorkspaceUrl(), channel, questionsTs) : null;
  return {
    workItem: {
      id: workItem.id,
      identifier: workItem.issueIdentifier,
      url: workItem.issueUrl,
      title: workItem.title,
      stage: workItem.stage,
      repository: workItem.repository,
      branch: workItem.branch,
      prNumber: workItem.prNumber,
      estimate: workItem.estimate,
      reviewRounds: workItem.reviewRounds,
      updatedAt: workItem.updatedAt,
      project: workItem.projectName ? { name: workItem.projectName, url: workItem.projectUrl } : null,
      milestone: workItem.milestoneName
    },
    runs: itemRuns,
    round,
    hold: hold ?? null,
    gate,
    rerunnable: latest
      ? canRerun(latest, {
          stage: workItem.stage,
          hasPr: workItem.prNumber !== null,
          reviewRounds: workItem.reviewRounds,
          maxReviewRounds: project.review.maxRounds
        })
      : false,
    questionsUrl,
    next: readNextIssues(workItem.nextReady),
    now: new Date(),
    timeZone: project.timeZone,
    emojiPrefix: project.slack?.emojiPrefix ?? 'mbf'
  };
};

// Redraws the work item's card, and returns its project, whose Home tabs show it too. Never throws: a stale card
// mustn't stop the work.
export const refreshCard = async (workItemId: string): Promise<string | undefined> => {
  try {
    const [workItem] = await getDb().select().from(workItems).where(eq(workItems.id, workItemId)).limit(1);
    const project = workItem && findProject(workItem.project);
    const channel = workItem?.slackChannelId ?? project?.slack?.channelId;
    if (!workItem || !project || !channel || !workItem.slackThreadTs) {
      return project?.name;
    }
    const card = workItemCard(await loadCardInput(workItem, project, channel));
    await updateSlackMessage({ channel, ts: workItem.slackThreadTs, ...card });
    return project.name;
  } catch (error) {
    log('warn', 'slack card failed', { workItemId, error: errorMessage(error) });
    return undefined;
  }
};
