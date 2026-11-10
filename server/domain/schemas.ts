import { z } from 'zod';
import { INTERVIEWER_TEXT_FIELDS, RESPONDENT_FIELDS } from './fields';
import { otherField, rowField, tierField, type Step } from './survey';

// Form bodies, built from the field tables. Strict: an unknown field is a tampered form, never stored.
const text = z.string().max(100_000).optional();
const revision = z.coerce.number().int().nonnegative();
const defined = <T>(fields: Record<string, T | undefined>) => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Record<string, T>;

// My map: the respondent's answers, plus their name, which only an own map stores (on an interview it's interviewer-only).
export const myMapSchema = z.strictObject({
  revision,
  name: text,
  ...Object.fromEntries(RESPONDENT_FIELDS.map((name) => [name, text])),
}).transform(({ revision, name, ...answers }) => ({ revision, name, answers: defined(answers as Record<string, string | undefined>) }));

// Unchecked boxes send nothing, so the discipline list defaults to empty.
export const sheetSchema = z.strictObject({
  revision: revision.pipe(z.number().positive()),
  discipline: z.union([z.string(), z.array(z.string())]).optional().transform((value) => (value === undefined ? [] : [value].flat())),
  ...Object.fromEntries([...RESPONDENT_FIELDS, ...INTERVIEWER_TEXT_FIELDS].map((name) => [name, text])),
}).transform(({ revision, ...fields }) => ({ revision, fields: defined(fields as Record<string, string | string[] | undefined>) }));

export const revisionSchema = z.object({ revision: revision.pipe(z.number().positive()) });

// Groups: a name, and on creation an optional id (from the name when empty). `createGroup` checks the rest.
export const groupSchema = z.strictObject({ name: z.string().max(200), slug: z.string().max(100).optional() });
export const renameGroupSchema = z.strictObject({ name: z.string().max(200) });

// One survey step: only its own questions, each answer one of the question's options. Free text stays short.
const choice = (values: string[]) => z.enum(values as [string, ...string[]]).optional();
const choices = (values: string[]) => z.union([z.string(), z.array(z.string())]).optional()
  .transform((value) => (value === undefined ? undefined : [value].flat())).pipe(z.array(z.enum(values as [string, ...string[]])).max(values.length).optional());
const short = z.string().max(200).optional();
// A whole percentage, or empty for none.
const percent = z.string().regex(/^(100|[1-9]?\d)?$/, 'Use a whole number from 0 to 100.').optional();

export const surveyStepSchema = (step: Step) => z.strictObject({
  revision,
  ...Object.fromEntries(step.questions.flatMap((question): [string, z.ZodType][] => {
    if (question.kind === 'text') return [[question.name, z.string().max(5000).optional()]];
    if (question.kind === 'shares') return question.groups.flatMap((group) => group.tiers.map((item): [string, z.ZodType] => [tierField(question, item), percent]));
    const values = question.options.map((item) => item.value);
    if (question.kind === 'matrix') return question.rows.map((row) => [rowField(question, row), choice(values)]);
    return [[question.name, question.kind === 'multi' ? choices(values) : choice(values)], ...(question.other ? [[otherField(question), short] as [string, z.ZodType]] : [])];
  })),
}).transform(({ revision, ...answers }) => ({ revision, answers: defined(answers as Record<string, string | string[] | undefined>) }));

// Waves: a name; the questionnaire version is always the latest.
export const waveSchema = z.strictObject({ name: z.string().max(200) });
