import { expect, test } from 'bun:test';
import { importableSheet, sheetsFromUpload } from '../server/domain/import';
import { adminCookie, origin, setup } from './helpers';

const sheet = (fields: Record<string, unknown> = { name: 'Synthetic' }) => ({ id: crypto.randomUUID(), fields, createdAt: 1, updatedAt: 2, revision: 7 });
// A multipart form post, as the sidebar's Upload form sends it.
function upload(app: ReturnType<typeof setup>['app'], contents: string, name = 'dump.json') {
  const body = new FormData();
  body.append('file', new File([contents], name, { type: 'application/json' }));
  return app.request(`${origin}/interviews/import`, { method: 'POST', headers: { Cookie: adminCookie, Origin: origin }, body });
}

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
  const { app, store } = setup();
  const own = { ...sheet(), source: 'self' };
  const interview = sheet({ name: 'Uploaded interview' });
  const first = await upload(app, JSON.stringify([own, interview, { ...sheet(), source: 'admin' }]));
  expect(first.status).toBe(200);
  expect(await first.text()).toContain('Uploaded 2 of 3 sheets. 1 of them are self-submitted maps. 1 skipped: invalid.');
  expect(await store.get(`sheet:${own.id}`)).toMatchObject({ source: 'self', revision: 1 });
  expect(await store.get(`sheet:${interview.id}`)).toMatchObject({ source: 'interview', revision: 1 });
  // Identical retries are fine; a changed copy is skipped rather than overwriting.
  expect(await (await upload(app, JSON.stringify([own]))).text()).toContain('Uploaded 1 of 1 sheets.');
  expect(await (await upload(app, JSON.stringify([{ ...own, fields: { name: 'Other' } }]))).text()).toContain('1 skipped: a different sheet with that ID exists');
  expect((await store.get(`sheet:${own.id}`)).fields).toEqual(own.fields);
  const broken = await upload(app, 'not json', 'broken.json');
  expect(broken.status).toBe(422);
  expect(await broken.text()).toContain('broken.json isn’t a store or Download JSON file.');
});
