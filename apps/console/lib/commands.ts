import type { CommandRequest, FactoryConfig, SlackMessage, SlashCommand } from '@mb-factory/core';
import {
  alreadyPausedText,
  COMMAND_FAILED,
  commandHelpText,
  commandNotAllowedText,
  isAllowedSlackUser,
  LINEAR_UNREADABLE,
  NOT_PAUSED_TEXT,
  nothingReadyText,
  pausedReplyText,
  READY_HEADING,
  RESUMED_TEXT,
  readCommandRequest,
  slackHubUrl,
  slackStatusMessage,
  unknownRequestText
} from '@mb-factory/core';

import { requireEnv } from './env';
import { loadHomeInput } from './home';
import { log } from './log';
import { currentPause } from './pause';
import { allProjects } from './projects';
import { loadReadyList, readyMessage } from './ready';
import { pauseFromSlack, resumeFromSlack } from './router';
import { respondToSlack } from './slack-api';

// The app's slash command (core `readCommandRequest`). It answers after the request, through its response URL, in a
// reply only the person who typed it sees.

type Reply = { text: string; blocks?: SlackMessage['blocks'] };

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const answer = async (project: FactoryConfig, request: CommandRequest, command: SlashCommand): Promise<Reply> => {
  const now = new Date();
  switch (request.kind) {
    case 'status':
      return slackStatusMessage(await loadHomeInput(project, now), slackHubUrl(command.teamId, command.appId));
    case 'ready': {
      const list = await loadReadyList(project).catch((error: unknown) => {
        log('warn', 'ready list failed', { project: project.name, error: errorMessage(error) });
        return undefined;
      });
      if (!list) {
        return { text: LINEAR_UNREADABLE };
      }
      return list.ready.length > 0
        ? readyMessage(project, READY_HEADING, list.ready)
        : { text: nothingReadyText(requireEnv('CONSOLE_URL')) };
    }
    case 'pause': {
      const pause = await currentPause();
      if (pause) {
        return { text: alreadyPausedText(pause.pausedBy, pause.pausedAt, project.timeZone) };
      }
      await pauseFromSlack(command.userId);
      return { text: pausedReplyText(command.command) };
    }
    case 'resume':
      return { text: (await resumeFromSlack(command.userId)) ? RESUMED_TEXT : NOT_PAUSED_TEXT };
    case 'help':
      return { text: commandHelpText(command.command, project.alias) };
    case 'unknown':
      return { text: unknownRequestText(command.command, request.word) };
  }
};

// The project a person's command is about: the first that lists them, as for the Home tab.
export const handleSlashCommand = async (command: SlashCommand): Promise<void> => {
  const withSlack = allProjects().filter((project) => project.slack);
  const project = withSlack.find((candidate) => isAllowedSlackUser(candidate, command.userId));
  const request = readCommandRequest(command.text);
  log('info', 'slack command', { user: command.userId, request: request.kind, project: project?.name });
  try {
    const reply = project
      ? await answer(project, request, command)
      : { text: commandNotAllowedText(withSlack[0]?.alias ?? 'this factory') };
    await respondToSlack(command.responseUrl, reply);
  } catch (error) {
    log('error', 'slack command failed', { user: command.userId, request: request.kind, error: errorMessage(error) });
    await respondToSlack(command.responseUrl, { text: COMMAND_FAILED }).catch(() => undefined);
  }
};
