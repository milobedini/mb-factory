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

// Answers a button tap through its response URL: replacing the tapped message, or privately to whoever tapped.
export const respondToSlackAction = async (
  responseUrl: string,
  message: SlackMessage | { text: string },
  mode: 'replace' | 'ephemeral'
): Promise<void> => {
  const response = await fetch(responseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(
      mode === 'replace'
        ? { replace_original: true, ...message }
        : { response_type: 'ephemeral', replace_original: false, ...message }
    )
  });
  if (!response.ok) {
    throw new Error(`Slack response URL failed with ${response.status}`);
  }
};

type UserInfo = SlackResponse & {
  user?: { name?: string; real_name?: string; profile?: { display_name?: string; real_name?: string } };
};

// The name people know someone by, for the Linear session and the thread.
export const slackUserName = async (userId: string): Promise<string> => {
  const response = await fetch(`https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${requireEnv('SLACK_BOT_TOKEN')}` }
  });
  const { user } = (await response.json()) as UserInfo;
  return user?.profile?.display_name || user?.profile?.real_name || user?.real_name || user?.name || userId;
};
