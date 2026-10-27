import { z } from 'zod';

import { clock } from './home';
import { escapeSlack } from './slack';

// The app's slash command (`/tastebook` for Tastebook): what's going on, what's ready, and pausing the factory, from
// any channel. Every reply is one only the person who typed it sees.

const commandSchema = z.looseObject({
  command: z.string().min(1),
  text: z.string().default(''),
  user_id: z.string().min(1),
  channel_id: z.string().min(1),
  team_id: z.string().min(1),
  api_app_id: z.string().min(1),
  response_url: z.url({ protocol: /^https$/ }),
  trigger_id: z.string().min(1)
});

export type SlashCommand = {
  command: string;
  text: string;
  userId: string;
  channelId: string;
  teamId: string;
  appId: string;
  responseUrl: string;
  triggerId: string;
};

// Slack sends the command as a form; anything missing a field the reply needs is undefined.
export const parseSlashCommand = (form: URLSearchParams): SlashCommand | undefined => {
  const parsed = commandSchema.safeParse(Object.fromEntries(form)).data;
  return parsed
    ? {
        command: parsed.command,
        text: parsed.text.trim(),
        userId: parsed.user_id,
        channelId: parsed.channel_id,
        teamId: parsed.team_id,
        appId: parsed.api_app_id,
        responseUrl: parsed.response_url,
        triggerId: parsed.trigger_id
      }
    : undefined;
};

export const COMMAND_REQUESTS = ['status', 'ready', 'pause', 'resume', 'help'] as const;

export type CommandRequest =
  | { kind: (typeof COMMAND_REQUESTS)[number] }
  // An empty question is still an ask, so the reply can say how to ask one.
  | { kind: 'ask'; question: string }
  | { kind: 'unknown'; word: string };

// The first word says what's wanted; on its own, the command shows the status. `ask` takes the rest as a question,
// and so does any text that ends in a question mark.
export const readCommandRequest = (text: string): CommandRequest => {
  const trimmed = text.trim();
  const first = trimmed.split(/\s+/)[0] ?? '';
  // "ready?" on its own is the ready list, not a question.
  const word = first.toLowerCase().replace(/[?!.]+$/, '');
  const rest = trimmed.slice(first.length).trim();
  if (trimmed === '') {
    return { kind: 'status' };
  }
  if (word === 'ask') {
    return { kind: 'ask', question: rest };
  }
  const known = COMMAND_REQUESTS.find((request) => request === word);
  if (known && rest === '') {
    return { kind: known };
  }
  if (trimmed.endsWith('?')) {
    return { kind: 'ask', question: trimmed };
  }
  return known ? { kind: known } : { kind: 'unknown', word: first.toLowerCase() };
};

// A link that opens the app's Home tab in Slack.
export const slackHubUrl = (teamId: string, appId: string): string =>
  `slack://app?team=${encodeURIComponent(teamId)}&id=${encodeURIComponent(appId)}&tab=home`;

export const commandHelpText = (command: string, alias: string): string =>
  [
    `*${command}* shows ${escapeSlack(alias)}’s factory from any channel. Only you see the replies, apart from answers to questions.`,
    `• \`${command}\` or \`${command} status\`: what’s running and what needs you`,
    `• \`${command} ask <question>\`: an answer from the code and Linear, in a thread in the factory’s channel (\`ask\` is optional when it ends in “?”)`,
    `• \`${command} ready\`: issues ready to delegate, with a Delegate button each`,
    `• \`${command} pause\`: nothing new starts until it’s resumed; running stages finish`,
    `• \`${command} resume\`: start again, and release anything queued`,
    `• \`${command} help\`: this list`
  ].join('\n');

export const unknownRequestText = (command: string, word: string): string =>
  `I don’t know \`${escapeSlack(word)}\`. Try \`${command} help\`.`;

export const commandNotAllowedText = (alias: string): string =>
  `Only the people listed for ${escapeSlack(alias)} can use this. Ask one of them to add you.`;

export const pausedReplyText = (command: string): string =>
  `Paused. Nothing new starts until someone runs \`${command} resume\` or resumes it from the hub; running stages finish.`;

export const alreadyPausedText = (by: string, since: Date, timeZone: string): string =>
  `Already paused by ${escapeSlack(by)} since ${clock(since, timeZone)}.`;

export const RESUMED_TEXT = 'Resumed. Anything queued starts now, if usage allows.';

export const NOT_PAUSED_TEXT = 'The factory isn’t paused.';

export const LINEAR_UNREADABLE = 'I couldn’t read Linear just now. Try again in a minute.';

export const COMMAND_FAILED = 'Something went wrong there. The details are in the console log.';
