import { expect, test } from 'bun:test';
import { createApp, sessionToken } from '../server/app';
import { memoryStore } from '../server/store';
import { importableSheet, sheetsFromUpload } from '../client/import.js';

const adminKey = 'import-admin-key-0123456789-abcdefghij';
const origin = 'https://mapping.example';
const sheet = (fields: Record<string, unknown> = { name: 'Synthetic' }) => ({ id: crypto.randomUUID(), fields, createdAt: 1, updatedAt: 2, revision: 7 });
const post = (app: ReturnType<typeof createApp>['app'], body: unknown) => app.request(`${origin}/api/sheets`, {
  method: 'POST',
  headers: { Cookie: `am_admin=${sessionToken(adminKey)}`, Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

test('a store dump yields its sheets and ignores other keys', () => {
  const [interview, own] = [sheet(), { ...sheet(), source: 'self', linkHash: 'a'.repeat(64) }];
  const dump = {
    [`sheet:${interview.id}`]: { value: JSON.stringify(interview) },
    [`sheet:${own.id}`]: { value: own },
    [`link:${'b'.repeat(64)}`]: { value: JSON.stringify({ sheetId: own.id }) },
    [`respondent:${'c'.repeat(64)}`]: { value: JSON.stringify({ sheetId: own.id }) },
  };
  expect(sheetsFromUpload(dump)).toEqual([interview, own]);
  expect(importableSheet(own)).toEqual({ id: own.id, source: 'self', fields: own.fields, createdAt: 1, updatedAt: 2 });
  expect(importableSheet(interview).source).toBe('interview');
});

test('Download JSON arrays and single sheets are accepted; other shapes are not', () => {
  const one = sheet();
  expect(sheetsFromUpload([one])).toEqual([one]);
  expect(sheetsFromUpload(one)).toEqual([one]);
  expect(sheetsFromUpload({ other: 1 })).toEqual([]);
  expect(() => sheetsFromUpload('text')).toThrow();
  expect(() => sheetsFromUpload({ [`sheet:${one.id}`]: { value: '{' } })).toThrow();
  expect(importableSheet(null).id).toBeUndefined();
});

test('uploaded sheets keep their source, get a fresh revision and never overwrite', async () => {
  const { app } = createApp({ store: memoryStore(), adminKey });
  const own = { ...sheet(), source: 'self' };
  const created = await (await post(app, importableSheet(own))).json();
  expect(created).toMatchObject({ id: own.id, source: 'self', revision: 1 });
  expect((await post(app, importableSheet(own))).status).toBe(200);
  expect((await post(app, { ...importableSheet(own), source: 'interview' })).status).toBe(409);
  expect((await post(app, { ...importableSheet(own), fields: { name: 'Other' } })).status).toBe(409);
  expect((await post(app, { ...importableSheet(sheet()), source: 'admin' })).status).toBe(400);
  const listed = await (await app.request(`${origin}/api/sheets?source=self`, { headers: { Cookie: `am_admin=${sessionToken(adminKey)}` } })).json();
  expect(listed.map((row: any) => row.id)).toEqual([own.id]);
});
