import { AsyncLocalStorage } from 'node:async_hooks';
import { canRerun, readGate, readNextIssues, slackMessageUrl, workItemCard } from '@mb-factory/core';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { after } from 'next/server';

import { getDb } from '@/db/client';
import { questions, queue, runs, workItems } from '@/db/schema';

import { log } from './log';
import { findProject } from './projects';
import { slackWorkspaceUrl, updateSlackMessage } from './slack-api';

// Each work item's thread starts with a card (core `workItemCard`), redrawn from the database whenever the work item or
// its runs change. A webhook or a tap can change a work item many times; the work items it touched are collected and
// each card is redrawn once, after the last change.

const touched = new AsyncLocalStorage<Set<string>>();

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// Redraws the work item's card. Never throws: a stale card mustn't stop the work.
export const refreshCard = async (workItemId: string): Promise<void> => {
  try {
    const db = getDb();
    const [workItem] = await db.select().from(workItems).where(eq(workItems.id, workItemId)).limit(1);
    const project = workItem && findProject(workItem.project);
    const channel = workItem?.slackChannelId ?? project?.slack?.channelId;
    if (!workItem || !project || !channel || !workItem.slackThreadTs) {
      return;
    }
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
    const card = workItemCard({
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
      timeZone: project.timeZone
    });
    await updateSlackMessage({ channel, ts: workItem.slackThreadTs, ...card });
  } catch (error) {
    log('warn', 'slack card failed', { workItemId, error: errorMessage(error) });
  }
};

// Marks a work item's card for redrawing once the handler that changed it finishes; outside one, after the response.
export const touchCard = (workItemId: string | null | undefined): void => {
  if (!workItemId) {
    return;
  }
  const scope = touched.getStore();
  if (scope) {
    scope.add(workItemId);
    return;
  }
  after(() => refreshCard(workItemId));
};

// Runs a handler that may change work items, then redraws the cards it touched. A handler called from inside another
// leaves the redrawing to the outer one.
export const withCards =
  <A extends unknown[], R>(handler: (...args: A) => Promise<R>) =>
  async (...args: A): Promise<R> => {
    if (touched.getStore()) {
      return handler(...args);
    }
    const scope = new Set<string>();
    try {
      return await touched.run(scope, () => handler(...args));
    } finally {
      await Promise.all([...scope].map(refreshCard));
    }
  };
