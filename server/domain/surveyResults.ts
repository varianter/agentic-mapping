import { otherField, phrase, rowField, type Option, type Question, type Step, type Subject, type Survey, type SurveyAnswers } from './survey';
import type { SurveyResponse } from './waves';

// Fewer answers than this are never shown, so a filter can't single out one person.
export const MIN_RESPONSES = 5;

export type Tally = Option & { count: number };
export type QuestionResult =
  | { kind: 'choice'; question: Question; multi: boolean; answered: number; tallies: Tally[]; others: string[] }
  | { kind: 'matrix'; question: Question; rows: { label: string; answered: number; tallies: Tally[] }[] }
  | { kind: 'text'; question: Question; answers: string[] };
// The context step is split by who it's about, so customers and own organizations never mix.
export type Section = { title: string; subject: Subject; n: number; hidden: boolean; questions: QuestionResult[] };

const values = (answers: SurveyAnswers, name: string) => [answers[name] ?? []].flat().filter(Boolean);
const tally = (options: Option[], picked: string[][]): Tally[] => options.map((item) => ({ ...item, count: picked.filter((list) => list.includes(item.value)).length }));
const texts = (responses: SurveyResponse[], name: string) => responses.map((response) => response.answers[name]).filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));

function result(question: Question, responses: SurveyResponse[], subject: Subject): QuestionResult {
  if (question.kind === 'text') return { kind: 'text', question, answers: texts(responses, question.name) };
  if (question.kind === 'matrix') {
    return {
      kind: 'matrix', question,
      rows: question.rows.map((row) => {
        const picked = responses.map((response) => values(response.answers, rowField(question, row))).filter((list) => list.length);
        return { label: phrase(row.label, subject), answered: picked.length, tallies: tally(question.options, picked) };
      }),
    };
  }
  const picked = responses.map((response) => values(response.answers, question.name)).filter((list) => list.length);
  return { kind: 'choice', question, multi: question.kind === 'multi', answered: picked.length, tallies: tally(question.options, picked), others: question.other ? texts(responses, otherField(question)) : [] };
}

const section = (step: Step, responses: SurveyResponse[], subject: Subject, title = phrase(step.title, subject)): Section => ({
  title, subject, n: responses.length, hidden: responses.length < MIN_RESPONSES, questions: step.questions.map((question) => result(question, responses, subject)),
});

// Submitted responses only, optionally one role's. Context questions are worded for who they're about.
export function summarize(survey: Survey, responses: SurveyResponse[], { role }: { role?: string } = {}) {
  const included = responses.filter((response) => response.submittedAt && (!role || response.answers.role === role));
  const about = (subject: Subject) => included.filter((response) => (response.answers.context === 'own' ? 'own' : 'customer') === subject);
  const sections = survey.steps.flatMap((step) => (step.key === 'context'
    ? [section(step, about('customer'), 'customer', 'About customers'), section(step, about('own'), 'own', 'About their own organization')]
    : [section(step, included, 'customer')]));
  return { n: included.length, hidden: included.length < MIN_RESPONSES, sections };
}

