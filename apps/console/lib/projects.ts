import type { FactoryConfig, SharedConfig } from '@mb-factory/core';
import { parseFactoryConfig, parseSharedConfig } from '@mb-factory/core';

import factory from '../../../factory.yaml';
import tastebook from '../../../projects/tastebook/factory.yaml';

// Core's tests parse the same files, so an invalid factory.yaml fails `pnpm test` before it ships.
const SHARED: SharedConfig = parseSharedConfig(factory);
const PROJECTS: FactoryConfig[] = [parseFactoryConfig(tastebook, SHARED)];

export const findProjectByTeamKey = (teamKey: string): FactoryConfig | undefined =>
  PROJECTS.find(({ linear }) => linear.teamKey === teamKey);

export const findProject = (name: string): FactoryConfig | undefined =>
  PROJECTS.find((project) => project.name === name);

export const repositoryOf = ({ repositories }: FactoryConfig): string => {
  const [primary] = repositories;
  if (!primary) {
    throw new Error('factory.yaml lists no repositories');
  }
  return `${primary.owner}/${primary.name}`;
};

// The governor job serves every project, which share one usage policy.
export const staleAfterMinutes = (): number => SHARED.usage.staleAfterMinutes;

// The run cap across every project.
export const maxRuns = (): number => SHARED.concurrency.maxRuns;

export const usagePolicy = (): SharedConfig['usage'] => SHARED.usage;

// Times on console pages; the console serves one operator, so the first project's zone stands for theirs.
export const consoleTimeZone = (): string => PROJECTS[0]?.timeZone ?? 'UTC';

export const allProjects = (): FactoryConfig[] => PROJECTS;

// A Slack mention names its project by the channel it's in.
export const findProjectBySlackChannel = (channelId: string): FactoryConfig | undefined =>
  PROJECTS.find(({ slack }) => slack?.channelId === channelId);
