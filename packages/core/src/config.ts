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

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

export const JOB_SCOPES = ['changes', 'repo'] as const;

export const jobSchema = z.object({
  // Names the job in slots, findings and messages, so it must not change once the job has run.
  name: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  agent: z.enum(JOB_AGENTS),
  // Once a week on this day; every day when unset.
  day: z.enum(WEEKDAYS).optional(),
  at: clockTime,
  // `changes` reads the commits since the job's last run; `repo` reads the whole repository.
  scope: z.enum(JOB_SCOPES).default('changes'),
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
  downshift: z.partialRecord(z.enum(['triage', 'slicing', 'spec', 'implement', 'verify', 'review']), z.string().min(1))
});

export const factoryConfigSchema = z
  .object({
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
    // The people the factory credits as co-author on its commits: a Linear member (by email) and their git identity,
    // with the noreply address GitHub links to their account. Someone not listed is credited nowhere.
    people: z
      .array(
        z.object({
          linear: z.email(),
          git: z.string().regex(/^[^<>\n]+ <[^<>\s]+@[^<>\s]+>$/, { message: 'not "Name <email>"' })
        })
      )
      .default([]),
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
      slicing: z.string().min(1).optional(),
      // Needed when `verify` is set.
      verify: z.string().min(1).optional()
    }),
    // Paths whose changes show on screen. A delivered PR that touches any of them is verified in the app before review;
    // without this, PRs go straight to review.
    verify: z.object({ paths: z.array(z.string().min(1)).min(1) }).optional(),
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
      })
      // Guards the implement stage reports are filed as findings under this name.
      .refine((jobs) => jobs.every(({ name }) => name !== 'guard'), {
        message: 'guard is reserved for guards'
      }),
    // The console's daily check on itself: warnings and errors, stuck runs, late jobs. No Claude run, so it isn't held.
    health: z.object({ at: clockTime }).optional(),
    // Where the project's app reports its errors; the health check lists new unresolved Sentry issues from here.
    sentry: z
      .object({
        // The organisation's region, such as https://de.sentry.io for one hosted in the EU.
        url: z.url().default('https://sentry.io'),
        organisation: z.string().min(1),
        projects: z.array(z.string().min(1)).min(1)
      })
      .optional()
  })
  .refine((config) => !config.verify || config.models.verify, {
    message: 'models.verify is needed when verify is set',
    path: ['models', 'verify']
  });

export type FactoryConfig = z.infer<typeof factoryConfigSchema>;
export type UsagePolicy = z.infer<typeof usagePolicySchema>;
export type Job = z.infer<typeof jobSchema>;
export type JobScope = (typeof JOB_SCOPES)[number];

export const parseFactoryConfig = (source: string): FactoryConfig => factoryConfigSchema.parse(parse(source));

// GitHub matches `owner/name` without regard to case.
export const reviewersFor = ({ repositories }: FactoryConfig, repository: string): string[] =>
  repositories.find(({ owner, name }) => `${owner}/${name}`.toLowerCase() === repository.toLowerCase())?.reviewers ??
  [];

// The git identity to credit on a work item's commits: the person it's assigned to, when the project lists them.
export const coAuthorFor = (config: Pick<FactoryConfig, 'people'>, email: string | null): string | undefined =>
  email ? config.people.find(({ linear }) => linear.toLowerCase() === email.toLowerCase())?.git : undefined;
