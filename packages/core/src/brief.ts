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

const renderBrief = ({ agent, issue, session, trigger, prompt, pr, branch, round }: Brief): string =>
  [
    `stage: ${agent}`,
    `issue: ${oneLine(issue.identifier)} ${oneLine(issue.url)}`,
    `session: ${oneLine(session)}`,
    `trigger: ${trigger}`,
    pr === undefined ? undefined : `pr: ${pr}`,
    branch === undefined ? undefined : `branch: ${oneLine(branch)}`,
    round === undefined ? undefined : `round: ${round}`,
    prompt === undefined ? undefined : `prompt: |\n${indent(prompt)}`
  ]
    .filter((line) => line !== undefined)
    .join('\n');

// Skills in an agent's `skills:` are only preloaded when it runs as a subagent, so the main thread just hands over.
export const renderStagePrompt = (brief: Brief): string =>
  [
    'You are the dispatcher for one mb-factory stage run. Do not do the stage work yourself.',
    '',
    `Spawn the \`mb-factory:${brief.agent}\` subagent in the foreground, with the brief below as its whole prompt, verbatim. Wait for it to finish.`,
    'Then check that the file at the path in FACTORY_REPORT_PATH holds a JSON stage report. If it does not, write one with outcome "failed" and a summary saying the stage agent ended without a report. Then stop.',
    '',
    '<brief>',
    renderBrief(brief),
    '</brief>'
  ].join('\n');

export const buildDispatchPayload = ({
  runId,
  model,
  brief
}: {
  runId: string;
  model: string;
  brief: Brief;
}): DispatchPayload => ({ run_id: runId, model, prompt: renderStagePrompt(brief) });
