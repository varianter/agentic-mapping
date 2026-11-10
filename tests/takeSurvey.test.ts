import { expect, test } from 'bun:test';
import { groupWithWave, json, setup, type Send } from './helpers';

// The wave a page was rendered for, as its form posts it back.
const waveOf = async (me: Send) => /name="wave" value="([^"]+)"/.exec(await (await me('/company-a/survey/1')).text())![1];
const step = async (me: Send, n: number, form: Record<string, string | string[]>, go?: string) => me(`/company-a/survey/${n}${go ? `?go=${go}` : ''}`, { method: 'POST', form: { wave: await waveOf(me), ...form } });
const revisionOf = async (me: Send, n: number) => Number(/name="revision" value="(\d+)"/.exec(await (await me(`/company-a/survey/${n}`)).text())![1]);

// One full answer, step by step, as a browser without JS sends it.
async function answerAll(me: Send, { context = 'customer', autonomy = 'handoff' } = {}) {
  expect((await step(me, 1, { revision: String(await revisionOf(me, 1)), role: 'developer', context }, 'next')).headers.get('Location')).toBe('/company-a/survey/2');
  await step(me, 2, { revision: String(await revisionOf(me, 2)), frequency: 'daily', task_code: 'default' }, 'next');
  await step(me, 3, { revision: String(await revisionOf(me, 3)), models: ['claude', 'gpt'], tools: 'claude-code', main_tool: 'claude-code', autonomy, pays: ['customer', 'me'] }, 'next');
  await step(me, 4, { revision: String(await revisionOf(me, 4)), agree_enjoy: '5', time_saved: '3-8', blocker: 'time' }, 'next');
  await step(me, 5, { revision: String(await revisionOf(me, 5)), expectation: 'encourages', maturity_policy: 'emerging', industry: 'energy', size: '50-200' }, 'next');
  return step(me, 6, { revision: String(await revisionOf(me, 6)), wish: 'Synthetic wish', workplace: 'Synthetic licences' }, 'submit');
}

test('without an open wave the survey says so, and posts are refused', async () => {
  const { owner, browser } = setup();
  await owner('/groups', { method: 'POST', form: { name: 'Company A' } });
  const page = await browser()('/company-a/survey');
  expect(page.status).toBe(200);
  expect(await page.text()).toContain('No survey is open right now');
  expect((await browser()('/company-a/survey/1', { method: 'POST', form: { revision: '0', role: 'ux' }, headers: json })).status).toBe(409);
  expect((await browser()('/company-x/survey')).status).toBe(404);
  expect((await setup({ admin: false }).send('/company-a/survey')).status).toBe(404);
});

test('a browser answers step by step, submits, sees its own summary and can change its answers', async () => {
  const { owner, browser, store } = setup();
  await groupWithWave(owner);
  const me = browser();
  const intro = await (await me('/company-a/survey')).text();
  expect(intro).toContain('About 7 minutes');
  expect(intro).toContain('href="/company-a/survey/1"');
  // Opening pages stores nothing.
  expect(await store.keys('response:')).toEqual([]);
  // Required answers hold you on the step, keeping what was typed.
  const missing = await step(me, 1, { revision: '0', role: 'ux' }, 'next');
  expect(missing.status).toBe(422);
  const missingHtml = await missing.text();
  expect(missingHtml).toContain('marked required');
  expect(missingHtml).toMatch(/value="ux" checked/);
  // The error is in the title, linked from the summary and said with the question it belongs to.
  expect(missingHtml).toContain('<title>Error: About you · Step 1 of 6');
  expect(missingHtml).toContain('href="#question-context"');
  expect(missingHtml).toMatch(/<legend[^>]*id="q-context-label">[^]*?Error: Answer this to go on\.[^]*?<\/legend>/);
  expect(missingHtml).not.toMatch(/<legend[^>]*id="q-role-label">[^<]*<span class="survey-required"> \(required\)<\/span><span class="survey-error">/);
  expect(await store.keys('response:')).toEqual([]);
  const submitted = await answerAll(me);
  expect(submitted.headers.get('Location')).toBe('/company-a/survey/done');
  const [key] = await store.keys('response:');
  const response = await store.get(key);
  expect(response).toMatchObject({ version: 1, answers: { role: 'developer', models: ['claude', 'gpt'], tools: ['claude-code'], pays: ['customer', 'me'], autonomy: 'handoff', wish: 'Synthetic wish', workplace: 'Synthetic licences' } });
  expect(response.submittedAt).toBeNumber();
  // Nothing in the store names the browser.
  const token = /^am_respondent=([a-f0-9]{64});/.exec(submitted.headers.get('Set-Cookie') ?? '')![1];
  expect(JSON.stringify(await Promise.all((await store.keys('')).map((k) => store.get(k))))).not.toContain(token);
  const summary = await (await me('/company-a/survey/done')).text();
  expect(summary).toContain('I hand off a whole task and review the result');
  expect(summary).toContain('Next rung: “I run several agents at once”');
  expect(summary).toContain('3–8 hours');
  // Changing an answer keeps one response, still submitted.
  await step(me, 3, { revision: String(await revisionOf(me, 3)), autonomy: 'parallel' }, 'next');
  expect((await store.keys('response:')).length).toBe(1);
  expect(await store.get(key)).toMatchObject({ answers: { autonomy: 'parallel', models: [] }, submittedAt: response.submittedAt });
  // Another browser answers separately and has no summary yet.
  const other = browser();
  expect((await other('/company-a/survey/done')).headers.get('Location')).toBe('/company-a/survey');
  expect(await (await other('/company-a/survey')).text()).toContain('Start');
});

test('steps follow earlier answers: tasks by role, the context step by who you work for', async () => {
  const { owner, browser } = setup();
  await groupWithWave(owner);
  const designer = browser();
  await step(designer, 1, { revision: '0', role: 'ui', context: 'own' }, 'next');
  const tasks = await (await designer('/company-a/survey/2')).text();
  expect(tasks).toContain('name="task_visual"');
  expect(tasks).not.toContain('name="task_code"');
  const context = await (await designer('/company-a/survey/5')).text();
  expect(context).toContain('Your organization');
  expect(context).toContain('How does your organization expect you to use AI?');
  // Every id on a step is unique.
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const ids = [...(await (await designer(`/company-a/survey/${n}`)).text()).matchAll(/ id="([^"]+)"/g)].map(([, id]) => id);
    expect(new Set(ids).size).toBe(ids.length);
  }
  const consultant = browser();
  await step(consultant, 1, { revision: '0', role: 'developer', context: 'between' }, 'next');
  expect(await (await consultant('/company-a/survey/5')).text()).toContain('How does your customer expect you to use AI?');
});

test('autosave posts a step for JSON; stale revisions conflict; unknown answers are refused; closing stops saves', async () => {
  const { owner, browser, store } = setup();
  await groupWithWave(owner);
  const me = browser();
  const wave = await waveOf(me);
  const first = await me('/company-a/survey/1', { method: 'POST', form: { revision: '0', wave, role: 'ux' }, headers: json });
  expect(await first.json()).toEqual({ revision: 1 });
  expect((await me('/company-a/survey/1', { method: 'POST', form: { revision: '0', wave, role: 'ui' }, headers: json })).status).toBe(409);
  for (const form of [{ revision: '1', wave, role: 'astronaut' }, { revision: '1', wave, autonomy: 'chat' }, { revision: '1', wave, role: ['ux', 'ui'] }, { revision: '1', role: 'ux' }]) {
    expect((await me('/company-a/survey/1', { method: 'POST', form, headers: json })).status).toBe(422);
  }
  expect((await me('/company-a/survey/9')).status).toBe(404);
  // Back from the first step goes to the intro; plain saves stay on the step.
  expect((await step(me, 1, { revision: '1', role: 'ux' }, 'back')).headers.get('Location')).toBe('/company-a/survey');
  expect((await step(me, 1, { revision: '2', role: 'ux' })).headers.get('Location')).toBe('/company-a/survey/1?saved');
  // Submitting needs step 1's required answers, even when reached by URL.
  const early = await step(me, 6, { revision: '3', wish: '' }, 'submit');
  expect(early.status).toBe(422);
  expect(await early.text()).toContain('Step 1');
  await owner(`/company-a/waves/${wave}/close`, { method: 'POST', form: {} });
  expect((await me('/company-a/survey/1', { method: 'POST', form: { revision: '3', wave, role: 'ui' }, headers: json })).status).toBe(409);
  expect(await (await me('/company-a/survey')).text()).toContain('No survey is open right now');
  // A form left open from the closed wave never saves into the next one, even with a matching revision.
  await owner('/company-a/waves', { method: 'POST', form: { name: '2027 Q1' } });
  const stale = await browser()('/company-a/survey/1', { method: 'POST', form: { revision: '0', wave, role: 'ui' }, headers: json });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: 'This survey has closed. Your last saved answers are kept.' });
  expect((await store.keys('response:')).length).toBe(1);
});

test('My map offers the group’s survey while a wave is open', async () => {
  const { owner, browser, store } = setup();
  await groupWithWave(owner);
  expect(await (await browser()('/company-a')).text()).toContain('href="/company-a/survey"');
  expect(await (await browser()('/map')).text()).not.toContain('id="take-survey"');
  const [wave] = await store.keys('wave:company-a:');
  await owner(`/company-a/waves/${wave.split(':').pop()}/close`, { method: 'POST', form: {} });
  expect(await (await browser()('/company-a')).text()).not.toContain('id="take-survey"');
});

test('the model split shows every family without JS and holds you on the step until it adds up', async () => {
  const { owner, browser, store } = setup();
  await groupWithWave(owner);
  const me = browser();
  await step(me, 1, { revision: '0', role: 'developer', context: 'customer' }, 'next');
  const page = await (await me('/company-a/survey/3')).text();
  expect(page).toContain('<model-shares from="models">');
  expect(page).toMatch(/<tool-list><textarea id="q-tools_other" name="tools_other"/);
  expect(page).not.toContain('name="tools" value="other"');
  expect(page).toContain('name="models" value="other"');
  for (const name of ['share_fable', 'share_opus', 'share_sonnet', 'share_haiku', 'share_gpt-pro', 'share_gemini-flash']) expect(page).toContain(`name="${name}"`);
  const uneven = await step(me, 3, { revision: '1', models: ['claude', 'gpt'], share_opus: '30', share_sonnet: '50', share_gpt: '20' }, 'next');
  expect(uneven.status).toBe(422);
  const html = await uneven.text();
  expect(html).toContain('Your Anthropic Claude split adds up to 80%');
  expect(html).toContain('name="share_opus" value="30"');
  const even = await step(me, 3, { revision: '1', models: ['claude', 'gpt'], share_opus: '30', share_sonnet: '50', share_haiku: '20', share_gpt: '20' }, 'next');
  expect(even.status).toBe(422);
  expect(await even.text()).toContain('Your OpenAI GPT split adds up to 20%');
  const done = await step(me, 3, { revision: '1', models: ['claude', 'gpt'], share_opus: '30', share_sonnet: '50', share_haiku: '20', share_gpt: '100' }, 'next');
  expect(done.headers.get('Location')).toBe('/company-a/survey/4');
  const [key] = await store.keys('response:');
  expect((await store.get(key)).answers).toMatchObject({ share_opus: '30', share_sonnet: '50', share_haiku: '20', share_gpt: '100' });
  expect(await (await me('/company-a/survey/3')).text()).toMatch(/data-option="claude" data-ticked=""/);
});
