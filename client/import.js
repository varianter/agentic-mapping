// Sheets from an uploaded file: a store dump ({ "sheet:<id>": { value } }, value a JSON string or object),
// a Download JSON array, or one sheet. Other store keys (links, respondents) are ignored.
export function sheetsFromUpload(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') throw new Error('The file holds no sheets.');
  if (typeof data.id === 'string' && data.fields) return [data];
  return Object.entries(data)
    .filter(([key]) => key.startsWith('sheet:'))
    .map(([, entry]) => (typeof entry?.value === 'string' ? JSON.parse(entry.value) : entry?.value ?? entry));
}

// Only what POST /api/sheets accepts; the server sets a fresh revision and never stores link hashes.
export const importableSheet = (sheet) => {
  const { id, source, fields, createdAt, updatedAt } = sheet ?? {};
  return { id, source: source ?? 'interview', fields, createdAt, updatedAt };
};
