'use server';

import { refresh } from 'next/cache';

import { cancelRunFromConsole, rerunFromConsole } from '@/lib/router';
import { requireConsoleUser } from '@/lib/session';

const runIdFrom = (formData: FormData): string | undefined => {
  const runId = formData.get('runId');
  return typeof runId === 'string' ? runId : undefined;
};

export const cancelRunAction = async (formData: FormData): Promise<void> => {
  const { login } = await requireConsoleUser();
  const runId = runIdFrom(formData);
  if (runId) {
    await cancelRunFromConsole(runId, login);
  }
  refresh();
};

export const rerunAction = async (formData: FormData): Promise<void> => {
  const { login } = await requireConsoleUser();
  const runId = runIdFrom(formData);
  if (runId) {
    await rerunFromConsole(runId, login);
  }
  refresh();
};
