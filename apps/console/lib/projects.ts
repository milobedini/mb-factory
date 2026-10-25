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
