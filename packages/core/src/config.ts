import { parse } from 'yaml';
import { z } from 'zod';

import { JOB_AGENTS } from './stages';

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

// A job's daily slot, as a 24-hour time in the project's time zone.
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'not a 24-hour HH:MM time' });

export const jobSchema = z.object({
  // Names the job in slots, findings and messages, so it must not change once the job has run.
  name: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  agent: z.enum(JOB_AGENTS),
  at: clockTime,
  model: z.string().min(1)
});

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
  downshift: z.partialRecord(z.enum(['triage', 'slicing', 'spec', 'implement', 'review']), z.string().min(1))
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
  models: z.object({
    triage: z.string().min(1),
    spec: z.string().min(1),
    implement: z.string().min(1),
    review: z.string().min(1),
    // Triage when it slices a project into issues; the triage model when unset.
    slicing: z.string().min(1).optional()
  }),
  review: z.object({ maxRounds: z.int().min(0).max(5) }),
  concurrency: z.object({ maxRuns: z.int().min(1) }),
  usage: usagePolicySchema,
  // Scheduled jobs, run once a day through the governor at the lowest priority.
  jobs: z
    .array(jobSchema)
    .default([])
    .refine((jobs) => new Set(jobs.map(({ name }) => name)).size === jobs.length, {
      message: 'job names must be distinct'
    })
    // The health check's slots are recorded under this name.
    .refine((jobs) => jobs.every(({ name }) => name !== 'health'), {
      message: 'health is reserved for the health check'
    }),
  // The console's daily check on itself: warnings and errors, stuck runs, late jobs. No Claude run, so it isn't held.
  health: z.object({ at: clockTime }).optional()
});

export type FactoryConfig = z.infer<typeof factoryConfigSchema>;
export type UsagePolicy = z.infer<typeof usagePolicySchema>;
export type Job = z.infer<typeof jobSchema>;

export const parseFactoryConfig = (source: string): FactoryConfig => factoryConfigSchema.parse(parse(source));

// GitHub matches `owner/name` without regard to case.
export const reviewersFor = ({ repositories }: FactoryConfig, repository: string): string[] =>
  repositories.find(({ owner, name }) => `${owner}/${name}`.toLowerCase() === repository.toLowerCase())?.reviewers ??
  [];
