import { z } from 'zod';
import { INTERVIEWER_TEXT_FIELDS, RESPONDENT_FIELDS } from './fields';

// Form bodies, built from the field tables. Strict: an unknown field is a tampered form, never stored.
const text = z.string().max(100_000).optional();
const revision = z.coerce.number().int().nonnegative();
const defined = <T>(fields: Record<string, T | undefined>) => Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Record<string, T>;

export const answersSchema = z.strictObject({
  revision,
  ...Object.fromEntries(RESPONDENT_FIELDS.map((name) => [name, text])),
}).transform(({ revision, ...answers }) => ({ revision, answers: defined(answers as Record<string, string | undefined>) }));

// Unchecked boxes send nothing, so the discipline list defaults to empty.
export const sheetSchema = z.strictObject({
  revision: revision.pipe(z.number().positive()),
  discipline: z.union([z.string(), z.array(z.string())]).optional().transform((value) => (value === undefined ? [] : [value].flat())),
  ...Object.fromEntries([...RESPONDENT_FIELDS, ...INTERVIEWER_TEXT_FIELDS].map((name) => [name, text])),
}).transform(({ revision, ...fields }) => ({ revision, fields: defined(fields as Record<string, string | string[] | undefined>) }));

export const revisionSchema = z.object({ revision: revision.pipe(z.number().positive()) });
