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

// Edits one of the app's own messages in place.
export const updateSlackMessage = async ({
  channel,
  ts,
  text,
  blocks
}: SlackMessage & { channel: string; ts: string }): Promise<void> => {
  await callSlack('chat.update', { channel, ts, text, blocks });
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

// Answers a button tap privately, to whoever tapped, through its response URL.
export const respondToSlackAction = async (responseUrl: string, text: string): Promise<void> => {
  const response = await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ response_type: 'ephemeral', replace_original: false, text })
  });
  if (!response.ok) {
    throw new Error(`Slack response URL failed with ${response.status}`);
  }
};

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
