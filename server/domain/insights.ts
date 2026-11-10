import { answersOf, DIMENSIONS, gridField, hasAnswers, LEVELS, listItems, QUESTIONS, REFLECTIONS, withLegacyGrid, type Fields } from './fields';
import type { Group } from './groups';
import { sourceOf, type Sheet } from './sheets';
import { surveyFor } from './survey';
import { MIN_RESPONSES } from './surveyResults';
import type { SurveyResponse, Wave } from './waves';

// A group's qualitative answers in one place, for reading on screen and for an LLM outside the app: interviews and
// self-submitted maps per person, then the survey's free text per wave. People are numbered per export, never named:
// no name, interviewer, private notes or ids. Blank answers, and sheets without respondent answers, are left out.
export type Answer = { label?: string; text: string } | { label?: string; items: string[] };
export type Part = { title: string; answers: Answer[] };
export type Person = { title: string; parts: Part[] };
export type WaveText = { name: string; version: number; status: Wave['status']; n: number; hidden: boolean; questions: { prompt: string; answers: string[] }[] };
export type Insights = { group: Group | null; exportedAt: number; interviews: Person[]; maps: Person[]; waves: WaveText[] };

export const GOOD_LABEL = 'What really good looks like, to you';
export const TOOLS_LABEL = 'Tools and techniques they use';
export const CONTEXT_LABEL = 'Client, domain, team';

const text = (fields: Fields, name: string) => (typeof fields[name] === 'string' ? (fields[name] as string).trim() : '');
const part = (title: string, answers: (Answer | null)[]): Part[] => {
  const kept = answers.filter((answer): answer is Answer => Boolean(answer));
  return kept.length ? [{ title, answers: kept }] : [];
};
const said = (label: string | undefined, value: string): Answer | null => (value ? { label, text: value } : null);

// In the sheet's order: who (interviews only), what good looks like, tools, the three grids, the reflections.
function person(title: string, sheet: Sheet): Person {
  const fields = withLegacyGrid(sheet.fields);
  const disciplines = [...[fields.discipline ?? []].flat(), text(fields, 'discipline_other')].filter(Boolean);
  const about = sourceOf(sheet) === 'interview' ? part('About', [
    disciplines.length ? { label: 'Discipline', text: disciplines.join(', ') } : null,
    said('Date', text(fields, 'date')),
    said(CONTEXT_LABEL, text(fields, 'context')),
  ]) : [];
  const tools = listItems(text(fields, 'tools'));
  return {
    title,
    parts: [
      ...about,
      ...part(GOOD_LABEL, [said(undefined, text(fields, 'good'))]),
      ...part(TOOLS_LABEL, [tools.length ? { items: tools } : null]),
      ...DIMENSIONS.flatMap((dimension) => part(dimension.name, LEVELS.flatMap((level) => QUESTIONS.map((question) =>
        said(`${level.name} · ${question.name}`, text(fields, gridField(dimension.key, question.key, level.key))))))),
      ...part('Reflections', REFLECTIONS.map((reflection) => said(reflection.label, text(fields, reflection.name)))),
    ],
  };
}

const people = (sheets: Sheet[], noun: string) => sheets
  .filter((sheet) => hasAnswers(answersOf(withLegacyGrid(sheet.fields))))
  .toSorted((a, b) => a.createdAt - b.createdAt)
  .map((sheet, i) => person(`${noun} ${i + 1}`, sheet));

// Only submitted responses, and only the survey's free-text questions. A wave under MIN_RESPONSES keeps its count
// but not its text: a few answers can say who wrote them.
function waveText(wave: Wave, responses: SurveyResponse[]): WaveText {
  const submitted = responses.filter((response) => response.submittedAt).toSorted((a, b) => a.createdAt - b.createdAt);
  const hidden = submitted.length < MIN_RESPONSES;
  const questions = surveyFor(wave.version).steps.flatMap((step) => step.questions).filter((question) => question.kind === 'text');
  return {
    name: wave.name, version: wave.version, status: wave.status, n: submitted.length, hidden,
    questions: hidden ? [] : questions.map((question) => ({
      prompt: question.prompt,
      answers: submitted.map((response) => response.answers[question.name]).filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim()),
    })),
  };
}

// `sheets` are the group's; `waves` its survey rounds with their responses (none without a group).
export function compileInsights({ group, sheets, waves, now = Date.now() }: {
  group: Group | null; sheets: Sheet[]; waves: { wave: Wave; responses: SurveyResponse[] }[]; now?: number;
}): Insights {
  return {
    group,
    exportedAt: now,
    interviews: people(sheets.filter((sheet) => sourceOf(sheet) === 'interview'), 'Interview'),
    maps: people(sheets.filter((sheet) => sourceOf(sheet) === 'self'), 'Self-submitted map'),
    waves: waves.toSorted((a, b) => a.wave.createdAt - b.wave.createdAt).map(({ wave, responses }) => waveText(wave, responses)),
  };
}
