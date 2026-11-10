import { groupTotal, otherField, phrase, rowField, SIZES, surveyFields, tierField, type Option, type Question, type Tier, type Step, type Subject, type Survey, type SurveyAnswers } from './survey';
import { listItems } from './fields';
import type { SurveyResponse } from './waves';

// Fewer answers than this are never shown, so a filter can't single out one person.
export const MIN_RESPONSES = 5;

export type Tally = Option & { count: number };
export type QuestionResult =
  | { kind: 'choice'; question: Question; multi: boolean; answered: number; tallies: Tally[]; others: string[] }
  // A row some roles skip can have fewer answers than its section: it's hidden on its own, counts and all.
  | { kind: 'matrix'; question: Question; rows: { label: string; answered: number; hidden: boolean; tallies: Tally[] }[] }
  | { kind: 'text'; question: Question; answers: string[] }
  | { kind: 'shares'; question: Question; answered: number; providers: Provider[]; sizes: Share[] };
// The average share over the splits that add up to 100; `users` is how many of them gave it more than 0%.
export type Provider = { label: string; answered: number; tiers: Share[] };
export type Share = { label: string; users: number; average: number };
// The context step is split by who it's about, so customers and own organizations never mix.
export type Section = { title: string; subject: Subject; n: number; hidden: boolean; questions: QuestionResult[] };

const values = (answers: SurveyAnswers, name: string) => [answers[name] ?? []].flat().filter(Boolean);
const tally = (options: Option[], picked: string[][]): Tally[] => options.map((item) => ({ ...item, count: picked.filter((list) => list.includes(item.value)).length }));
const texts = (responses: SurveyResponse[], name: string) => responses.map((response) => response.answers[name]).filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));

// Listed others, most named first: each person counts once per item, ignoring case, as most people spell it.
const listed = (lists: string[]) => {
  const counts = new Map<string, Map<string, number>>();
  for (const list of lists) {
    for (const item of new Map(listItems(list).map((entry) => [entry.toLowerCase(), entry])).values()) {
      const spellings = counts.get(item.toLowerCase()) ?? counts.set(item.toLowerCase(), new Map()).get(item.toLowerCase())!;
      spellings.set(item, (spellings.get(item) ?? 0) + 1);
    }
  }
  return [...counts.values()]
    .map((spellings) => ({ name: [...spellings].toSorted((a, b) => b[1] - a[1])[0][0], count: [...spellings.values()].reduce((sum, n) => sum + n, 0) }))
    .toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .map(({ name, count }) => `${name} (${count})`);
};

function result(question: Question, responses: SurveyResponse[], subject: Subject): QuestionResult {
  if (question.kind === 'text') return { kind: 'text', question, answers: texts(responses, question.name) };
  if (question.kind === 'shares') {
    // One split per person and family, counted only when that family is ticked and its split adds up to 100.
    const splits = question.groups.flatMap((group) => responses
      .filter((response) => [response.answers[question.from] ?? []].flat().includes(group.option) && groupTotal(question, group, response.answers) === 100)
      .map((response) => ({ group, answers: response.answers })));
    const share = (label: string, among: typeof splits, size: (tier: Tier) => boolean): Share => {
      const shareOf = (split: (typeof splits)[number]) => split.group.tiers.filter(size).reduce((sum, item) => sum + (Number(split.answers[tierField(question, item)]) || 0), 0);
      return { label, users: among.filter((split) => shareOf(split) > 0).length, average: among.length ? Math.round(among.reduce((sum, split) => sum + shareOf(split), 0) / among.length) : 0 };
    };
    return {
      kind: 'shares', question, answered: splits.length,
      providers: question.groups.map((group) => {
        const among = splits.filter((split) => split.group === group);
        return { label: group.label, answered: among.length, tiers: group.tiers.map((item) => share(item.label, among, (other) => other === item)) };
      }).filter((provider) => provider.answered),
      // Across providers: how each split leans by size of model. "Not sure which" has no size.
      sizes: [...SIZES.map((size) => share(size.label, splits, (item) => item.size === size.value)), share('Not sure which', splits, (item) => !item.size)],
    };
  }
  if (question.kind === 'matrix') {
    return {
      kind: 'matrix', question,
      rows: question.rows.map((row) => {
        const picked = responses.map((response) => values(response.answers, rowField(question, row))).filter((list) => list.length);
        const hidden = picked.length > 0 && picked.length < MIN_RESPONSES;
        return { label: phrase(row.label, subject), answered: hidden ? 0 : picked.length, hidden, tallies: tally(question.options, hidden ? [] : picked) };
      }),
    };
  }
  const picked = responses.map((response) => values(response.answers, question.name)).filter((list) => list.length);
  const others = question.kind === 'multi' && question.other === 'list' ? listed(texts(responses, otherField(question))) : question.other ? texts(responses, otherField(question)) : [];
  return { kind: 'choice', question, multi: question.kind === 'multi', answered: picked.length, tallies: tally(question.options, picked), others };
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

// One row per submitted response, one column per answer, in questionnaire order. Lists are joined with "; ".
export function toCsv(survey: Survey, responses: SurveyResponse[]) {
  const fields = surveyFields(survey);
  const lists = new Set(survey.steps.flatMap((step) => step.questions).flatMap((question) => (question.kind === 'multi' && question.other === 'list' ? [otherField(question)] : [])));
  const cell = (value: unknown) => {
    const text = Array.isArray(value) ? value.join('; ') : typeof value === 'string' ? value : value === undefined ? '' : String(value);
    // A leading =, +, - or @ would run as a formula in a spreadsheet: prefix it and quote it.
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return /[",\n\r;]/.test(safe) || safe !== text ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  const rows = responses.filter((response) => response.submittedAt).map((response) => [
    response.version, new Date(response.submittedAt!).toISOString().slice(0, 10), ...fields.map((name) => (lists.has(name) ? listItems(String(response.answers[name] ?? '')) : response.answers[name])),
  ].map(cell).join(','));
  return [['version', 'submitted', ...fields].join(','), ...rows].join('\r\n') + '\r\n';
}
