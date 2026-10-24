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
  });

  it('rejects a usage threshold above 1', () => {
    const invalid = tastebookConfig.replace('pauseAt: 0.8', 'pauseAt: 80');
    expect(() => parseFactoryConfig(invalid)).toThrow(/usage\.fiveHour\.pauseAt|too_big|<=1/);
  });
});
