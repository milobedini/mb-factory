import { describe, expect, it } from 'vitest';

import {
  coAuthorFor,
  parseFactoryConfig,
  parseSharedConfig,
  personFor,
  personForGitHub,
  personForSlack,
  personName,
  reviewersFor,
  slackMentionFor,
  usesMergeQueue
} from './config';
import { parseProject, sharedConfig, sharedSource, tastebookSource as tastebookConfig } from './test-config';

describe('parseFactoryConfig', () => {
  it('parses the Tastebook factory definition', () => {
    const config = parseProject(tastebookConfig);
    expect(config.alias).toBe('Tastebook');
    expect(config.repositories).toEqual([
      { owner: 'Milo-Bedini', name: 'tastebook', reviewers: ['milobedini'], mergeQueue: true }
    ]);
    expect(config.usage).toEqual(sharedConfig.usage);
    expect(config.concurrency).toEqual({ maxRuns: 5 });
    expect(config.mergeEffect).toBe('deploys it to production');
  });

  it('reads the time zone and Slack channel ID, and defaults the time zone to UTC', () => {
    const config = parseProject(tastebookConfig);
    expect(config.timeZone).toBe('Europe/London');
    expect(config.slack?.channelId).toBe('C0CBSE2Q6FQ');
    expect(parseProject(tastebookConfig.replace('timeZone: Europe/London\n', '')).timeZone).toBe('UTC');
  });

  it('rejects a time zone that does not exist', () => {
    expect(() => parseProject(tastebookConfig.replace('Europe/London', 'Europe/Narnia'))).toThrow(/time zone/);
  });

  it('rejects a usage threshold above 1 in the factory-wide config', () => {
    expect(parseSharedConfig(sharedSource).usage.sevenDay.pauseAt).toBe(0.85);
    expect(() => parseSharedConfig(sharedSource.replace('pauseAt: 0.85', 'pauseAt: 85'))).toThrow(/too_big|<=1/);
  });

  it('refuses a project that sets the factory-wide run cap or usage itself', () => {
    expect(() => parseFactoryConfig(`${tastebookConfig}\nconcurrency:\n  maxRuns: 9\n`, sharedConfig)).toThrow(
      /factory-wide/
    );
    expect(() => parseFactoryConfig(`${tastebookConfig}\nusage:\n  staleAfterMinutes: 5\n`, sharedConfig)).toThrow(
      /factory-wide/
    );
  });

  it('defaults a repository to no reviewers, and rejects a reviewer that is not a GitHub login', () => {
    const withoutReviewers = tastebookConfig.replace('    reviewers:\n      - milobedini\n', '');
    expect(parseProject(withoutReviewers).repositories[0]?.reviewers).toEqual([]);
    expect(() => parseProject(tastebookConfig.replace('- milobedini\n', '- "@milobedini"\n'))).toThrow(/reviewers/);
  });
});

describe('people', () => {
  const milo = 'Milo Bedini <89992629+milobedini@users.noreply.github.com>';

  it('credits the assignee the project lists, by email in any case, and nobody else', () => {
    const config = parseProject(tastebookConfig);
    expect(coAuthorFor(config, 'MiloBedini64@gmail.com')).toBe(milo);
    expect(coAuthorFor(config, 'someone@example.com')).toBeUndefined();
    expect(coAuthorFor(config, null)).toBeUndefined();
  });

  it('names the assignee and mentions them in Slack when the project has their member ID', () => {
    const config = parseProject(tastebookConfig);
    const person = personFor(config, 'milobedini64@gmail.com');
    expect(person && personName(person)).toBe('Milo Bedini');
    expect(slackMentionFor(config, 'milobedini64@gmail.com')).toBe('<@U0CBS3FN806>');
    expect(slackMentionFor(config, 'someone@example.com')).toBeUndefined();
    const unmapped = parseProject(tastebookConfig.replace(/\n {4}slack: U0CBS3FN806/, ''));
    expect(slackMentionFor(unmapped, 'milobedini64@gmail.com')).toBeUndefined();
    expect(() => parseProject(tastebookConfig.replace('slack: U0CBS3FN806', 'slack: milo'))).toThrow(/people/);
  });

  it('finds a person by their Slack member ID or GitHub user ID, which must be a positive whole number', () => {
    const config = parseProject(tastebookConfig);
    expect(personForSlack(config, 'U0CBS3FN806')?.linear).toBe('milobedini64@gmail.com');
    expect(personForSlack(config, 'U0SOMEONE')).toBeUndefined();
    expect(personForGitHub(config, 89992629)?.slack).toBe('U0CBS3FN806');
    expect(personForGitHub(config, 1)).toBeUndefined();
    expect(() => parseProject(tastebookConfig.replace('github: 89992629', 'github: milobedini'))).toThrow(/people/);
  });

  it('needs a git identity as "Name <email>", and lists nobody by default', () => {
    expect(() => parseProject(tastebookConfig.replace(milo, 'milobedini'))).toThrow(/people/);
    const without = tastebookConfig.replace(/\npeople:\n(?: {2}.*\n| {4}.*\n)+/, '\n');
    expect(parseProject(without).people).toEqual([]);
  });
});

describe('jobs', () => {
  it('reads the daily checks, the weekly whole-repo passes and the clean-up, and defaults to no jobs', () => {
    expect(parseProject(tastebookConfig).jobs).toEqual([
      { name: 'security', agent: 'security', at: '06:00', scope: 'changes', model: 'sonnet' },
      { name: 'docs', agent: 'docs', at: '06:30', scope: 'changes', model: 'sonnet' },
      { name: 'security-weekly', agent: 'security', day: 'monday', at: '05:00', scope: 'repo', model: 'sonnet' },
      { name: 'docs-weekly', agent: 'docs', day: 'monday', at: '05:30', scope: 'repo', model: 'sonnet' },
      { name: 'cleanup', agent: 'cleanup', day: 'monday', at: '07:00', scope: 'repo', model: 'sonnet' }
    ]);
    expect(parseProject(tastebookConfig.slice(0, tastebookConfig.indexOf('\njobs:'))).jobs).toEqual([]);
  });

  it('rejects a time that is not HH:MM and a repeated name', () => {
    expect(() => parseProject(tastebookConfig.replace('at: "06:00"', 'at: "6am"'))).toThrow(/HH:MM/);
    const repeated = `${tastebookConfig}  - name: security\n    agent: security\n    at: "18:00"\n    model: sonnet\n`;
    expect(() => parseProject(repeated)).toThrow(/distinct/);
  });

  it('keeps the name health for the health check', () => {
    const health = `${tastebookConfig}  - name: health\n    agent: security\n    at: "18:00"\n    model: sonnet\n`;
    expect(() => parseProject(health)).toThrow(/reserved/);
  });
});

describe('design', () => {
  it('reads the design routine and the Design System it draws with, which is optional', () => {
    expect(parseProject(tastebookConfig).design).toEqual({
      routine: 'trig_015ytNVnxYsCys81Mnm6A8N4',
      system: {
        url: 'https://claude.ai/artifact/Log29Ws2J3fTumoXaxVr1C',
        build: 'pnpm dino:bundle',
        out: 'frontend/dino-bundle'
      }
    });
    const without = tastebookConfig.replace(/ {2}system:\n( {4}.+\n)+/, '');
    expect(parseProject(without).design).toEqual({ routine: 'trig_015ytNVnxYsCys81Mnm6A8N4' });
  });

  it('rejects an output folder outside the repository', () => {
    expect(() => parseProject(tastebookConfig.replace('out: frontend/dino-bundle', 'out: ../dino-bundle'))).toThrow(
      /out/
    );
    expect(() => parseProject(tastebookConfig.replace('out: frontend/dino-bundle', 'out: /tmp'))).toThrow(/out/);
  });
});

describe('health', () => {
  it('reads the daily health check, and has none when it is left out', () => {
    expect(parseProject(tastebookConfig).health).toEqual({ at: '07:00' });
    expect(parseProject(tastebookConfig.replace(/\nhealth:\n {2}at: "07:00"\n/, '\n')).health).toBeUndefined();
  });
});

describe('sentry', () => {
  it('reads where the app reports its errors, defaulting to sentry.io', () => {
    expect(parseProject(tastebookConfig).sentry).toEqual({
      url: 'https://de.sentry.io',
      organisation: 'milo-bedini',
      projects: ['sentry-gray-fountain']
    });
    expect(parseProject(tastebookConfig.replace('  url: https://de.sentry.io\n', '')).sentry?.url).toBe(
      'https://sentry.io'
    );
  });

  it('needs at least one project', () => {
    expect(() =>
      parseProject(tastebookConfig.replace(/ {2}projects:\n {4}- sentry-gray-fountain\n/, '  projects: []\n'))
    ).toThrow();
  });
});

describe('reviewersFor', () => {
  const config = parseProject(tastebookConfig);

  it('finds the reviewers for a repository whatever its case', () => {
    expect(reviewersFor(config, 'Milo-Bedini/tastebook')).toEqual(['milobedini']);
    expect(reviewersFor(config, 'milo-bedini/Tastebook')).toEqual(['milobedini']);
  });

  it('returns none for a repository the project does not list', () => {
    expect(reviewersFor(config, 'milobedini/tastebook')).toEqual([]);
    expect(reviewersFor(config, 'milobedini/mb-factory')).toEqual([]);
  });
});

describe('usesMergeQueue', () => {
  it('is on for Tastebook, whatever the case', () => {
    expect(usesMergeQueue(parseProject(tastebookConfig), 'milo-bedini/Tastebook')).toBe(true);
  });

  it('is off unless the repository turns it on', () => {
    const config = parseProject(tastebookConfig.replace('    mergeQueue: true\n', ''));
    expect(usesMergeQueue(config, 'Milo-Bedini/tastebook')).toBe(false);
    expect(usesMergeQueue(parseProject(tastebookConfig), 'milobedini/mb-factory')).toBe(false);
  });
});

describe('checks', () => {
  it('reads the fast checks the stage hooks run', () => {
    const { checks } = parseProject(tastebookConfig);
    expect(checks?.fast.edit.map(({ paths }) => paths)).toEqual([['frontend/', 'tools/'], ['backend/']]);
    expect(checks?.fast.edit[1]).toMatchObject({ extensions: ['py'], dir: 'backend' });
    expect(checks?.fast.stop).toHaveLength(2);
  });

  it('refuses a path or directory that could leave the repo or break the shell', () => {
    const bad = (path: string) => tastebookConfig.replace('paths: [frontend/, tools/]', `paths: ["${path}"]`);
    expect(() => parseProject(bad('/etc/'))).toThrow();
    expect(() => parseProject(bad('frontend/$(id)'))).toThrow();
    expect(() =>
      parseProject(
        tastebookConfig.replace('dir: backend\n        run: uv run ruff', 'dir: ../x\n        run: uv run ruff')
      )
    ).toThrow();
  });
});
