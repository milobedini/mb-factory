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

const MAX_PAGES = 5;

// Sentry's Link header names the next page's cursor, with `results="true"` while there is one.
const nextCursor = (link: string | null): string | undefined =>
  link
    ?.split(',')
    .find((part) => part.includes('rel="next"') && part.includes('results="true"'))
    ?.match(/cursor="([^"]+)"/)?.[1];

const issuesPage = async (sentry: Sentry, query: URLSearchParams, page: number): Promise<SentryIssue[]> => {
  const response = await fetch(
    `${sentry.url}/api/0/organizations/${encodeURIComponent(sentry.organisation)}/issues/?${query}`,
    { headers: { Authorization: `Bearer ${requireEnv('SENTRY_AUTH_TOKEN')}` } }
  );
  if (!response.ok) {
    throw new Error(`Sentry issues failed with ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  const issues = ((await response.json()) as Issue[]).map((issue) => ({
    project: issue.project.slug,
    shortId: issue.shortId,
    title: issue.title,
    count: Number(issue.count),
    firstSeen: new Date(issue.firstSeen),
    url: issue.permalink
  }));
  const cursor = nextCursor(response.headers.get('link'));
  if (!cursor || page + 1 >= MAX_PAGES) {
    return issues;
  }
  const next = new URLSearchParams(query);
  next.set('cursor', cursor);
  return [...issues, ...(await issuesPage(sentry, next, page + 1))];
};

// Every issue first seen in a period, resolved or not, for the dashboard's Sentry issues after each merge.
export const sentryIssuesFirstSeen = (sentry: Sentry, from: Date, to: Date): Promise<SentryIssue[]> => {
  const iso = (at: Date): string => at.toISOString().replace(/\.\d+Z$/, 'Z');
  return issuesPage(
    sentry,
    new URLSearchParams([
      ['query', `firstSeen:>${iso(from)}`],
      ['start', iso(from)],
      ['end', iso(to)],
      ['sort', 'new'],
      ['limit', '100'],
      ['collapse', 'stats'],
      ...sentry.projects.map((project) => ['project', project])
    ]),
    0
  );
};
