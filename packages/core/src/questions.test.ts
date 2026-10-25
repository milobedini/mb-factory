import { describe, expect, it } from 'vitest';

import type { AskedQuestion } from './questions';
import {
  answeredRequest,
  answersPrompt,
  applyAnswer,
  MAX_QUESTIONS,
  questionElicitation,
  readQuestions,
  slackQuestionText
} from './questions';

const storage = {
  prompt: 'Where should images live?',
  options: ['Local disk', 'Vercel Blob', 'S3'],
  suggested: 'Vercel Blob'
};

const asked = (position: number, overrides: Partial<AskedQuestion> = {}): AskedQuestion => ({
  id: `q${position}`,
  position,
  prompt: `Question ${position}?`,
  topic: null,
  options: [`Yes ${position}`, `No ${position}`],
  answer: null,
  answerSource: null,
  ...overrides
});

describe('readQuestions', () => {
  it('puts the suggested option first', () => {
    expect(readQuestions({ questions: [storage] })).toEqual([
      { prompt: 'Where should images live?', topic: null, options: ['Vercel Blob', 'Local disk', 'S3'] }
    ]);
  });

  it('keeps a topic, and drops only the topic when it’s too long', () => {
    expect(readQuestions({ questions: [{ ...storage, topic: ' Image storage ' }] })[0]?.topic).toBe('Image storage');
    expect(readQuestions({ questions: [{ ...storage, topic: 'x'.repeat(61) }] })[0]?.topic).toBeNull();
  });

  it('matches the suggestion loosely and falls back to the first option', () => {
    expect(readQuestions({ questions: [{ ...storage, suggested: 'vercel blob.' }] })[0]?.options[0]).toBe(
      'Vercel Blob'
    );
    expect(readQuestions({ questions: [{ ...storage, suggested: 'GCS' }] })[0]?.options[0]).toBe('Local disk');
    expect(readQuestions({ questions: [{ ...storage, suggested: undefined }] })[0]?.options[0]).toBe('Local disk');
  });

  it('drops malformed questions and keeps the rest', () => {
    const questions = [
      { prompt: 'One option only?', options: ['Yes'] },
      { prompt: 'Five options?', options: ['A', 'B', 'C', 'D', 'E'] },
      { prompt: 'Repeated?', options: ['Yes', 'yes'] },
      { prompt: 'Shortcut as an option?', options: ['Use the defaults', 'No'] },
      { prompt: '', options: ['A', 'B'] },
      'not a question',
      storage
    ];
    expect(readQuestions({ questions }).map(({ prompt }) => prompt)).toEqual(['Where should images live?']);
  });

  it('reads nothing from a report without questions', () => {
    expect(readQuestions({ outcome: 'needs_input' })).toEqual([]);
    expect(readQuestions({ questions: null })).toEqual([]);
    expect(readQuestions(undefined)).toEqual([]);
  });

  it('keeps at most the limit', () => {
    expect(readQuestions({ questions: Array.from({ length: 12 }, () => storage) })).toHaveLength(MAX_QUESTIONS);
  });
});

describe('questionElicitation', () => {
  const round = [
    {
      position: 1,
      prompt: 'Where should images live?',
      topic: 'Image storage',
      options: ['Vercel Blob', 'Local disk']
    },
    {
      position: 2,
      prompt: 'A long question about the address of each recipe page?',
      topic: null,
      options: ['ID', 'Slug']
    },
    { position: 3, prompt: 'Cache them?', topic: 'Caching', options: ['Yes', 'No'] }
  ];
  const [first, second, third] = round;

  it('lists what’s still to come with its suggestions, and offers the defaults for all', () => {
    expect(first && questionElicitation(first, round)).toEqual({
      body: [
        'Question 1 of 3: Where should images live?',
        '',
        'Suggested: Vercel Blob. Pick an option, or reply in your own words.',
        '',
        'Still to come, with my suggestions:',
        '2. A long question about the address of each recipe page? → ID',
        '3. Caching → Yes',
        '',
        'Use the defaults for all takes my suggestion here and for each of these.'
      ].join('\n'),
      options: ['Vercel Blob (R)', 'Local disk', 'Use the defaults for all']
    });
  });

  it('lists only later questions, and offers the defaults for the rest', () => {
    const asked = second && questionElicitation(second, round);
    expect(asked?.body).toContain('3. Caching → Yes');
    expect(asked?.body).not.toContain('Image storage');
    expect(asked?.options.at(-1)).toBe('Use the defaults for the rest');
  });

  it('falls back to the clipped prompt when a question has no topic', () => {
    const long = { position: 2, prompt: 'x'.repeat(100), topic: null, options: ['A', 'B'] };
    expect(first && questionElicitation(first, [first, long]).body).toContain(`2. ${'x'.repeat(60)}… → A`);
  });

  it('offers no shortcut or list on the last question, and no numbering on a single one', () => {
    expect(third && questionElicitation(third, round)).toEqual({
      body: 'Question 3 of 3: Cache them?\n\nSuggested: Yes. Pick an option, or reply in your own words.',
      options: ['Yes (R)', 'No']
    });
    expect(first && questionElicitation(first, [first]).body).toMatch(/^Where should images live\?/);
  });
});

describe('applyAnswer', () => {
  it('reads a tapped option as that option', () => {
    expect(applyAnswer([asked(1), asked(2)], 'Yes 1')).toEqual({
      answered: [{ id: 'q1', answer: 'Yes 1', answerSource: 'option' }],
      next: asked(2)
    });
  });

  it('matches a typed option regardless of case and trailing punctuation', () => {
    expect(applyAnswer([asked(1)], ' no 1. ')?.answered).toEqual([
      { id: 'q1', answer: 'No 1', answerSource: 'option' }
    ]);
  });

  it('reads the recommended option’s tap without its mark, and stores the option as given', () => {
    expect(applyAnswer([asked(1)], 'Yes 1 (R)')?.answered).toEqual([
      { id: 'q1', answer: 'Yes 1', answerSource: 'option' }
    ]);
  });

  it('records anything else in the human’s own words', () => {
    expect(applyAnswer([asked(1)], '  Neither: use the CDN  ')).toEqual({
      answered: [{ id: 'q1', answer: 'Neither: use the CDN', answerSource: 'text' }],
      next: undefined
    });
  });

  it('answers the first open question, by position', () => {
    const round = [asked(2), asked(1, { answer: 'Yes 1', answerSource: 'option' }), asked(3)];
    expect(applyAnswer(round, 'No 2')).toEqual({
      answered: [{ id: 'q2', answer: 'No 2', answerSource: 'option' }],
      next: asked(3)
    });
  });

  it('takes the defaults for the current and every later question', () => {
    const round = [asked(1, { answer: 'No 1', answerSource: 'option' }), asked(2), asked(3)];
    expect(applyAnswer(round, 'Use the defaults for the rest')).toEqual({
      answered: [
        { id: 'q2', answer: 'Yes 2', answerSource: 'default' },
        { id: 'q3', answer: 'Yes 3', answerSource: 'default' }
      ],
      next: undefined
    });
    expect(applyAnswer([asked(1), asked(2)], 'use the defaults for all')?.answered).toHaveLength(2);
    expect(applyAnswer([asked(1)], 'Defaults.')?.answered).toEqual([
      { id: 'q1', answer: 'Yes 1', answerSource: 'default' }
    ]);
  });

  it('has nothing to answer once every question is answered', () => {
    expect(applyAnswer([asked(1, { answer: 'Yes 1', answerSource: 'option' })], 'Yes')).toBeUndefined();
  });

  it('clips a very long answer', () => {
    expect(applyAnswer([asked(1)], 'x'.repeat(3000))?.answered[0]?.answer).toHaveLength(2001);
  });
});

describe('answersPrompt', () => {
  it('lists every question with its answer and how it was given, in order', () => {
    const round = [
      asked(2, { prompt: 'Second\nquestion?', answer: 'In my\nwords', answerSource: 'text' }),
      asked(1, { answer: 'Yes 1', answerSource: 'option' }),
      asked(3, { answer: 'Yes 3', answerSource: 'default' })
    ];
    expect(answersPrompt(round)).toBe(
      [
        'The human answered your questions:',
        '1. Question 1?\n   Answer: Yes 1 (picked)',
        '2. Second question?\n   Answer: In my words (in their own words)',
        '3. Question 3?\n   Answer: Yes 3 (your default)',
        'A question you reported that isn’t listed here wasn’t asked: go with your suggestion and record it as an assumption.'
      ].join('\n')
    );
  });

  it('becomes the brief of an answered run for the stage that asked', () => {
    const round = [asked(1, { answer: 'Yes 1', answerSource: 'option' })];
    expect(answeredRequest('spec', round)).toEqual({
      agent: 'spec',
      trigger: 'answered',
      priority: 'in_flight',
      prompt: answersPrompt(round)
    });
  });
});

describe('slackQuestionText', () => {
  it('shows the question, the suggestion, the alternatives and what follows, escaped, with a link to answer', () => {
    const round = [
      { position: 1, prompt: 'Earlier?', topic: null, options: ['A', 'B'] },
      { position: 2, prompt: 'Store <img> tags?', topic: null, options: ['Yes', 'No & strip'] },
      { position: 3, prompt: 'Sizes?', topic: 'Image <sizes>', options: ['Small', 'Large'] }
    ];
    expect(round[1] && slackQuestionText(round[1], round, 'https://linear.app/t/TAS-1')).toBe(
      'Question 2 of 3: Store &lt;img&gt; tags? Suggested: Yes. Or: No &amp; strip. Then, as suggested: 3. Image &lt;sizes&gt; (Small). <https://linear.app/t/TAS-1|Answer in Linear>'
    );
  });
});
