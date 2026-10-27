import { describe, expect, it } from 'vitest';

import { filedFollowUpsText, followUpIssue } from './follow-ups';
import type { AskedQuestion } from './questions';
import { chosenFollowUps, readQuestions } from './questions';

// TAS-43's round 1, 27 Oct: "Ship as is, follow up" was chosen and nothing was filed.
const report = {
  questions: [
    {
      prompt: 'Should parmesan count as meat, so the page tells vegetarians to leave it out?',
      topic: 'Parmesan and animal rennet',
      options: ['Flag parmesan as meat', 'Ship as is, follow up', 'Hold the PR'],
      suggested: 'Flag parmesan as meat',
      keep: 'Ship as is, follow up',
      followUp: {
        option: 'ship as is, follow up',
        title: 'Count animal rennet against the vegetarian tag',
        body: 'Parmesan is made with calf rennet but is flagged dairy only.',
        size: 'S'
      }
    }
  ]
};

const asked = (answer: string | null): AskedQuestion[] => [
  {
    id: 'q1',
    position: 1,
    prompt: 'Should parmesan count as meat, so the page tells vegetarians to leave it out?',
    topic: 'Parmesan and animal rennet',
    why: null,
    options: ['Flag parmesan as meat', 'Ship as is, follow up', 'Hold the PR'],
    answer,
    answerSource: answer === null ? null : 'option'
  }
];

describe('review follow-ups', () => {
  it('reads a follow-up whose option is one of the question’s, as the option is written', () => {
    expect(readQuestions(report)[0]?.followUp).toEqual({
      option: 'Ship as is, follow up',
      title: 'Count animal rennet against the vegetarian tag',
      body: 'Parmesan is made with calf rennet but is flagged dairy only.',
      size: 'S'
    });
    const stray = {
      questions: [{ ...report.questions[0], followUp: { ...report.questions[0]?.followUp, option: 'Later' } }]
    };
    expect(readQuestions(stray)[0]?.followUp).toBeUndefined();
  });

  it('files one when its option is the answer, and none otherwise', () => {
    const reported = readQuestions(report);
    expect(chosenFollowUps(asked('Ship as is, follow up'), reported)).toEqual([
      expect.objectContaining({ title: 'Count animal rennet against the vegetarian tag' })
    ]);
    expect(chosenFollowUps(asked('ship as is, follow up.'), reported)).toHaveLength(1);
    expect(chosenFollowUps(asked('Flag parmesan as meat'), reported)).toEqual([]);
    expect(chosenFollowUps(asked(null), reported)).toEqual([]);
  });

  it('writes the issue with the decision that deferred it', () => {
    const [chosen] = chosenFollowUps(asked('Ship as is, follow up'), readQuestions(report));
    if (!chosen) {
      throw new Error('expected a follow-up');
    }
    const issue = followUpIssue(chosen, {
      issueIdentifier: 'TAS-43',
      issueUrl: 'https://linear.app/tastebook/issue/TAS-43',
      prUrl: 'https://github.com/milobedini/tastebook/pull/44',
      round: 1
    });
    expect(issue.title).toBe('Count animal rennet against the vegetarian tag');
    expect(issue.description).toBe(
      [
        'Parmesan is made with calf rennet but is flagged dairy only.',
        '',
        '---',
        '',
        "Decided in [TAS-43](https://linear.app/tastebook/issue/TAS-43)'s review, round 1 ([its PR](https://github.com/milobedini/tastebook/pull/44)): Should parmesan count as meat, so the page tells vegetarians to leave it out? → Ship as is, follow up."
      ].join('\n')
    );
    expect(issue.estimate).toBe(2);
    expect(
      followUpIssue({ ...chosen, size: null }, { issueIdentifier: 'TAS-43', issueUrl: null, prUrl: null, round: 1 })
        .estimate
    ).toBeNull();
  });

  it('says where the follow-ups were filed', () => {
    const filed = [{ identifier: 'TAS-61', url: 'https://linear.app/t/TAS-61', title: 'Rennet <and> cheese' }];
    expect(filedFollowUpsText(filed)).toBe(
      'Filed the follow-up in Triage: <https://linear.app/t/TAS-61|TAS-61> Rennet &lt;and&gt; cheese.'
    );
    expect(filedFollowUpsText(filed, 'markdown')).toMatch(
      /^Filed the follow-up in Triage: \[TAS-61\]\(https:\/\/linear.app\/t\/TAS-61\) /
    );
  });
});
