// The capture sheet's fields, defined once: views, schemas and access rules are built from these tables.

export const DIMENSIONS = [
  { key: 'ind', name: 'Individual', hint: 'How you work on your own' },
  { key: 'team', name: 'Team', hint: 'How your team works together' },
  { key: 'org', name: 'Organization', hint: 'What your organization enables or gets in the way of' },
] as const;
export const LEVELS = [
  { key: 'start', name: 'Getting started', hint: 'The first weeks' },
  { key: 'good', name: 'Getting good', hint: 'Every day, at expert quality' },
  { key: 'next', name: 'Next level', hint: 'What you’re reaching for now' },
] as const;
export const QUESTIONS = [
  { key: 'learn', name: 'What to learn', hint: '' },
  { key: 'why', name: 'Why it matters', hint: 'What goes wrong without it' },
  { key: 'found', name: 'How you found out', hint: 'Where the unknown showed up' },
] as const;
export const DISCIPLINES = ['Developer', 'UX', 'UI', 'Service design', 'Product manager', 'Project / process'];

export const GRID_FIELDS = QUESTIONS.flatMap((question) => LEVELS.map((level) => `${question.key}_${level.key}`));
export const gridField = (dimension: string, question: string, level: string) => `${dimension}_${question}_${level}`;

// The respondent's reflections, in sheet order. `talk_to` is the interviewer's own note.
export const REFLECTIONS = [
  { name: 'surprised', label: 'What surprised you' },
  { name: 'missing', label: 'What you suspect you’re still missing' },
  { name: 'advice', label: 'Day one advice: first, and what can wait' },
] as const;

// Answers kept as a list, one item per line: a brain dump of tools and techniques before placing them in the grid.
export const LIST_ANSWERS = ['tools'];
export const listItems = (value = '') => value.split('\n').map((item) => item.trim()).filter(Boolean);

// The respondent's own answers: what My map keeps and what a private link may edit.
// Everything else on the sheet (name, date, interviewer, discipline, context, talk_to) is interviewer-only.
export const RESPONDENT_FIELDS = [
  ...DIMENSIONS.flatMap((dimension) => GRID_FIELDS.map((field) => `${dimension.key}_${field}`)),
  'good', 'tools', ...REFLECTIONS.map((reflection) => reflection.name),
];
export const INTERVIEWER_TEXT_FIELDS = ['name', 'date', 'interviewer', 'discipline_other', 'context', 'talk_to'];
export const LIST_FIELDS = ['discipline'];
export const SHEET_FIELDS = [...RESPONDENT_FIELDS, ...INTERVIEWER_TEXT_FIELDS, ...LIST_FIELDS];

export type Fields = Record<string, string | string[]>;
export type Answers = Record<string, string>;

const respondentFields = new Set(RESPONDENT_FIELDS);
export const isRespondentField = (name: string) => respondentFields.has(name);

// Only the respondent's string answers; every respondent field is present.
export const answersOf = (fields: Fields = {}): Answers =>
  Object.fromEntries(RESPONDENT_FIELDS.map((name) => [name, typeof fields[name] === 'string' ? fields[name] as string : '']));

export const hasAnswers = (answers: Answers) => Object.values(answers).some((value) => value.trim());

// Sheets made before dimensions existed had one grid: treat it as Individual.
export function withLegacyGrid(fields: Fields = {}): Fields {
  const result = { ...fields };
  for (const name of GRID_FIELDS) if (result[name] && !result[`ind_${name}`]) result[`ind_${name}`] = result[name];
  return result;
}

// Per answer: an empty side takes the other; differing answers keep both, the interview's first.
// List answers keep each item once, the interview's first.
export function mergeAnswers(interview: Answers, mine: Answers): Answers {
  return Object.fromEntries(RESPONDENT_FIELDS.map((key) => {
    const [ours, theirs] = [interview[key] ?? '', mine[key] ?? ''];
    if (LIST_ANSWERS.includes(key)) {
      const items = [...listItems(ours), ...listItems(theirs)];
      return [key, items.filter((item, i) => items.findIndex((other) => other.toLowerCase() === item.toLowerCase()) === i).join('\n')];
    }
    return [key, !theirs.trim() || ours.trim() === theirs.trim() ? ours : !ours.trim() ? theirs : `${ours}\n\n${theirs}`];
  }));
}

// The respondent answers a sheet actually holds, without filling in blanks.
export const storedAnswers = (fields: Fields = {}): Answers =>
  Object.fromEntries(Object.entries(fields).filter(([key, value]) => respondentFields.has(key) && typeof value === 'string')) as Answers;
