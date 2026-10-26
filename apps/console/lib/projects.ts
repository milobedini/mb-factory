import type { FactoryConfig } from '@mb-factory/core';
import { parseFactoryConfig } from '@mb-factory/core';

import tastebook from '../../../projects/tastebook/factory.yaml';

// Core's tests parse the same files, so an invalid factory.yaml fails `pnpm test` before it ships.
const PROJECTS: FactoryConfig[] = [parseFactoryConfig(tastebook)];

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

// The governor job serves every project, so it probes by the strictest staleness limit.
export const strictestStaleAfterMinutes = (): number =>
  Math.min(...PROJECTS.map(({ usage }) => usage.staleAfterMinutes));

// Times on console pages; the console serves one operator, so the first project's zone stands for theirs.
export const consoleTimeZone = (): string => PROJECTS[0]?.timeZone ?? 'UTC';

export const allProjects = (): FactoryConfig[] => PROJECTS;

// A Slack mention names its project by the channel it's in.
export const findProjectBySlackChannel = (channelId: string): FactoryConfig | undefined =>
  PROJECTS.find(({ slack }) => slack?.channelId === channelId);
