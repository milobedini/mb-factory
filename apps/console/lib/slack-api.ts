import type { SlackBlock, SlackMessage } from '@mb-factory/core';

import { requireEnv } from './env';

type SlackResponse = { ok: boolean; ts?: string; error?: string };

const callSlack = async (method: string, body: Record<string, unknown>): Promise<SlackResponse> => {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${requireEnv('SLACK_BOT_TOKEN')}`
    },
    body: JSON.stringify(body)
  });
  const result = (await response.json()) as SlackResponse;
  if (!result.ok) {
    throw new Error(`Slack ${method} failed: ${result.error ?? response.status}`);
  }
  return result;
};

// Returns the message's `ts`, which is also the thread's ID when the message starts one. `text` is the notification
// and fallback when there are blocks.
export const postSlackMessage = async ({
  channel,
  text,
  threadTs,
  blocks
}: {
  channel: string;
  text: string;
  threadTs?: string | null;
  blocks?: SlackBlock[];
}): Promise<string> => {
  const { ts } = await callSlack('chat.postMessage', {
    channel,
    text,
    blocks,
    thread_ts: threadTs ?? undefined,
    unfurl_links: false
  });
  if (!ts) {
    throw new Error('Slack chat.postMessage returned no ts');
  }
  return ts;
};

// Edits one of the app's own messages in place. Attachments are left as they were unless given.
export const updateSlackMessage = async ({
  channel,
  ts,
  text,
  blocks,
  attachments
}: SlackMessage & {
  channel: string;
  ts: string;
  attachments?: { color: string; blocks: SlackBlock[] }[];
}): Promise<void> => {
  await callSlack('chat.update', { channel, ts, text, blocks, attachments });
};

// Publishes a person's view of the app's Home tab.
export const publishHomeView = async (userId: string, view: { type: 'home'; blocks: SlackBlock[] }): Promise<void> => {
  await callSlack('views.publish', { user_id: userId, view });
};

// A message only one person sees, such as why their reply wasn't taken.
export const postSlackEphemeral = async ({
  channel,
  user,
  text,
  threadTs
}: {
  channel: string;
  user: string;
  text: string;
  threadTs?: string | null;
}): Promise<void> => {
  await callSlack('chat.postEphemeral', { channel, user, text, thread_ts: threadTs ?? undefined });
};

// Answers a slash command or a button tap privately, through its response URL: a new message only that person sees, or,
// with `replaceOriginal`, the message they tapped redrawn (the only way to edit an ephemeral one).
export const respondToSlack = async (
  responseUrl: string,
  { text, blocks }: { text: string; blocks?: SlackBlock[] },
  replaceOriginal = false
): Promise<void> => {
  const response = await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ response_type: 'ephemeral', replace_original: replaceOriginal, text, blocks })
  });
  if (!response.ok) {
    throw new Error(`Slack response URL failed with ${response.status}`);
  }
};

export const respondToSlackAction = (responseUrl: string, text: string): Promise<void> =>
  respondToSlack(responseUrl, { text });

type UserInfo = SlackResponse & {
  user?: {
    name?: string;
    real_name?: string;
    profile?: { display_name?: string; real_name?: string; email?: string };
  };
};

// The name people know someone by, for the Linear session and the thread, and their email (`users:read.email`).
export const slackUser = async (userId: string): Promise<{ name: string; email: string | null }> => {
  const response = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${requireEnv('SLACK_BOT_TOKEN')}` }
  });
  const { user } = (await response.json()) as UserInfo;
  return {
    name: user?.profile?.display_name || user?.profile?.real_name || user?.real_name || user?.name || userId,
    email: user?.profile?.email || null
  };
};

export const slackUserName = async (userId: string): Promise<string> => (await slackUser(userId)).name;

// A link to one message, for the Linear issue it became.
export const slackPermalink = async (channel: string, ts: string): Promise<string> => {
  const query = new URLSearchParams({ channel, message_ts: ts });
  const response = await fetch(`https://slack.com/api/chat.getPermalink?${query}`, {
    headers: { Authorization: `Bearer ${requireEnv('SLACK_BOT_TOKEN')}` }
  });
  const { ok, permalink, error } = (await response.json()) as SlackResponse & { permalink?: string };
  if (!ok || !permalink) {
    throw new Error(`Slack chat.getPermalink failed: ${error ?? response.status}`);
  }
  return permalink;
};

// The workspace's address, which doesn't change while an instance runs.
const workspaceUrls = new Map<string, Promise<string>>();

const fetchWorkspaceUrl = async (): Promise<string> => {
  const { url } = (await callSlack('auth.test', {})) as SlackResponse & { url?: string };
  if (!url) {
    throw new Error('Slack auth.test returned no url');
  }
  return url;
};

export const slackWorkspaceUrl = (): Promise<string> => {
  const known = workspaceUrls.get('bot');
  if (known !== undefined) {
    return known;
  }
  const fetching = fetchWorkspaceUrl();
  workspaceUrls.set('bot', fetching);
  // A failed lookup is tried again next time rather than remembered.
  fetching.catch(() => workspaceUrls.delete('bot'));
  return fetching;
};
