import type { FactoryConfig, SentryIssue } from '@mb-factory/core';

import { requireEnv } from './env';

type Sentry = NonNullable<FactoryConfig['sentry']>;

type Issue = {
  shortId: string;
  title: string;
  count: string;
  firstSeen: string;
  permalink: string;
  project: { slug: string };
};

// The project's unresolved Sentry issues first seen since a moment, for the health check; a day's worth fits one page.
// SENTRY_AUTH_TOKEN needs only `event:read`.
export const newSentryIssues = async ({ url, organisation, projects }: Sentry, since: Date): Promise<SentryIssue[]> => {
  const query = new URLSearchParams([
    ['query', `is:unresolved firstSeen:>${since.toISOString().replace(/\.\d+Z$/, 'Z')}`],
    ['sort', 'new'],
    ['limit', '100'],
    ['collapse', 'stats'],
    ...projects.map((project) => ['project', project])
  ]);
  const response = await fetch(`${url}/api/0/organizations/${encodeURIComponent(organisation)}/issues/?${query}`, {
    headers: { Authorization: `Bearer ${requireEnv('SENTRY_AUTH_TOKEN')}` }
  });
  if (!response.ok) {
    throw new Error(`Sentry issues failed with ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const issues = (await response.json()) as Issue[];
  return issues.map((issue) => ({
    project: issue.project.slug,
    shortId: issue.shortId,
    title: issue.title,
    count: Number(issue.count),
    firstSeen: new Date(issue.firstSeen),
    url: issue.permalink
  }));
};
