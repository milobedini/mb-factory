// Test-only: the real config files, so an invalid one fails `pnpm test` before it ships.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { FactoryConfig } from './config';
import { parseFactoryConfig, parseSharedConfig } from './config';

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

export const sharedSource = read('../../../factory.yaml');
export const tastebookSource = read('../../../projects/tastebook/factory.yaml');

export const sharedConfig = parseSharedConfig(sharedSource);

// A project's factory.yaml with the factory-wide settings.
export const parseProject = (source: string): FactoryConfig => parseFactoryConfig(source, sharedConfig);

export const tastebookConfig = parseProject(tastebookSource);
