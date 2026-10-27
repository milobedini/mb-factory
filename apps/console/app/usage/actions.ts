'use server';

import { refresh } from 'next/cache';
import { after } from 'next/server';

import { startGovernorProbe } from '@/lib/github-api';
import { disconnect } from '@/lib/github-connect';
import { log } from '@/lib/log';
import { pauseFactory, resumeFactory } from '@/lib/pause';
import { allowRunOnce, releaseQueue } from '@/lib/router';
import { requireConsoleUser } from '@/lib/session';

export const pauseAction = async (): Promise<void> => {
  const { login } = await requireConsoleUser();
  await pauseFactory(login);
  log('info', 'factory paused', { login });
  refresh();
};

export const resumeAction = async (): Promise<void> => {
  const { login } = await requireConsoleUser();
  if (await resumeFactory(login)) {
    log('info', 'factory resumed', { login });
    after(releaseQueue);
  }
  refresh();
};

export const allowAction = async (formData: FormData): Promise<void> => {
  const { login } = await requireConsoleUser();
  const runId = formData.get('runId');
  if (typeof runId === 'string') {
    await allowRunOnce(runId, login);
  }
  refresh();
};

export type RefreshState = { message: string } | null;

export const refreshAction = async (): Promise<RefreshState> => {
  const { login } = await requireConsoleUser();
  try {
    await startGovernorProbe();
    log('info', 'usage probe requested', { login });
    return { message: 'Probe started. Fresh readings arrive in about a minute; reload then.' };
  } catch (error) {
    log('error', 'usage probe request failed', { error: error instanceof Error ? error.message : String(error) });
    return { message: 'Couldn’t start the probe. The details are in the console log.' };
  }
};

export const disconnectGitHubAction = async (): Promise<void> => {
  const { id, login } = await requireConsoleUser();
  await disconnect(id);
  log('info', 'github disconnected', { login });
  refresh();
};
