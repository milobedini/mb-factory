import type { CardInput, ChecksSummary, FactoryConfig } from '@mb-factory/core';
import {
  canRerun,
  checksAllowMerge,
  latestCanvas,
  mergeHeldLine,
  personFor,
  personName,
  readBeforeMerging,
  readFixableFindings,
  readGate,
  readNextIssues,
  slackMergeGated,
  slackMessageUrl,
  workItemCard
} from '@mb-factory/core';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { questions, queue, runs, workItems } from '@/db/schema';

import { headChecks, pullHead } from './github-api';
import { log } from './log';
import { findProject } from './projects';
import { slackThreadMessage, slackWorkspaceUrl, updateSlackMessage } from './slack-api';

// Each work item's thread starts with a card (core `workItemCard`), redrawn from the database whenever the work item or
// its runs change (`touchCard` in `redraw.ts`).

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

type WorkItem = typeof workItems.$inferSelect;

// The checks on the PR's head while it waits at the merge gate; null when GitHub couldn't be read, so the card keeps
// Approve and merge and the tap checks again.
const gateChecks = async (workItem: WorkItem): Promise<ChecksSummary | null | undefined> => {
  if (workItem.stage !== 'awaiting_merge' || !workItem.prNumber) {
    return undefined;
  }
  try {
    const { head } = await pullHead(workItem.repository, workItem.prNumber);
    return await headChecks(workItem.repository, head);
  } catch (error) {
    log('warn', 'card checks failed', { issue: workItem.issueIdentifier, error: errorMessage(error) });
    return null;
  }
};

const assigneeName = (project: FactoryConfig, email: string | null): string | null => {
  const person = personFor(project, email);
  return person ? personName(person) : null;
};

// Everything a work item's card is drawn from. `channel` is where its thread is, for the questions' link.
export const loadCardInput = async (
  workItem: WorkItem,
  project: FactoryConfig,
  channel: string
): Promise<CardInput> => {
  const db = getDb();
  const [itemRuns, checks] = await Promise.all([
    db.select().from(runs).where(eq(runs.workItemId, workItem.id)).orderBy(asc(runs.createdAt)),
    gateChecks(workItem)
  ]);
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
  const review = itemRuns.findLast(({ agent, status }) => agent === 'review' && status === 'finished');
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
      milestone: workItem.milestoneName,
      assignee: assigneeName(project, workItem.assigneeEmail),
      undelegated: workItem.undelegatedAt !== null
    },
    runs: itemRuns,
    canvas: latestCanvas(
      itemRuns
        .filter(({ agent, status }) => agent === 'design' && status === 'finished')
        .map(({ report }) => report)
        .reverse()
    ),
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
    beforeMerging: workItem.stage === 'awaiting_merge' ? readBeforeMerging(review?.report) : undefined,
    checks,
    mergeEffect: project.mergeEffect,
    next: readNextIssues(workItem.nextReady),
    now: new Date(),
    timeZone: project.timeZone,
    emojiPrefix: project.slack?.emojiPrefix ?? 'mbf'
  };
};

// Review's message carrying Approve and merge in the thread follows the card: the button is held there too while the
// checks run or fail, and comes back once they pass. Slack is read each time but written only when that changes.
const gateMergeMessage = async (workItem: WorkItem, input: CardInput, channel: string): Promise<void> => {
  const { mergeSlackTs: ts, slackThreadTs: threadTs, prNumber, stage } = workItem;
  if (stage !== 'awaiting_merge' || !ts || !threadTs || !prNumber || input.checks === undefined) {
    return;
  }
  try {
    const message = await slackThreadMessage(channel, threadTs, ts);
    if (!message) {
      return;
    }
    // Findings left beside the button are the latest review's, as when the message was posted.
    const [review] = await getDb()
      .select({ report: runs.report })
      .from(runs)
      .where(and(eq(runs.workItemId, workItem.id), eq(runs.agent, 'review'), eq(runs.status, 'finished')))
      .orderBy(desc(runs.createdAt))
      .limit(1);
    const findingsLeft = readFixableFindings(review?.report).length;
    const blocks = slackMergeGated(message.blocks, {
      workItemId: workItem.id,
      prNumber,
      notes: {
        beforeMerging: input.beforeMerging,
        mergeEffect: input.mergeEffect,
        findingsLeft: findingsLeft > 0 ? findingsLeft : undefined
      },
      held: input.checks && !checksAllowMerge(input.checks) ? mergeHeldLine(prNumber, input.checks.state) : undefined
    });
    if (blocks) {
      await updateSlackMessage({ channel, ts, text: message.text, blocks });
      log('info', 'merge message gated', { issue: workItem.issueIdentifier, held: !checksAllowMerge(input.checks) });
    }
  } catch (error) {
    log('warn', 'merge message gate failed', { issue: workItem.issueIdentifier, error: errorMessage(error) });
  }
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
    const input = await loadCardInput(workItem, project, channel);
    await Promise.all([
      updateSlackMessage({ channel, ts: workItem.slackThreadTs, ...workItemCard(input) }),
      gateMergeMessage(workItem, input, channel)
    ]);
    return project.name;
  } catch (error) {
    log('warn', 'slack card failed', { workItemId, error: errorMessage(error) });
    return undefined;
  }
};
