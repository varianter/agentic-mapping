import type { Store } from '../store';
import { createSheet, sourceOf, validSheet, type Scope, type Source } from './sheets';

// Sheets from an uploaded file: a store dump ({ "sheet:<id>": { value } }, value a JSON string or object),
// a Download JSON array, or one sheet. Other store keys (links, respondents) are ignored.
export function sheetsFromUpload(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') throw new Error('The file holds no sheets.');
  const record = data as Record<string, any>;
  if (typeof record.id === 'string' && record.fields) return [record];
  return Object.entries(record)
    .filter(([key]) => key.startsWith('sheet:'))
    .map(([, entry]) => (typeof entry?.value === 'string' ? JSON.parse(entry.value) : entry?.value ?? entry));
}

// Only what a create accepts; the store sets a fresh revision and never takes link hashes. Sheets go into the
// group they are uploaded from, whatever group the file names.
export const importableSheet = (sheet: any, group: Scope = null) => {
  const { id, source, fields, createdAt, updatedAt } = sheet ?? {};
  return { id, source: source ?? 'interview', ...(group ? { group } : {}), fields, createdAt, updatedAt };
};

export type ImportResult = { total: number; imported: number; exists: number; invalid: number; bySource: Record<Source, number> };

// Each sheet goes through the normal create: identical retries are fine and an existing ID is never overwritten.
export async function importSheets(store: Store, text: string, group: Scope = null): Promise<ImportResult> {
  const sheets = sheetsFromUpload(JSON.parse(text));
  const result: ImportResult = { total: sheets.length, imported: 0, exists: 0, invalid: 0, bySource: { interview: 0, self: 0 } };
  for (const sheet of sheets) {
    const input = importableSheet(sheet, group);
    if (!validSheet(input)) {
      result.invalid += 1;
      continue;
    }
    const { status } = await createSheet(store, input);
    if (status === 'conflict') result.exists += 1;
    else {
      result.imported += 1;
      result.bySource[sourceOf(input)] += 1;
    }
  }
  return result;
}
