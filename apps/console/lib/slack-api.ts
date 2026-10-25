import { requireEnv } from './env';

type PostMessageResponse = { ok: boolean; ts?: string; error?: string };

// Returns the message's `ts`, which is also the thread's ID when the message starts one.
export const postSlackMessage = async ({
  channel,
  text,
  threadTs
}: {
  channel: string;
  text: string;
  threadTs?: string | null;
}): Promise<string> => {
  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${requireEnv('SLACK_BOT_TOKEN')}`
    },
    body: JSON.stringify({ channel, text, thread_ts: threadTs ?? undefined, unfurl_links: false })
  });
  const body = (await response.json()) as PostMessageResponse;
  if (!body.ok || !body.ts) {
    throw new Error(`Slack chat.postMessage failed: ${body.error ?? response.status}`);
  }
  return body.ts;
};
