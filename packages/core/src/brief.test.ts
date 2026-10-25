import { describe, expect, it } from 'vitest';

import type { Brief } from './brief';
import { buildDispatchPayload, renderStagePrompt } from './brief';

const brief: Brief = {
  agent: 'implement',
  issue: { identifier: 'TAS-12', url: 'https://linear.app/tastebook/issue/TAS-12' },
  session: 'session-1',
  trigger: 'delegated'
};

const briefBlock = (prompt: string): string => prompt.slice(prompt.indexOf('<brief>'));

describe('renderStagePrompt', () => {
  it('hands the brief to the stage’s plugin subagent', () => {
    expect(renderStagePrompt(brief)).toContain('Spawn the `mb-factory:implement` subagent in the foreground');
  });

  it('writes only the brief fields that exist', () => {
    expect(briefBlock(renderStagePrompt(brief))).toBe(
      [
        '<brief>',
        'stage: implement',
        'issue: TAS-12 https://linear.app/tastebook/issue/TAS-12',
        'session: session-1',
        'trigger: delegated',
        '</brief>'
      ].join('\n')
    );
  });

  it('adds the PR, branch, round and the human’s prompt as an indented block', () => {
    const prompt = renderStagePrompt({
      ...brief,
      trigger: 'prompted',
      pr: 42,
      branch: 'tas-12-show-cooking-time',
      round: 0,
      prompt: 'Address the review comments.\nKeep the copy as it is.'
    });

    expect(briefBlock(prompt)).toBe(
      [
        '<brief>',
        'stage: implement',
        'issue: TAS-12 https://linear.app/tastebook/issue/TAS-12',
        'session: session-1',
        'trigger: prompted',
        'pr: 42',
        'branch: tas-12-show-cooking-time',
        'round: 0',
        'prompt: |',
        '    Address the review comments.',
        '    Keep the copy as it is.',
        '</brief>'
      ].join('\n')
    );
  });
});

describe('buildDispatchPayload', () => {
  it('carries the run ID, model and rendered prompt', () => {
    expect(buildDispatchPayload({ runId: 'run-1', model: 'opus', brief })).toEqual({
      run_id: 'run-1',
      model: 'opus',
      prompt: renderStagePrompt(brief)
    });
  });
});
