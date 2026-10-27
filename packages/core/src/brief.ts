import type { JobScope } from './config';
import type { RunTrigger } from './runs';
import type { AgentRole } from './stages';

export const DISPATCH_EVENT = 'factory-stage';

export type Brief = {
  agent: AgentRole;
  issue: { identifier: string; url: string };
  session: string;
  trigger: RunTrigger;
  prompt?: string;
  pr?: number;
  branch?: string;
  round?: number;
  // `Name <email>` of the person the work is for, credited on every commit.
  coAuthor?: string;
};

// A scheduled job's brief: no issue or session, just the slot it fills and where the last run of it got to.
export type JobBrief = {
  agent: AgentRole;
  job: string;
  trigger: RunTrigger;
  slot: Date;
  // `repo` when the job reads the whole repository rather than what changed.
  scope: JobScope;
  // The newest commit on the default branch the job's last run covered; never for a whole-repo job.
  since?: string;
};

// The `client_payload` of the repository_dispatch; the caller workflow passes each field to stage.yml.
export type DispatchPayload = {
  run_id: string;
  model: string;
  prompt: string;
};

const indent = (text: string): string =>
  text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');

// Keeps a field on its own line, so no value can add lines that read as other brief fields.
const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

const renderBrief = ({ agent, issue, session, trigger, prompt, pr, branch, round, coAuthor }: Brief): string =>
  [
    `stage: ${agent}`,
    `issue: ${oneLine(issue.identifier)} ${oneLine(issue.url)}`,
    `session: ${oneLine(session)}`,
    `trigger: ${trigger}`,
    pr === undefined ? undefined : `pr: ${pr}`,
    branch === undefined ? undefined : `branch: ${oneLine(branch)}`,
    round === undefined ? undefined : `round: ${round}`,
    coAuthor === undefined ? undefined : `co-author: ${oneLine(coAuthor)}`,
    prompt === undefined ? undefined : `prompt: |\n${indent(prompt)}`
  ]
    .filter((line) => line !== undefined)
    .join('\n');

const renderJobBrief = ({ agent, job, trigger, slot, scope, since }: JobBrief): string =>
  [
    `stage: ${agent}`,
    `job: ${oneLine(job)}`,
    `trigger: ${trigger}`,
    `slot: ${slot.toISOString()}`,
    `scope: ${scope}`,
    since === undefined ? undefined : `since: ${oneLine(since)}`
  ]
    .filter((line) => line !== undefined)
    .join('\n');

const isJobBrief = (brief: Brief | JobBrief): brief is JobBrief => 'job' in brief;

// Skills in an agent's `skills:` are only preloaded when it runs as a subagent, so the main thread just hands over.
export const renderStagePrompt = (brief: Brief | JobBrief): string =>
  [
    'You are the dispatcher for one mb-factory stage run. Do not do the stage work yourself.',
    '',
    `Spawn the \`mb-factory:${brief.agent}\` subagent in the foreground, with the brief below as its whole prompt, verbatim. Wait for it to finish.`,
    'Then check that the file at the path in FACTORY_REPORT_PATH holds a JSON stage report. If it does not, write one with outcome "failed" and a summary saying the stage agent ended without a report. Then stop.',
    '',
    '<brief>',
    isJobBrief(brief) ? renderJobBrief(brief) : renderBrief(brief),
    '</brief>'
  ].join('\n');

export const buildDispatchPayload = ({
  runId,
  model,
  brief
}: {
  runId: string;
  model: string;
  brief: Brief | JobBrief;
}): DispatchPayload => ({ run_id: runId, model, prompt: renderStagePrompt(brief) });
