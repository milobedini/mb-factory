import type { AskCardState, AskContext, FactoryConfig, FiledTicket } from '@mb-factory/core';
import { askAnswerMessage, askCard, queuedThought, readAskReport } from '@mb-factory/core';
import { and, eq, isNull } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { asks, queue, runs } from '@/db/schema';

import { log } from './log';
import { repositoryOf } from './projects';
import { slackPermalink, slackUserName, updateSlackMessage } from './slack-api';

// Reading and drawing a question asked with the slash command (core `ask.ts`). The router and `asks.ts` both use these,
// so they live apart from either.

export type Ask = typeof asks.$inferSelect;

type Run = typeof runs.$inferSelect;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const findAskById = async (id: string): Promise<Ask | undefined> => {
  const [ask] = await getDb().select().from(asks).where(eq(asks.id, id)).limit(1);
  return ask;
};

export const findAskByRun = async (runId: string): Promise<Ask | undefined> => {
  const [ask] = await getDb().select().from(asks).where(eq(asks.runId, runId)).limit(1);
  return ask;
};

// The question whose card starts this thread.
export const findAskByThread = async (channel: string, threadTs: string): Promise<Ask | undefined> => {
  const [ask] = await getDb()
    .select()
    .from(asks)
    .where(and(eq(asks.slackChannelId, channel), eq(asks.slackTs, threadTs)))
    .limit(1);
  return ask;
};

export const runOf = async (ask: Ask): Promise<Run | undefined> => {
  if (!ask.runId) {
    return undefined;
  }
  const [run] = await getDb().select().from(runs).where(eq(runs.id, ask.runId)).limit(1);
  return run;
};

const openHold = async (runId: string) => {
  const [hold] = await getDb()
    .select({ reason: queue.reason, releaseAt: queue.releaseAt })
    .from(queue)
    .where(and(eq(queue.runId, runId), isNull(queue.releasedAt)))
    .limit(1);
  return hold;
};

const forLater = (ask: Ask): { identifier: string; url: string } | null =>
  ask.ticketStarted === false && ask.ticketIdentifier && ask.ticketUrl
    ? { identifier: ask.ticketIdentifier, url: ask.ticketUrl }
    : null;

const cardState = async (project: FactoryConfig, ask: Ask, run: Run | undefined, now: Date): Promise<AskCardState> => {
  if (!run) {
    return { kind: 'failed' };
  }
  switch (run.status) {
    case 'queued': {
      const hold = await openHold(run.id);
      return hold ? { kind: 'queued', text: queuedThought(hold, now, project.timeZone) } : { kind: 'waiting' };
    }
    case 'dispatched':
      return { kind: 'waiting' };
    case 'running':
      return run.startedAt ? { kind: 'running', startedAt: run.startedAt } : { kind: 'waiting' };
    case 'canceled':
      return { kind: 'canceled' };
    case 'limit_hit':
      return { kind: 'failed' };
    case 'finished':
      return run.outcome === 'done' && readAskReport(run.report)
        ? { kind: 'answered', durationMs: run.durationMs, forLater: forLater(ask) }
        : { kind: 'failed' };
  }
};

// Redraws the question's card from the database. Once a ticket from it has started, the thread and its first message
// are the work item's, and its card is drawn by `cards.ts` instead.
export const refreshAskCard = async (project: FactoryConfig, ask: Ask): Promise<void> => {
  const { slackTs } = ask;
  if (!slackTs || ask.ticketStarted) {
    return;
  }
  try {
    const state = await cardState(project, ask, await runOf(ask), new Date());
    const card = askCard({
      askerId: ask.askerSlackId,
      question: ask.question,
      state,
      emojiPrefix: project.slack?.emojiPrefix ?? 'mbf',
      timeZone: project.timeZone
    });
    await updateSlackMessage({ channel: ask.slackChannelId, ts: slackTs, ...card });
  } catch (error) {
    log('warn', 'slack ask card failed', { askId: ask.id, error: errorMessage(error) });
  }
};

// The answer as posted, or as it reads once its ticket was filed.
export const answerMessageFor = (project: FactoryConfig, ask: Ask, run: Run, filed?: FiledTicket) => {
  const report = readAskReport(run.report);
  return (
    report &&
    askAnswerMessage({
      askId: ask.id,
      askerId: ask.askerSlackId,
      report,
      repository: repositoryOf(project),
      durationMs: run.durationMs,
      costUsd: run.costUsd,
      runUrl: run.actionsRunUrl,
      timeZone: project.timeZone,
      filed
    })
  );
};

// The question and answer a ticket from the thread is filed with.
export const askContextFor = async (ask: Ask, run: Run | undefined): Promise<AskContext> => {
  const [askerName, permalink] = await Promise.all([
    slackUserName(ask.askerSlackId).catch(() => ask.askerSlackId),
    ask.slackTs ? slackPermalink(ask.slackChannelId, ask.slackTs).catch(() => null) : null
  ]);
  return {
    question: ask.question,
    answer: (run && readAskReport(run.report)?.answer) ?? 'Not answered yet.',
    askerName,
    permalink
  };
};
