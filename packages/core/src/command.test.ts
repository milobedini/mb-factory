import { describe, expect, it } from 'vitest';

import {
  alreadyPausedText,
  commandHelpText,
  parseSlashCommand,
  readCommandRequest,
  slackHubUrl,
  unknownRequestText
} from './command';

const form = (overrides: Record<string, string> = {}): URLSearchParams =>
  new URLSearchParams({
    token: 'deprecated',
    team_id: 'T0CBS3FN7',
    channel_id: 'C0CBSE2Q6FQ',
    user_id: 'U0CBS3FN806',
    command: '/tastebook',
    text: '  ready ',
    api_app_id: 'A0CBS7X9Q',
    response_url: 'https://hooks.slack.com/commands/T0CBS3FN7/1/x',
    trigger_id: '1.2.abc',
    ...overrides
  });

describe('parseSlashCommand', () => {
  it('reads what the reply needs, with the text trimmed', () => {
    expect(parseSlashCommand(form())).toEqual({
      command: '/tastebook',
      text: 'ready',
      userId: 'U0CBS3FN806',
      channelId: 'C0CBSE2Q6FQ',
      teamId: 'T0CBS3FN7',
      appId: 'A0CBS7X9Q',
      responseUrl: 'https://hooks.slack.com/commands/T0CBS3FN7/1/x',
      triggerId: '1.2.abc'
    });
  });

  it('takes a command typed on its own, which Slack may send without text', () => {
    const bare = form();
    bare.delete('text');
    expect(parseSlashCommand(bare)?.text).toBe('');
  });

  it('turns down a request without a user or an https response URL', () => {
    expect(parseSlashCommand(form({ user_id: '' }))).toBeUndefined();
    expect(parseSlashCommand(form({ response_url: 'http://hooks.slack.com/commands/x' }))).toBeUndefined();
  });
});

describe('readCommandRequest', () => {
  it('shows the status when nothing follows the command', () => {
    expect(readCommandRequest('')).toEqual({ kind: 'status' });
  });

  it('reads the first word, in any case, and ignores the rest', () => {
    expect(readCommandRequest('Ready')).toEqual({ kind: 'ready' });
    expect(readCommandRequest('pause  deploying the API')).toEqual({ kind: 'pause' });
    expect(readCommandRequest('resume')).toEqual({ kind: 'resume' });
    expect(readCommandRequest('help')).toEqual({ kind: 'help' });
  });

  it('says what it didn’t recognise', () => {
    expect(readCommandRequest('merge TAS-38')).toEqual({ kind: 'unknown', word: 'merge' });
    expect(unknownRequestText('/tastebook', 'me<rge')).toBe('I don’t know `me&lt;rge`. Try `/tastebook help`.');
  });
});

describe('commandHelpText', () => {
  it('lists every request under the command as typed', () => {
    const help = commandHelpText('/tastebook', 'Tastebook');
    expect(help).toMatch(/^\*\/tastebook\* shows Tastebook’s factory/);
    expect(help.match(/^• `\/tastebook/gm)).toHaveLength(5);
  });
});

describe('slackHubUrl', () => {
  it('opens the app’s Home tab', () => {
    expect(slackHubUrl('T0CBS3FN7', 'A0CBS7X9Q')).toBe('slack://app?team=T0CBS3FN7&id=A0CBS7X9Q&tab=home');
  });
});

describe('alreadyPausedText', () => {
  it('says who paused it and when, in the project’s time zone', () => {
    expect(alreadyPausedText('Milo in Slack', new Date(Date.UTC(2026, 6, 1, 9, 5)), 'Europe/London')).toBe(
      'Already paused by Milo in Slack since 10:05.'
    );
  });
});
