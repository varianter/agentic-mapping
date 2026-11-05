import type { Store } from '../store';
import type { Answers, Fields } from './fields';

// One JSON value per sheet at `sheet:<id>`. `source` is `self` or `interview` (missing means interview);
// `linkHash` ties an interview to its participant link and never leaves the server.
export type Source = 'self' | 'interview';
export type Sheet = { id: string; source?: Source; fields: Fields; createdAt: number; updatedAt: number; revision: number; linkHash?: string };
export type SheetInput = { id: string; source?: Source; fields: Fields; createdAt: number; updatedAt: number };

export const sourceOf = (sheet: Pick<Sheet, 'source'>): Source => sheet.source ?? 'interview';
export const publicSheet = ({ linkHash: _linkHash, ...sheet }: Sheet) => sheet;
export const displayName = (sheet: Pick<Sheet, 'fields'>) => (typeof sheet.fields?.name === 'string' && sheet.fields.name.trim()) || 'Untitled';
export const validId = (id: unknown): id is string => typeof id === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id);
export const validRevision = (revision: unknown): revision is number => Number.isSafeInteger(revision) && Number(revision) > 0;

export function validSheet(sheet: any): sheet is SheetInput {
  return sheet && validId(sheet.id) && sheet.fields && typeof sheet.fields === 'object' && !Array.isArray(sheet.fields)
    && Object.entries(sheet.fields).every(([key, value]) => key.length <= 100 && (typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string'))))
    && Number.isSafeInteger(sheet.createdAt) && sheet.createdAt >= 0 && Number.isSafeInteger(sheet.updatedAt) && sheet.updatedAt >= 0
    && [undefined, 'self', 'interview'].includes(sheet.source);
}

// Named interviews first, alphabetically; untitled last; ties by most recent.
export function byName(a: Sheet, b: Sheet) {
  const an = typeof a.fields?.name === 'string' ? a.fields.name.trim() : '';
  const bn = typeof b.fields?.name === 'string' ? b.fields.name.trim() : '';
  if (!an !== !bn) return an ? -1 : 1;
  return an.localeCompare(bn, undefined, { sensitivity: 'base' }) || b.updatedAt - a.updatedAt;
}

export type Saved = { ok: true; sheet: Sheet } | { ok: false; reason: 'missing' | 'conflict' };

export const getSheet = async (store: Store, id: string): Promise<Sheet | null> => (validId(id) ? store.get(`sheet:${id}`) : null);

export async function listSheets(store: Store, source?: Source): Promise<Sheet[]> {
  const sheets: (Sheet | null)[] = await Promise.all((await store.keys('sheet:')).map((key) => store.get(key)));
  return sheets.filter((sheet): sheet is Sheet => Boolean(sheet) && (!source || sourceOf(sheet!) === source)).toSorted(byName);
}

// Identical create/import retries are safe; an ID collision never overwrites data.
export async function createSheet(store: Store, input: SheetInput): Promise<{ status: 'created' | 'exists' | 'conflict'; sheet: Sheet }> {
  const existing: Sheet | null = await store.get(`sheet:${input.id}`);
  if (existing) {
    const sameFields = Object.keys(existing.fields).length === Object.keys(input.fields).length
      && Object.entries(input.fields).every(([key, value]) => JSON.stringify(value) === JSON.stringify(existing.fields[key]));
    const same = sameFields && existing.createdAt === input.createdAt && existing.updatedAt === input.updatedAt && sourceOf(existing) === (input.source ?? sourceOf(existing));
    return { status: same ? 'exists' : 'conflict', sheet: existing };
  }
  // Uploads keep a self-submitted map's source; everything else is an interview.
  const created: Sheet = { id: input.id, source: input.source ?? 'interview', fields: input.fields, createdAt: input.createdAt, updatedAt: input.updatedAt, revision: 1 };
  await store.set(`sheet:${created.id}`, created);
  return { status: 'created', sheet: created };
}

export function blankInterview(now = Date.now()): SheetInput {
  return { id: crypto.randomUUID(), source: 'interview', fields: { date: new Date(now).toISOString().slice(0, 10) }, createdAt: now, updatedAt: now };
}

// Read-check-write, not atomic: the revision the editor saw must still be current.
export async function saveFields(store: Store, id: string, revision: number, fields: Fields, { replace = false } = {}): Promise<Saved> {
  const stored = await getSheet(store, id);
  if (!stored) return { ok: false, reason: 'missing' };
  if (stored.revision !== revision) return { ok: false, reason: 'conflict' };
  const sheet = { ...stored, fields: replace ? fields : { ...stored.fields, ...fields }, updatedAt: Date.now(), revision: stored.revision + 1 };
  await store.set(`sheet:${id}`, sheet);
  return { ok: true, sheet };
}

// Only answer fields change; interviewer notes on the same sheet are kept.
export const saveAnswers = (store: Store, sheet: Sheet, revision: number, answers: Answers) => saveFields(store, sheet.id, revision, answers);

export async function deleteSheet(store: Store, id: string, revision: number): Promise<Saved> {
  const stored = await getSheet(store, id);
  if (!stored) return { ok: false, reason: 'missing' };
  if (stored.revision !== revision) return { ok: false, reason: 'conflict' };
  await removeSheet(store, stored);
  return { ok: true, sheet: stored };
}

export const removeSheet = (store: Store, sheet: Sheet) => store.del(`sheet:${sheet.id}`, ...(sheet.linkHash ? [`link:${sheet.linkHash}`] : []));
