import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseFactoryConfig } from './config';

const tastebookConfig = readFileSync(
  fileURLToPath(new URL('../../../projects/tastebook/factory.yaml', import.meta.url)),
  'utf8'
);

describe('parseFactoryConfig', () => {
  it('parses the Tastebook factory definition', () => {
    const config = parseFactoryConfig(tastebookConfig);
    expect(config.alias).toBe('Tastebook');
    expect(config.repositories).toEqual([{ owner: 'milobedini', name: 'tastebook' }]);
    expect(config.usage.fiveHour).toEqual({ throttleAt: 0.6, pauseAt: 0.8 });
    expect(config.notion?.dataSources.runLog).toBe('66b1c632-fe14-4c5c-8347-69c5dc2f4edd');
  });

  it('rejects a Notion ID that is not a UUID', () => {
    const invalid = tastebookConfig.replace('hubPage: 403c713a6d1281e9bccacd45a250bcf3', 'hubPage: tastebook-hub');
    expect(() => parseFactoryConfig(invalid)).toThrow(/notion\.hubPage|hubPage/);
  });

  it('reads the time zone and Slack channel ID, and defaults the time zone to UTC', () => {
    const config = parseFactoryConfig(tastebookConfig);
    expect(config.timeZone).toBe('Europe/London');
    expect(config.slack?.channelId).toBe('C0CBSE2Q6FQ');
    expect(parseFactoryConfig(tastebookConfig.replace('timeZone: Europe/London\n', '')).timeZone).toBe('UTC');
  });

  it('rejects a time zone that does not exist', () => {
    expect(() => parseFactoryConfig(tastebookConfig.replace('Europe/London', 'Europe/Narnia'))).toThrow(/time zone/);
  });

  it('rejects a usage threshold above 1', () => {
    const invalid = tastebookConfig.replace('pauseAt: 0.8', 'pauseAt: 80');
    expect(() => parseFactoryConfig(invalid)).toThrow(/usage\.fiveHour\.pauseAt|too_big|<=1/);
  });
});
