import { AsyncLocalStorage } from 'node:async_hooks';
import { after } from 'next/server';

import { refreshCard } from './cards';
import { republishHome } from './home';

// A webhook or a tap can change a work item many times; the work items it touched are collected, and once it finishes
// each card is redrawn once, then the Home tabs of their projects, since Slack only says when someone opens the tab,
// not that it's still open.

const touched = new AsyncLocalStorage<Set<string>>();

const redraw = async (workItemIds: string[]): Promise<void> => {
  const projects = await Promise.all(workItemIds.map(refreshCard));
  const unique = [...new Set(projects.filter((name) => name !== undefined))];
  await Promise.all(unique.map(republishHome));
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
  after(() => redraw([workItemId]));
};

// Runs a handler that may change work items, then redraws what it touched. A handler called from inside another
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
      if (scope.size > 0) {
        await redraw([...scope]);
      }
    }
  };
