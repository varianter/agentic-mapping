// The respondent's own answers: what self mode keeps and what a private link may edit.
// Everything else on the sheet (name, date, interviewer, discipline, context, talk_to) is interviewer-only.
export const DIMENSION_KEYS = ['ind', 'team', 'org'];
export const GRID_FIELDS = ['learn', 'why', 'found'].flatMap((question) => ['start', 'good', 'next'].map((level) => `${question}_${level}`));
export const RESPONDENT_FIELDS = [
  ...DIMENSION_KEYS.flatMap((dimension) => GRID_FIELDS.map((field) => `${dimension}_${field}`)),
  'good', 'surprised', 'missing', 'advice',
];
