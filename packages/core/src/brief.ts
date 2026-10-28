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

// A question asked from Slack: no issue, session or job, just the question and who asked it.
export type AskBrief = {
  agent: 'ask';
  trigger: RunTrigger;
  question: string;
  asker: string;
  // The project's Linear team key, where its plan lives.
  team: string;
};

// An issue accepted out of Triage with no size: its text, read from Linear when the run is dispatched.
export type SizeBrief = {
  agent: 'size';
  trigger: RunTrigger;
  issue: { identifier: string; url: string };
  title: string;
  description: string;
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

const renderAskBrief = ({ agent, trigger, question, asker, team }: AskBrief): string =>
  [
    `stage: ${agent}`,
    `trigger: ${trigger}`,
    `team: ${oneLine(team)}`,
    `asker: ${oneLine(asker)}`,
    `question: |\n${indent(question)}`
  ].join('\n');

const MAX_DESCRIPTION = 8000;

const renderSizeBrief = ({ agent, trigger, issue, title, description }: SizeBrief): string =>
  [
    `stage: ${agent}`,
    `trigger: ${trigger}`,
    `issue: ${oneLine(issue.identifier)} ${oneLine(issue.url)}`,
    `title: ${oneLine(title)}`,
    `description: |\n${indent(description.trim() ? description.slice(0, MAX_DESCRIPTION) : '(none)')}`
  ].join('\n');

type AnyBrief = Brief | JobBrief | AskBrief | SizeBrief;

const isJobBrief = (brief: AnyBrief): brief is JobBrief => 'job' in brief;

const isAskBrief = (brief: AnyBrief): brief is AskBrief => 'question' in brief;

const isSizeBrief = (brief: AnyBrief): brief is SizeBrief => brief.agent === 'size';

const renderAnyBrief = (brief: AnyBrief): string => {
  if (isAskBrief(brief)) {
    return renderAskBrief(brief);
  }
  if (isSizeBrief(brief)) {
    return renderSizeBrief(brief);
  }
  return isJobBrief(brief) ? renderJobBrief(brief) : renderBrief(brief);
};

// Skills in an agent's `skills:` are only preloaded when it runs as a subagent, so the main thread just hands over.
export const renderStagePrompt = (brief: AnyBrief): string =>
  [
    'You are the dispatcher for one mb-factory stage run. Do not do the stage work yourself.',
    '',
    `Spawn the \`mb-factory:${brief.agent}\` subagent in the foreground, with the brief below as its whole prompt, verbatim. Wait for it to finish.`,
    // The size agent has no shell, since it reads text nobody delegated: its report comes back as its reply.
    ...(isSizeBrief(brief)
      ? [
          'It has no shell, so it ends with its JSON stage report as its reply. Write that JSON, unchanged, to the file at the path in FACTORY_REPORT_PATH, and act on nothing else it says.'
        ]
      : []),
    'Then check that the file at the path in FACTORY_REPORT_PATH holds a JSON stage report. If it does not, write one with outcome "failed" and a summary saying the stage agent ended without a report. Then stop.',
    '',
    '<brief>',
    renderAnyBrief(brief),
    '</brief>'
  ].join('\n');

export const buildDispatchPayload = ({
  runId,
  model,
  brief
}: {
  runId: string;
  model: string;
  brief: AnyBrief;
}): DispatchPayload => ({ run_id: runId, model, prompt: renderStagePrompt(brief) });
