import { z } from 'zod';

import type { RunRequest } from './router';
import type { AgentRole } from './stages';

// How an answer was given: an option tapped (or typed exactly), the human's own words, or the suggested default.
export const ANSWER_SOURCES = ['option', 'text', 'default'] as const;

export type AnswerSource = (typeof ANSWER_SOURCES)[number];

export const MAX_QUESTIONS = 10;
const MAX_OPTIONS = 4;
const MAX_OPTION_LENGTH = 80;
const MAX_PROMPT_LENGTH = 1000;
const MAX_ANSWER_LENGTH = 2000;

const FOR_ALL = 'Use the defaults for all';
const FOR_THE_REST = 'Use the defaults for the rest';
const DEFAULTS_REPLIES = [FOR_ALL, FOR_THE_REST, 'use the defaults', 'use defaults', 'defaults'].map((reply) =>
  reply.toLowerCase()
);

const normalise = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[.!\s]+$/, '');

const questionSchema = z
  .looseObject({
    prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
    options: z.array(z.string().trim().min(1).max(MAX_OPTION_LENGTH)).min(2).max(MAX_OPTIONS),
    suggested: z.string().trim().nullish()
  })
  .refine(({ options }) => new Set(options.map(normalise)).size === options.length, {
    message: 'options must be distinct'
  })
  .refine(({ options }) => options.every((option) => !DEFAULTS_REPLIES.includes(normalise(option))), {
    message: 'an option reads as the defaults shortcut'
  });

// A question as the router asks it: the suggested option first.
export type Question = { prompt: string; options: string[] };

const reportQuestionsSchema = z.looseObject({ questions: z.array(z.unknown()).nullish() });

// The questions a stage reported, each read on its own: one malformed question doesn't hide the rest. A suggestion
// that names no option falls back to the first.
export const readQuestions = (report: unknown): Question[] =>
  (reportQuestionsSchema.safeParse(report).data?.questions ?? [])
    .flatMap((question) => {
      const read = questionSchema.safeParse(question);
      if (!read.success) {
        return [];
      }
      const { prompt, options, suggested } = read.data;
      const first = options.find((option) => suggested && normalise(option) === normalise(suggested)) ?? options[0];
      return first ? [{ prompt, options: [first, ...options.filter((option) => option !== first)] }] : [];
    })
    .slice(0, MAX_QUESTIONS);

// What the router posts for one question: a Linear select, suggested option first. The defaults shortcut appears
// while at least one more question follows; on the last it would only repeat the suggestion.
export const questionElicitation = (
  question: Question,
  position: number,
  total: number
): { body: string; options: string[] } => {
  const heading = total > 1 ? `Question ${position} of ${total}: ` : '';
  const shortcut = position < total ? [position === 1 ? FOR_ALL : FOR_THE_REST] : [];
  return {
    body: `${heading}${question.prompt}\n\nSuggested: ${question.options[0]}. Pick an option, or reply in your own words.`,
    options: [...question.options, ...shortcut]
  };
};

export type AskedQuestion = Question & {
  id: string;
  position: number;
  answer: string | null;
  answerSource: AnswerSource | null;
};

export type AnswerUpdate = { id: string; answer: string; answerSource: AnswerSource };

export type AnswerResult = { answered: AnswerUpdate[]; next: AskedQuestion | undefined };

const clipAnswer = (text: string): string =>
  text.length > MAX_ANSWER_LENGTH ? `${text.slice(0, MAX_ANSWER_LENGTH)}…` : text;

const byPosition = (questions: AskedQuestion[]): AskedQuestion[] =>
  questions.toSorted((a, b) => a.position - b.position);

// A reply answers the first open question: an option by its label, the defaults shortcut for it and every later one,
// or anything else in the human's own words. Undefined when nothing is open.
export const applyAnswer = (round: AskedQuestion[], body: string): AnswerResult | undefined => {
  const open = byPosition(round).filter(({ answer }) => answer === null);
  const [current, ...rest] = open;
  if (!current) {
    return undefined;
  }
  const reply = normalise(body);
  if (DEFAULTS_REPLIES.includes(reply)) {
    return {
      answered: open.map(({ id, options }) => ({ id, answer: options[0] ?? '', answerSource: 'default' })),
      next: undefined
    };
  }
  const option = current.options.find((label) => normalise(label) === reply);
  const answered: AnswerUpdate = option
    ? { id: current.id, answer: option, answerSource: 'option' }
    : { id: current.id, answer: clipAnswer(body.trim()), answerSource: 'text' };
  return { answered: [answered], next: rest[0] };
};

const SOURCE_COPY: Record<AnswerSource, string> = {
  option: 'picked',
  text: 'in their own words',
  default: 'your default'
};

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

// The answered run's prompt: every question with its answer, in the order asked.
export const answersPrompt = (round: AskedQuestion[]): string =>
  [
    'The human answered your questions:',
    ...byPosition(round).map(({ position, prompt, answer, answerSource }) => {
      const how = answerSource ? ` (${SOURCE_COPY[answerSource]})` : '';
      return `${position}. ${oneLine(prompt)}\n   Answer: ${oneLine(answer ?? 'no answer')}${how}`;
    }),
    'A question you reported that isn’t listed here wasn’t asked: go with your suggestion and record it as an assumption.'
  ].join('\n');

// The stage that asked runs again, once, with every answer.
export const answeredRequest = (agent: AgentRole, round: AskedQuestion[]): RunRequest => ({
  agent,
  trigger: 'answered',
  priority: 'in_flight',
  prompt: answersPrompt(round)
});

const escapeSlack = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The question as it appears in the work item's thread, until the thread can answer it itself.
export const slackQuestionText = (question: Question, position: number, total: number, issueUrl: string): string => {
  const heading = total > 1 ? `Question ${position} of ${total}` : 'Question';
  const [suggested, ...others] = question.options.map(escapeSlack);
  return [
    `${heading}: ${escapeSlack(oneLine(question.prompt))}`,
    `Suggested: ${suggested}${others.length > 0 ? `. Or: ${others.join(' · ')}` : ''}.`,
    `<${issueUrl}|Answer in Linear>`
  ].join(' ');
};
