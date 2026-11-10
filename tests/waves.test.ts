import { expect, test } from 'bun:test';
import { defaultWaveName } from '../server/domain/waves';
import { groupWithWave, origin, setup } from './helpers';

test('waves default to the quarter they open in', () => {
  expect(defaultWaveName(Date.UTC(2026, 10, 10))).toBe('2026 Q4');
  expect(defaultWaveName(Date.UTC(2027, 0, 1))).toBe('2027 Q1');
});

test('interviewers open one wave at a time in a group, close and reopen it; nobody else can', async () => {
  const { owner, send, store } = setup();
  await groupWithWave(owner);
  expect((await send('/company-a/waves')).headers.get('Location')).toBe('/sign-in');
  expect((await send('/company-a/waves', { method: 'POST', form: { name: 'Forged' } })).status).toBe(401);
  expect((await owner('/company-x/waves')).status).toBe(404);
  const page = await (await owner('/company-a/waves')).text();
  expect(page).toContain('2026 Q4');
  expect(page).toContain(`value="${origin}/company-a/survey"`);
  expect(page).not.toContain('id="wave-create"');
  const second = await owner('/company-a/waves', { method: 'POST', form: { name: 'Second' } });
  expect(second.status).toBe(409);
  expect(await second.text()).toContain('is still open');
  const [key] = await store.keys('wave:company-a:');
  const id = key.split(':').pop()!;
  expect((await owner(`/company-a/waves/${id}/close`, { method: 'POST', form: {} })).status).toBe(303);
  expect(await store.get(key)).toMatchObject({ status: 'closed', version: 1 });
  const closed = await (await owner('/company-a/waves')).text();
  expect(closed).toContain('id="wave-create"');
  expect(closed).toContain('Reopen');
  // A new wave can open once the first is closed; then the old one can't be reopened beside it.
  expect((await owner('/company-a/waves', { method: 'POST', form: { name: '' } })).status).toBe(303);
  expect((await owner(`/company-a/waves/${id}/reopen`, { method: 'POST', form: {} })).status).toBe(409);
  expect((await owner('/company-a/waves/00000000-0000-0000-0000-000000000000/close', { method: 'POST', form: {} })).status).toBe(404);
  expect((await store.keys('wave:company-a:')).length).toBe(2);
  // The Groups page and the interviewer's sidebar link each group's survey; sheets without a group have none.
  expect(await (await owner('/groups')).text()).toContain('href="/company-a/waves"');
  expect(await (await owner('/company-a/interviews')).text()).toContain('href="/company-a/waves"');
  expect(await (await owner('/interviews')).text()).not.toContain('id="survey-link"');
});
