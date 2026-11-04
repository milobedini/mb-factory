import type { FactoryConfig, Fix, MergedPr } from '@mb-factory/core';
import { FIX_WINDOW_DAYS, fixesBy, mergedPrFrom } from '@mb-factory/core';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { events, prFixes, workItems } from '@/db/schema';

import { log } from './log';
import { allProjects } from './projects';

const DAY_MS = 24 * 60 * 60 * 1000;

const repositoriesOf = ({ repositories }: FactoryConfig): string[] =>
  repositories.map(({ owner, name }) => `${owner}/${name}`);

// Each PR's issue is its work item's when it has one, since a slice can be built on its parent's branch name.
const withWorkItemIssues = async (prs: MergedPr[]): Promise<MergedPr[]> => {
  const [first] = prs;
  if (!first) {
    return prs;
  }
  const rows = await getDb()
    .select({ prNumber: workItems.prNumber, issue: workItems.issueIdentifier })
    .from(workItems)
    .where(
      and(
        eq(workItems.repository, first.repository),
        inArray(
          workItems.prNumber,
          prs.map(({ number }) => number)
        )
      )
    );
  const issues = new Map(rows.map(({ prNumber, issue }) => [prNumber, issue]));
  return prs.map((pr) => ({ ...pr, issue: issues.get(pr.number) ?? pr.issue }));
};

export const insertFixes = async (fixes: Fix[]): Promise<number> => {
  if (fixes.length === 0) {
    return 0;
  }
  const inserted = await getDb()
    .insert(prFixes)
    .values(
      fixes.map((fix) => ({
        repository: fix.repository,
        prNumber: fix.prNumber,
        issueIdentifier: fix.issue,
        mergedAt: fix.mergedAt,
        byPrNumber: fix.byPrNumber,
        byIssueIdentifier: fix.byIssue,
        byMergedAt: fix.byMergedAt,
        kind: fix.kind
      }))
    )
    .onConflictDoNothing()
    .returning({ id: prFixes.id });
  return inserted.length;
};

// Fixes or reverts within 7 days (docs/express.md, "Measuring it"): when any PR in a project's repository merges, what
// it fixed or reverted among the PRs merged there in the 7 days before, from their own webhooks.
export const recordFixes = async (payload: unknown): Promise<void> => {
  const found = allProjects().flatMap((project) => {
    const merged = mergedPrFrom(payload, project.linear.teamKey);
    return merged && repositoriesOf(project).includes(merged.repository) ? [{ project, merged }] : [];
  })[0];
  if (!found) {
    return;
  }
  const { project, merged } = found;
  const since = new Date(merged.mergedAt.getTime() - FIX_WINDOW_DAYS * DAY_MS);
  const rows = await getDb()
    .select({ payload: events.payload })
    .from(events)
    .where(
      and(
        eq(events.source, 'github'),
        eq(events.type, 'pull_request'),
        eq(events.action, 'closed'),
        gte(events.receivedAt, since),
        sql`${events.payload}->'repository'->>'full_name' = ${merged.repository}`,
        sql`(${events.payload}->'pull_request'->>'merged')::boolean`
      )
    );
  const earlier = rows.flatMap(({ payload: row }) => {
    const pr = mergedPrFrom(row, project.linear.teamKey);
    return pr ? [pr] : [];
  });
  const [later, ...rest] = await withWorkItemIssues([merged, ...earlier]);
  const fixes = later ? fixesBy(later, rest, project.linear.teamKey) : [];
  const recorded = await insertFixes(fixes);
  if (recorded > 0) {
    log('info', 'fixes recorded', {
      pr: merged.number,
      fixed: fixes.map(({ prNumber, kind }) => `#${prNumber} (${kind})`)
    });
  }
};
