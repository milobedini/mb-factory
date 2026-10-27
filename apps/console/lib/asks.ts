import type { FactoryConfig, SlashCommand } from '@mb-factory/core';
import {
  askAckText,
  askCard,
  askFailedText,
  emptyQuestionText,
  MAX_QUESTION,
  modelFor,
  readAskReport
} from '@mb-factory/core';
import { eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { asks, runs } from '@/db/schema';

import { answerMessageFor, findAskByRun, refreshAskCard, runOf } from './ask-runs';
import { log } from './log';
import { currentPause } from './pause';
import { findProject } from './projects';
import { dispatchRun, releaseQueue } from './router';
import { postSlackMessage, slackPermalink } from './slack-api';

// A question asked with the slash command: its card goes in the project's channel, a read-only `ask` run looks into
// it, and the answer goes in the card's thread.

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const clip = (text: string, limit: number): string => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

// Posts the question and starts its run; the reply, which only the asker sees, links to the thread.
export const startAsk = async (
  project: FactoryConfig,
  command: SlashCommand,
  typed: string
): Promise<{ text: string }> => {
  const channel = project.slack?.channelId;
  if (!typed) {
    return { text: emptyQuestionText(command.command) };
  }
  if (!channel) {
    return { text: `${project.alias} has no Slack channel to answer in.` };
  }
  const question = clip(typed, MAX_QUESTION);
  const db = getDb();
  const [ask] = await db
    .insert(asks)
    .values({ project: project.name, askerSlackId: command.userId, question, slackChannelId: channel })
    .returning();
  if (!ask) {
    throw new Error('Inserting the question returned no row');
  }
  const ts = await postSlackMessage({
    channel,
    ...askCard({
      askerId: command.userId,
      question,
      state: { kind: 'waiting' },
      emojiPrefix: project.slack?.emojiPrefix ?? 'mbf',
      timeZone: project.timeZone
    })
  });
  const [run] = await db
    .insert(runs)
    .values({
      project: project.name,
      agent: 'ask',
      model: modelFor(project, 'ask', false),
      trigger: 'asked',
      // Someone is waiting on the answer, so a throttle doesn't hold it.
      priority: 'in_flight',
      prompt: question,
      status: 'queued'
    })
    .returning({ id: runs.id });
  if (!run) {
    throw new Error('Inserting the run returned no row');
  }
  await db.update(asks).set({ slackTs: ts, runId: run.id }).where(eq(asks.id, ask.id));
  log('info', 'question asked', { project: project.name, askId: ask.id, runId: run.id, user: command.userId });
  const [permalink, pause] = await Promise.all([
    slackPermalink(channel, ts).catch((error: unknown) => {
      log('warn', 'slack permalink failed', { channel, ts, error: errorMessage(error) });
      return null;
    }),
    currentPause()
  ]);
  await dispatchRun(project, run.id);
  return { text: askAckText(permalink, channel, pause !== undefined) };
};

// After a question's run reports: the answer, or why there isn't one, in the card's thread; then the card again.
export const handleAskRunFinished = async (runId: string): Promise<void> => {
  const ask = await findAskByRun(runId);
  const project = ask && findProject(ask.project);
  const run = ask && (await runOf(ask));
  if (!ask || !project || !run) {
    return;
  }
  const answer = run.outcome === 'done' ? answerMessageFor(project, ask, run) : undefined;
  const summary =
    run.status === 'limit_hit' ? 'it hit the usage limit.' : readAskReport(run.report) ? null : run.summary;
  try {
    const ts = await postSlackMessage({
      channel: ask.slackChannelId,
      threadTs: ask.slackTs,
      ...(answer ?? { text: askFailedText(ask.askerSlackId, summary, run.actionsRunUrl) })
    });
    if (answer) {
      await getDb().update(asks).set({ answerSlackTs: ts }).where(eq(asks.id, ask.id));
    }
  } catch (error) {
    log('error', 'slack answer failed', { askId: ask.id, error: errorMessage(error) });
  }
  log('info', 'question answered', { askId: ask.id, runId, answered: answer !== undefined });
  await refreshAskCard(project, ask);
  await releaseQueue();
};
