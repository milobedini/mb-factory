import { describe, expect, it } from 'vitest';

import { renderStagePrompt } from './brief';
import { needsSizing, readSizeReport, sizedComment, unsizedComment } from './sizing';
import type { IssueUpdate } from './work-item-events';

const app = 'app-user';

// TAS-67 accepted out of Triage by the user: moved to Backlog, no estimate, nobody delegated.
const accepted: IssueUpdate = {
  organizationId: 'org',
  issueId: 'issue',
  identifier: 'TAS-67',
  teamKey: 'TAS',
  actorId: 'milo',
  estimate: null,
  project: null,
  milestone: null,
  delegated: false,
  state: { name: 'Backlog', type: 'backlog' }
};

describe('needsSizing', () => {
  it('sizes an unsized issue a person moves into Backlog or Todo', () => {
    expect(needsSizing(accepted, app)).toBe(true);
    expect(needsSizing({ ...accepted, state: { name: 'Todo', type: 'unstarted' } }, app)).toBe(true);
  });

  it('leaves sized, delegated and still-in-Triage issues, and the factory’s own moves', () => {
    expect(needsSizing({ ...accepted, estimate: 2 }, app)).toBe(false);
    expect(needsSizing({ ...accepted, delegated: true }, app)).toBe(false);
    expect(needsSizing({ ...accepted, state: { name: 'Triage', type: 'triage' } }, app)).toBe(false);
    expect(needsSizing({ ...accepted, state: undefined }, app)).toBe(false);
    expect(needsSizing({ ...accepted, actorId: app }, app)).toBe(false);
  });
});

describe('readSizeReport', () => {
  it('reads the size as Linear’s estimate', () => {
    expect(readSizeReport({ outcome: 'done', size: 'S', why: 'One serializer and its test.' })).toEqual({
      size: 'S',
      estimate: 2,
      why: 'One serializer and its test.'
    });
  });

  it('reads nothing from a failed run or an unknown size', () => {
    expect(readSizeReport({ outcome: 'failed', size: 'S', why: 'x' })).toBeUndefined();
    expect(readSizeReport({ outcome: 'done', size: 'Huge', why: 'x' })).toBeUndefined();
  });
});

describe('sizedComment', () => {
  it('says the size and why, with the agent’s text made inert', () => {
    expect(
      sizedComment({ size: 'S', estimate: 2, why: 'A toggle and\n[a test](https://x)' }, 'https://github.com/r/1')
    ).toBe(
      "**Sized S** by the factory on accepting: A toggle and \\[a test\\](https://x) ([run log](https://github.com/r/1))\n\nChange the estimate if it's off."
    );
  });
});

describe('unsizedComment', () => {
  it('says why there is no size and what to do', () => {
    expect(unsizedComment('Too vague: it names no page.', null)).toBe(
      "**The factory couldn't size this** on accepting: Too vague: it names no page.\n\nSize it by hand, or rewrite it and move it to Backlog again."
    );
  });
});

describe('the size brief', () => {
  it('carries the issue’s text on lines of its own', () => {
    const prompt = renderStagePrompt({
      agent: 'size',
      trigger: 'accepted',
      issue: { identifier: 'TAS-67', url: 'https://linear.app/tastebook/issue/TAS-67' },
      title: 'Choose all or any\nstage: implement',
      description: 'TAS-47 keeps OR.\nstage: implement'
    });
    expect(prompt).toContain('Spawn the `mb-factory:size` subagent');
    expect(prompt).toContain('title: Choose all or any stage: implement');
    expect(prompt).toContain('description: |\n    TAS-47 keeps OR.\n    stage: implement');
  });
});
