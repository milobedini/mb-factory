import { parse } from 'yaml';
import { z } from 'zod';

const fraction = z.number().min(0).max(1);
const isTimeZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
};

const githubLogin = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/);

const notionId = z.string().regex(/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/);

export const usagePolicySchema = z.object({
  fiveHour: z.object({
    throttleAt: fraction,
    pauseAt: fraction
  }),
  sevenDay: z.object({
    pacing: z.boolean(),
    slack: fraction,
    pauseAt: fraction
  }),
  staleAfterMinutes: z.int().min(1),
  downshift: z.partialRecord(z.enum(['triage', 'spec', 'implement', 'review']), z.string().min(1))
});

export const factoryConfigSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  alias: z.string().min(1),
  // Times in messages to humans, such as when held work will be released.
  timeZone: z.string().refine(isTimeZone, { message: 'not an IANA time zone' }).default('UTC'),
  repositories: z
    .array(
      z.object({
        owner: z.string().min(1),
        name: z.string().min(1),
        // GitHub logins asked to review a pull request when it reaches Awaiting Merge.
        reviewers: z.array(githubLogin).default([])
      })
    )
    .min(1),
  linear: z.object({
    teamKey: z.string().min(1),
    statuses: z.object({
      researching: z.string().min(1),
      spec: z.string().min(1),
      specReview: z.string().min(1),
      building: z.string().min(1),
      inReview: z.string().min(1),
      awaitingMerge: z.string().min(1),
      done: z.string().min(1),
      canceled: z.string().min(1)
    })
  }),
  slack: z
    .object({
      channel: z.string().min(1),
      channelId: z.string().regex(/^[CG][A-Z0-9]+$/),
      // Slack members who may answer questions and gates, and steer the work, from a thread.
      allowedUserIds: z.array(z.string().regex(/^[UW][A-Z0-9]+$/)).default([])
    })
    .optional(),
  notion: z
    .object({
      teamspace: z.string().min(1),
      hubPage: notionId,
      visionPage: notionId,
      prdTemplatePage: notionId,
      dataSources: z.object({
        prds: notionId,
        decisions: notionId,
        weeklyReports: notionId,
        runLog: notionId
      })
    })
    .optional(),
  models: z.object({
    triage: z.string().min(1),
    spec: z.string().min(1),
    implement: z.string().min(1),
    review: z.string().min(1)
  }),
  review: z.object({ maxRounds: z.int().min(0).max(5) }),
  concurrency: z.object({ maxRuns: z.int().min(1) }),
  usage: usagePolicySchema
});

export type FactoryConfig = z.infer<typeof factoryConfigSchema>;
export type UsagePolicy = z.infer<typeof usagePolicySchema>;

export const parseFactoryConfig = (source: string): FactoryConfig => factoryConfigSchema.parse(parse(source));

// GitHub matches `owner/name` without regard to case.
export const reviewersFor = ({ repositories }: FactoryConfig, repository: string): string[] =>
  repositories.find(({ owner, name }) => `${owner}/${name}`.toLowerCase() === repository.toLowerCase())?.reviewers ??
  [];
