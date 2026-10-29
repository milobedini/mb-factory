import { z } from 'zod';

import type { RunRequest } from './router';
import type { Size } from './sizes';
import { SIZES } from './sizes';
import type { AgentRole } from './stages';

// How an answer was given: an option tapped (or typed exactly), the human's own words, or the suggested default.
export const ANSWER_SOURCES = ['option', 'text', 'default'] as const;

export type AnswerSource = (typeof ANSWER_SOURCES)[number];

export const MAX_QUESTIONS = 10;
const MAX_OPTIONS = 4;
const MAX_OPTION_LENGTH = 80;
const MAX_PROMPT_LENGTH = 1000;
const MAX_TOPIC_LENGTH = 60;
const MAX_WHY_LENGTH = 600;
const MAX_ANSWER_LENGTH = 2000;

export const FOR_ALL = 'Use the defaults for all';
export const FOR_THE_REST = 'Use the defaults for the rest';
// Marks the suggested option in a select; a tap sends the label back with it, so replies are read without it.
export const RECOMMENDED = '(R) ';
const RECOMMENDED_MARK = /^\(r\)\s*/;
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
    // A few words naming the decision, for the list of questions still to come.
    topic: z.string().trim().min(1).max(MAX_TOPIC_LENGTH).nullish().catch(null),
    // Why it matters or what it trades off, shown smaller under the question.
    why: z.string().trim().min(1).max(MAX_WHY_LENGTH).nullish().catch(null),
    options: z.array(z.string().trim().min(1).max(MAX_OPTION_LENGTH)).min(2).max(MAX_OPTIONS),
    suggested: z.string().trim().nullish(),
    // A review's question only: the option that leaves the PR as it is.
    keep: z.string().trim().nullish(),
    // A review's question only: the option that re-runs the PR's failed checks, such as a flaky job's.
    rerun: z.string().trim().nullish(),
    // A review's question only: the issue to file when the answer is `option`, which defers work to it.
    followUp: z
      .object({
        option: z.string().trim().min(1),
        title: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(2000),
        size: z.enum(SIZES).nullish().catch(null)
      })
      .nullish()
      .catch(null)
  })
  .refine(({ options }) => new Set(options.map(normalise)).size === options.length, {
    message: 'options must be distinct'
  })
  .refine(({ options }) => options.every((option) => !DEFAULTS_REPLIES.includes(normalise(option))), {
    message: 'an option reads as the defaults shortcut'
  });

// The issue a review question's option defers work to, filed in Triage when that option is the answer.
export type FollowUp = { option: string; title: string; body: string; size?: Size | null };

// A question as the router asks it: the suggested option first. `keep` is the option, if any, that needs no change.
export type Question = {
  prompt: string;
  topic: string | null;
  why: string | null;
  options: string[];
  keep: string | null;
  rerun?: string;
  followUp?: FollowUp;
};

const reportQuestionsSchema = z.looseObject({ questions: z.array(z.unknown()).nullish() });

// A follow-up counts only when its option is one of the question's.
const followUpFor = (
  followUp: FollowUp | null | undefined,
  named: (wanted: string) => string | undefined
): { followUp?: FollowUp } => {
  const option = followUp && named(followUp.option);
  return followUp && option ? { followUp: { ...followUp, option } } : {};
};

// The questions a stage reported, each read on its own: one malformed question doesn't hide the rest. A suggestion
// that names no option falls back to the first.
export const readQuestions = (report: unknown): Question[] =>
  (reportQuestionsSchema.safeParse(report).data?.questions ?? [])
    .flatMap((question) => {
      const read = questionSchema.safeParse(question);
      if (!read.success) {
        return [];
      }
      const { prompt, topic, why, options, suggested, keep, rerun, followUp } = read.data;
      const named = (wanted: string | null | undefined) =>
        options.find((option) => wanted && normalise(option) === normalise(wanted));
      const first = named(suggested) ?? options[0];
      const rerunOption = named(rerun);
      return first
        ? [
            {
              prompt,
              topic: topic ?? null,
              why: why ?? null,
              options: [first, ...options.filter((option) => option !== first)],
              keep: named(keep) ?? null,
              ...(rerunOption ? { rerun: rerunOption } : {}),
              ...followUpFor(followUp, named)
            }
          ]
        : [];
    })
    .slice(0, MAX_QUESTIONS);

// As asked and stored: `keep`, `rerun` and `followUp` stay in the review's report, read back when the round is answered.
export type PositionedQuestion = Omit<Question, 'keep' | 'rerun' | 'followUp'> & { position: number };

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

export const topicOf = ({ topic, prompt }: Pick<Question, 'topic' | 'prompt'>): string => {
  const flat = oneLine(topic ?? prompt);
  return flat.length > MAX_TOPIC_LENGTH ? `${flat.slice(0, MAX_TOPIC_LENGTH)}…` : flat;
};

export const laterThan = (question: PositionedQuestion, round: PositionedQuestion[]): PositionedQuestion[] =>
  round.filter(({ position }) => position > question.position).toSorted((a, b) => a.position - b.position);

// What the router posts for one question: a Linear select, suggested option first. While more questions follow, it
// lists them with their suggestions, so the defaults shortcut is an informed choice; on the last question the
// shortcut would only repeat the suggestion.
export const questionElicitation = (
  question: PositionedQuestion,
  round: PositionedQuestion[]
): { body: string; options: string[] } => {
  const total = round.length;
  const later = laterThan(question, round);
  const heading = total > 1 ? `Question ${question.position} of ${total}: ` : '';
  const shortcut = question.position === 1 ? FOR_ALL : FOR_THE_REST;
  const upcoming =
    later.length > 0
      ? [
          '',
          'Still to come, with my suggestions:',
          ...later.map((next) => `${next.position}. ${topicOf(next)} → ${next.options[0]}`),
          '',
          `${shortcut} takes my suggestion here and for each of these.`
        ]
      : [];
  return {
    body: [
      `${heading}${question.prompt}`,
      ...(question.why ? ['', question.why] : []),
      '',
      `Suggested: ${question.options[0]}. Pick an option, or reply in your own words.`,
      ...upcoming
    ].join('\n'),
    options: [
      ...question.options.map((option, index) => (index === 0 ? `${RECOMMENDED}${option}` : option)),
      ...(later.length > 0 ? [shortcut] : [])
    ]
  };
};

export type AskedQuestion = PositionedQuestion & {
  id: string;
  answer: string | null;
  answerSource: AnswerSource | null;
};

export type AnswerUpdate = { id: string; answer: string; answerSource: AnswerSource };

export type AnswerResult = { answered: AnswerUpdate[]; next: AskedQuestion | undefined };

const clipAnswer = (text: string): string =>
  text.length > MAX_ANSWER_LENGTH ? `${text.slice(0, MAX_ANSWER_LENGTH)}…` : text;

export const byPosition = (questions: AskedQuestion[]): AskedQuestion[] =>
  questions.toSorted((a, b) => a.position - b.position);

// A reply answers the first open question: an option by its label, the defaults shortcut for it and every later one,
// or anything else in the human's own words. Undefined when nothing is open.
export const applyAnswer = (round: AskedQuestion[], body: string): AnswerResult | undefined => {
  const open = byPosition(round).filter(({ answer }) => answer === null);
  const [current, ...rest] = open;
  if (!current) {
    return undefined;
  }
  const reply = normalise(body).replace(RECOMMENDED_MARK, '');
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

// A review's questions settle findings that need a human. Answers that all keep the PR as it is need no run; any other
// answer is a change for the implement stage, which the next review round then checks.
export type AfterAnswers = { kind: 'run'; request: RunRequest } | { kind: 'keep' };

export const afterAnswers = (agent: AgentRole, round: AskedQuestion[], reported: Question[]): AfterAnswers => {
  if (agent !== 'review') {
    return { kind: 'run', request: answeredRequest(agent, round) };
  }
  const keeps = byPosition(round).every(({ position, answer }) => {
    const keep = reported[position - 1]?.keep;
    return keep !== null && keep !== undefined && answer !== null && normalise(answer) === normalise(keep);
  });
  return keeps
    ? { kind: 'keep' }
    : {
        kind: 'run',
        request: {
          agent: 'implement',
          trigger: 'answered',
          priority: 'in_flight',
          prompt: [
            'The human decided the findings the review left for them. Make the change each answer asks for, leave the PR as it is where an answer says so, and answer each in one PR comment.',
            answersPrompt(round)
          ].join('\n')
        }
      };
};

export type ChosenFollowUp = FollowUp & { prompt: string };

// The follow-ups a review round's answers chose: each question whose answer is the option that defers work.
export const chosenFollowUps = (round: AskedQuestion[], reported: Question[]): ChosenFollowUp[] =>
  byPosition(round).flatMap(({ position, prompt, answer }) => {
    const followUp = reported[position - 1]?.followUp;
    return followUp && answer !== null && normalise(answer) === normalise(followUp.option)
      ? [{ ...followUp, prompt }]
      : [];
  });

// Whether a review round's answers chose to re-run the PR's failed checks.
export const choseRerun = (round: AskedQuestion[], reported: Question[]): boolean =>
  byPosition(round).some(({ position, answer }) => {
    const rerun = reported[position - 1]?.rerun;
    return rerun !== undefined && answer !== null && normalise(answer) === normalise(rerun);
  });

// The decisions as a PR comment and a thread reply, when every answer kept the PR as it is.
export const keptText = (round: AskedQuestion[], by: string): string =>
  [
    `Decided ${by}: the PR stays as it is.`,
    ...byPosition(round).map(
      ({ position, prompt, answer }) => `${position}. ${oneLine(prompt)} → ${oneLine(answer ?? '')}`
    )
  ].join('\n');
