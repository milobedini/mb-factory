import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseFactoryConfig, reviewersFor } from './config';

const tastebookConfig = readFileSync(
  fileURLToPath(new URL('../../../projects/tastebook/factory.yaml', import.meta.url)),
  'utf8'
);

describe('parseFactoryConfig', () => {
  it('parses the Tastebook factory definition', () => {
    const config = parseFactoryConfig(tastebookConfig);
    expect(config.alias).toBe('Tastebook');
    expect(config.repositories).toEqual([{ owner: 'milobedini', name: 'tastebook', reviewers: ['milobedini'] }]);
    expect(config.usage.fiveHour).toEqual({ throttleAt: 0.6, pauseAt: 0.8 });
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

  it('defaults a repository to no reviewers, and rejects a reviewer that is not a GitHub login', () => {
    const withoutReviewers = tastebookConfig.replace('    reviewers:\n      - milobedini\n', '');
    expect(parseFactoryConfig(withoutReviewers).repositories[0]?.reviewers).toEqual([]);
    expect(() => parseFactoryConfig(tastebookConfig.replace('- milobedini\n', '- "@milobedini"\n'))).toThrow(
      /reviewers/
    );
  });
});

describe('verify', () => {
  it('reads the paths that show on screen, and needs a verify model with them', () => {
    expect(parseFactoryConfig(tastebookConfig).verify).toEqual({ paths: ['frontend/'] });
    expect(() => parseFactoryConfig(tastebookConfig.replace('  verify: sonnet\n', ''))).toThrow(/models\.verify/);
    const without = tastebookConfig
      .replace(/\nverify:\n {2}paths:\n {4}- frontend\/\n/, '\n')
      .replace('  verify: sonnet\n', '');
    expect(parseFactoryConfig(without).verify).toBeUndefined();
  });
});

describe('jobs', () => {
  it('reads the daily checks and the weekly whole-repo passes, and defaults to no jobs', () => {
    expect(parseFactoryConfig(tastebookConfig).jobs).toEqual([
      { name: 'security', agent: 'security', at: '06:00', scope: 'changes', model: 'sonnet' },
      { name: 'docs', agent: 'docs', at: '06:30', scope: 'changes', model: 'sonnet' },
      { name: 'security-weekly', agent: 'security', day: 'monday', at: '05:00', scope: 'repo', model: 'sonnet' },
      { name: 'docs-weekly', agent: 'docs', day: 'monday', at: '05:30', scope: 'repo', model: 'sonnet' }
    ]);
    expect(parseFactoryConfig(tastebookConfig.slice(0, tastebookConfig.indexOf('\njobs:'))).jobs).toEqual([]);
  });

  it('rejects a time that is not HH:MM and a repeated name', () => {
    expect(() => parseFactoryConfig(tastebookConfig.replace('at: "06:00"', 'at: "6am"'))).toThrow(/HH:MM/);
    const repeated = `${tastebookConfig}  - name: security\n    agent: security\n    at: "18:00"\n    model: sonnet\n`;
    expect(() => parseFactoryConfig(repeated)).toThrow(/distinct/);
  });

  it('keeps the name health for the health check', () => {
    const health = `${tastebookConfig}  - name: health\n    agent: security\n    at: "18:00"\n    model: sonnet\n`;
    expect(() => parseFactoryConfig(health)).toThrow(/reserved/);
  });
});

describe('health', () => {
  it('reads the daily health check, and has none when it is left out', () => {
    expect(parseFactoryConfig(tastebookConfig).health).toEqual({ at: '07:00' });
    expect(parseFactoryConfig(tastebookConfig.replace(/\nhealth:\n {2}at: "07:00"\n/, '\n')).health).toBeUndefined();
  });
});

describe('reviewersFor', () => {
  const config = parseFactoryConfig(tastebookConfig);

  it('finds the reviewers for a repository whatever its case', () => {
    expect(reviewersFor(config, 'milobedini/tastebook')).toEqual(['milobedini']);
    expect(reviewersFor(config, 'MiloBedini/Tastebook')).toEqual(['milobedini']);
  });

  it('returns none for a repository the project does not list', () => {
    expect(reviewersFor(config, 'milobedini/mb-factory')).toEqual([]);
  });
});
