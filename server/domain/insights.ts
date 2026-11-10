import type { Store } from '../store';
import { answersOf, DIMENSIONS, gridField, hasAnswers, LEVELS, listItems, QUESTIONS, REFLECTIONS, withLegacyGrid, type Fields } from './fields';
import type { Group } from './groups';
import { listSheets, sourceOf, type Sheet } from './sheets';
import { surveyFor } from './survey';
import { MIN_RESPONSES } from './surveyResults';
import { listResponses, listWaves, type SurveyResponse, type Wave } from './waves';

// A group's qualitative answers in one place, for reading on screen and for an LLM outside the app: interviews and
// self-submitted maps per person, then the survey's free text per wave. People are numbered per export, never named:
// no name, interviewer, private notes or ids. Blank answers, and sheets without respondent answers, are left out.
export type Answer = { label?: string; text: string } | { label?: string; items: string[] };
export type Part = { title: string; answers: Answer[] };
export type Person = { title: string; parts: Part[] };
export type WaveText = { name: string; version: number; status: Wave['status']; n: number; hidden: boolean; questions: { prompt: string; answers: string[] }[] };
// At a glance: how many people, which grid cells they answered (per dimension and level), the tools most listed.
export type Stats = { people: number; responses: number; coverage: { dimension: string; levels: { level: string; people: number }[] }[]; tools: { name: string; people: number }[] };
export type Insights = { group: Group | null; exportedAt: number; stats: Stats; interviews: Person[]; maps: Person[]; waves: WaveText[] };

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

const answered = (sheet: Sheet) => hasAnswers(answersOf(withLegacyGrid(sheet.fields)));
const people = (sheets: Sheet[], noun: string) => sheets
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

export const TOP_TOOLS = 5;

// Each person counts once per cell and once per tool (ignoring case, spelled as most people spell it).
function stats(sheets: Sheet[], waves: WaveText[]): Stats {
  const all = sheets.map((sheet) => withLegacyGrid(sheet.fields));
  const tools = new Map<string, { spellings: Map<string, number>; people: number }>();
  for (const fields of all) {
    const mine = new Map<string, string>();
    for (const name of listItems(text(fields, 'tools'))) if (!mine.has(name.toLowerCase())) mine.set(name.toLowerCase(), name);
    for (const [key, name] of mine) {
      const entry = tools.get(key) ?? tools.set(key, { spellings: new Map(), people: 0 }).get(key)!;
      entry.people += 1;
      entry.spellings.set(name, (entry.spellings.get(name) ?? 0) + 1);
    }
  }
  return {
    people: all.length,
    responses: waves.reduce((sum, wave) => sum + wave.n, 0),
    coverage: DIMENSIONS.map((dimension) => ({
      dimension: dimension.name,
      levels: LEVELS.map((level) => ({
        level: level.name,
        people: all.filter((fields) => QUESTIONS.some((question) => text(fields, gridField(dimension.key, question.key, level.key)))).length,
      })),
    })),
    tools: [...tools.values()]
      .map(({ spellings, people }) => ({ name: [...spellings].toSorted((a, b) => b[1] - a[1])[0][0], people }))
      .toSorted((a, b) => b.people - a.people || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
      .slice(0, TOP_TOOLS),
  };
}

// `sheets` are the group's; `waves` its survey rounds with their responses (none without a group).
export function compileInsights({ group, sheets, waves, now = Date.now() }: {
  group: Group | null; sheets: Sheet[]; waves: { wave: Wave; responses: SurveyResponse[] }[]; now?: number;
}): Insights {
  const kept = sheets.filter(answered);
  const texts = waves.toSorted((a, b) => a.wave.createdAt - b.wave.createdAt).map(({ wave, responses }) => waveText(wave, responses));
  return {
    group,
    exportedAt: now,
    stats: stats(kept, texts),
    interviews: people(kept.filter((sheet) => sourceOf(sheet) === 'interview'), 'Interview'),
    maps: people(kept.filter((sheet) => sourceOf(sheet) === 'self'), 'Self-submitted map'),
    waves: texts,
  };
}

export async function loadInsights(store: Store, group: Group | null) {
  const [sheets, waves] = await Promise.all([listSheets(store, { group: group?.slug ?? null }), group ? listWaves(store, group.slug) : []]);
  return compileInsights({ group, sheets, waves: await Promise.all(waves.map(async (wave) => ({ wave, responses: await listResponses(store, wave.id) }))) });
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const day = (time: number) => new Date(time).toISOString().slice(0, 10);
export const groupLabel = (group: Group | null) => group?.name ?? 'No group';
export const insightsFileName = (insights: Insights) => `${insights.group?.slug ?? 'no-group'}-insights-${day(insights.exportedAt)}.md`;
export const tooFewText = `Hidden: fewer than ${MIN_RESPONSES} submitted responses, so nobody can be singled out.`;
export const waveMeta = (wave: WaveText) => `${wave.status === 'open' ? 'Open' : 'Closed'} wave, questionnaire v${wave.version}, ${plural(wave.n, 'submitted response')}`;

// What the file holds and how to read it, built from the field tables so it never drifts from the sheet.
export function preamble(insights: Insights) {
  const surveys = insights.group ? ' The file ends with the free-text answers to the group’s anonymous survey.' : '';
  return {
    intro: `Qualitative answers from agentic mapping in ${groupLabel(insights.group)}: what people had to learn to work well with AI agents, why it matters and how they found out. Interviews are short sessions an interviewer captured; self-submitted maps are the same sheet filled in by people on their own.${surveys}`,
    layout: 'Each person’s answers are in the sheet’s order: what really good looks like to them, the tools they use, a 3 × 3 grid per dimension (level · question) and their reflections. Only answers someone gave are included.',
    privacy: 'People are numbered by when their sheet was made, and these numbers hold for this file only. Names, interviewers and private notes are left out; free text may still mention people or companies.',
    tables: [
      { title: 'Dimensions', items: DIMENSIONS.map((item) => `${item.name}: ${item.hint.toLowerCase()}`) },
      { title: 'Levels', items: LEVELS.map((item) => `${item.name}: ${item.hint.toLowerCase()}`) },
      { title: 'Questions', items: QUESTIONS.map((item) => (item.hint ? `${item.name}: ${item.hint.toLowerCase()}` : item.name)) },
      { title: 'Reflections', items: REFLECTIONS.map((item) => item.label) },
    ],
  };
}

export const summaryLine = (insights: Insights) => [
  `Exported ${day(insights.exportedAt)}`,
  plural(insights.interviews.length, 'interview'),
  plural(insights.maps.length, 'self-submitted map'),
  ...(insights.group ? [plural(insights.waves.length, 'survey wave')] : []),
].join(' · ');

// Typed text may start a line with `#`: escape it so it stays text, not a heading.
const safe = (value: string) => value.replace(/^(\s*)(#{1,6})(?=\s|$)/gm, '$1\\$2');
const indent = (value: string) => safe(value).replaceAll('\n', '\n  ');

function answerLines(answer: Answer) {
  if ('items' in answer) return [...(answer.label ? [`**${answer.label}:**`, ''] : []), ...answer.items.map((item) => `- ${safe(item)}`)];
  return [answer.label ? `- **${answer.label}:** ${indent(answer.text)}` : safe(answer.text)];
}

function personLines(person: Person) {
  return [`### ${person.title}`, '', ...person.parts.flatMap((item) => [`#### ${item.title}`, '', ...item.answers.flatMap(answerLines), ''])];
}

export const coverageCaption = (stats: Stats) => `People who answered at least one question in each part of the grid, of ${plural(stats.people, 'person', 'people')}.`;
export const toolsCaption = `Tools listed most, by how many people listed them (top ${TOP_TOOLS}).`;

function glanceLines({ group, stats }: Insights) {
  if (!stats.people && !stats.responses) return [];
  const header = ['Dimension', ...LEVELS.map((level) => level.name)];
  return [
    '## At a glance', '',
    `${plural(stats.people, 'person', 'people')} with answers${group ? `, ${plural(stats.responses, 'submitted survey response')}` : ''}.`, '',
    ...(stats.people ? [
      coverageCaption(stats), '',
      `| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`,
      ...stats.coverage.map((row) => `| ${row.dimension} | ${row.levels.map((cell) => cell.people).join(' | ')} |`), '',
    ] : []),
    ...(stats.tools.length ? [toolsCaption, '', ...stats.tools.map((tool) => `- ${safe(tool.name)}: ${tool.people}`), ''] : []),
  ];
}

// One Markdown file for an LLM: headings mark people and parts, labels say what each answer is about.
export function insightsMarkdown(insights: Insights) {
  const about = preamble(insights);
  const section = (title: string, people: Person[], none: string) => [`## ${title}`, '', ...(people.length ? people.flatMap(personLines) : [none, ''])];
  const lines = [
    `# Agentic mapping: ${groupLabel(insights.group)}`, '',
    summaryLine(insights), '',
    ...glanceLines(insights),
    '## About this file', '',
    about.intro, '',
    about.layout, '',
    about.privacy, '',
    ...about.tables.flatMap((table) => [`**${table.title}**`, '', ...table.items.map((item) => `- ${item}`), '']),
    ...section('Interviews', insights.interviews, 'No interviews with answers.'),
    ...section('Self-submitted maps', insights.maps, 'No self-submitted maps with answers.'),
    ...(insights.group ? ['## Survey free text', '', ...(insights.waves.length ? insights.waves.flatMap((wave) => [
      `### ${wave.name}`, '', `${waveMeta(wave)}.`, '',
      ...(wave.hidden ? [tooFewText, ''] : wave.questions.flatMap((question) => [
        `#### ${question.prompt}`, '', ...(question.answers.length ? question.answers.map((answer) => `- ${indent(answer)}`) : ['No answers.']), '',
      ])),
    ]) : ['No survey waves.', ''])] : []),
  ];
  return `${lines.join('\n').trimEnd()}\n`;
}
