import { expect, test } from 'bun:test';
import { SURVEY_V1 } from '../server/domain/survey';
import { summarize } from '../server/domain/surveyResults';
import type { SurveyResponse } from '../server/domain/waves';
import { groupWithWave, setup } from './helpers';

let id = 0;
const response = (answers: SurveyResponse['answers'], submitted = true): SurveyResponse => ({
  id: String(++id), waveId: 'w', version: 1, answers, createdAt: id, updatedAt: id, revision: 1, ...(submitted ? { submittedAt: id } : {}),
});
const many = (count: number, answers: SurveyResponse['answers']) => Array.from({ length: count }, () => response(answers));
const question = (summary: ReturnType<typeof summarize>, title: string, name: string) => summary.sections.find((section) => section.title === title)!.questions.find((result) => result.question.name === name)!;

test('results count submitted answers per option, split context answers by subject and hide small groups', () => {
  const responses = [
    ...many(4, { role: 'developer', context: 'customer', autonomy: 'handoff', models: ['claude', 'gpt'], expectation: 'expects' }),
    ...many(2, { role: 'ux', context: 'own', autonomy: 'chat', models: ['gpt'], expectation: 'neutral' }),
    response({ role: 'ux', autonomy: 'workflow' }, false),
  ];
  const summary = summarize(SURVEY_V1, responses);
  expect(summary).toMatchObject({ n: 6, hidden: false });
  const autonomy = question(summary, 'Models and tools', 'autonomy');
  expect(autonomy.kind === 'choice' && autonomy.tallies.filter((item) => item.count).map((item) => [item.value, item.count])).toEqual([['chat', 2], ['handoff', 4]]);
  const models = question(summary, 'Models and tools', 'models');
  expect(models.kind === 'choice' && models.tallies.find((item) => item.value === 'gpt')!.count).toBe(6);
  const customers = summary.sections.find((section) => section.title === 'About customers')!;
  const own = summary.sections.find((section) => section.title === 'About their own organization')!;
  expect([customers.n, customers.hidden, own.n, own.hidden]).toEqual([4, true, 2, true]);
  // A row only some roles answer is hidden on its own when fewer than five did.
  const tasks = question(summarize(SURVEY_V1, [...many(1, { role: 'developer', task_code: 'default' }), ...many(4, { role: 'ui', task_visual: 'regular' })]), 'How often', 'task');
  expect(tasks.kind === 'matrix' && tasks.rows.find((row) => row.label === 'Writing code')).toMatchObject({ hidden: true, answered: 0 });
  expect(tasks.kind === 'matrix' && tasks.rows.find((row) => row.label === 'Writing code')!.tallies.every((item) => !item.count)).toBe(true);
  // A role filter under five answers hides everything.
  expect(summarize(SURVEY_V1, responses, { role: 'ux' })).toMatchObject({ n: 2, hidden: true });
});

test('interviewers read a wave’s results; drafts are counted apart and never shown', async () => {
  const { owner, browser, send, store } = setup();
  await groupWithWave(owner);
  const [key] = await store.keys('wave:company-a:');
  const waveId = key.split(':').pop()!;
  for (const answers of many(5, { role: 'developer', context: 'customer', autonomy: 'parallel', wish: 'Synthetic wish' })) {
    await store.set(`response:${waveId}:${answers.id}`, { ...answers, waveId });
  }
  await browser()('/company-a/survey/1', { method: 'POST', form: { revision: '0', wave: waveId, role: 'ux' } });
  expect((await send(`/company-a/waves/${waveId}`)).headers.get('Location')).toBe('/sign-in');
  const page = await (await owner(`/company-a/waves/${waveId}`)).text();
  expect(page).toContain('5 answers');
  expect(page).toContain('1 in progress, not counted');
  expect(page).toContain('I run several agents at once: 5 of 5');
  expect(page).toContain('Synthetic wish');
  const filtered = await (await owner(`/company-a/waves/${waveId}?role=ux`)).text();
  expect(filtered).toContain('id="results-hidden"');
  expect(filtered).not.toContain('Synthetic wish');
  expect((await owner('/company-a/waves/00000000-0000-0000-0000-000000000000')).status).toBe(404);
});

test('the CSV has one row per submitted response, one column per answer, and is safe to open in a spreadsheet', async () => {
  const { owner, send, store } = setup();
  await groupWithWave(owner);
  const [key] = await store.keys('wave:company-a:');
  const waveId = key.split(':').pop()!;
  await store.set(`response:${waveId}:a`, { ...response({ role: 'developer', models: ['claude', 'gpt'], tools_other: 'Aider\nZed', wish: '=HYPERLINK("x"), with "quotes"' }), waveId });
  await store.set(`response:${waveId}:b`, { ...response({ role: 'ux' }, false), waveId });
  expect((await send(`/company-a/waves/${waveId}.csv`)).status).toBe(303);
  const download = await owner(`/company-a/waves/${waveId}.csv`);
  expect(download.headers.get('Content-Type')).toContain('text/csv');
  expect(download.headers.get('Content-Disposition')).toContain('attachment');
  const lines = (await download.text()).trimEnd().split('\r\n');
  expect(lines).toHaveLength(2);
  const header = lines[0].split(',');
  expect(header.slice(0, 4)).toEqual(['version', 'submitted', 'role', 'experience']);
  expect(header).toContain('task_code');
  expect(header).toContain('models_other');
  expect(header.slice(-2)).toEqual(['wish', 'workplace']);
  expect(lines[1]).toStartWith('1,');
  expect(lines[1]).toContain(',developer,');
  expect(lines[1]).toContain('"claude; gpt"');
  expect(lines[1]).toContain('"Aider; Zed"');
  expect(lines[1]).toContain(`"'=HYPERLINK(""x""), with ""quotes"""`);
});

test('other tools are counted per item, once per person, ignoring case', () => {
  const responses = [
    ...many(2, { tools: ['other'], tools_other: 'Aider\nZed' }),
    response({ tools: ['other'], tools_other: 'aider\nAIDER\nWarp' }),
  ];
  const tools = question(summarize(SURVEY_V1, responses), 'Models and tools', 'tools');
  expect(tools.kind === 'choice' && tools.others).toEqual(['Aider (3)', 'Zed (2)', 'Warp (1)']);
});

test('model splits average per provider over splits that add up, and by size across providers', () => {
  const responses = [
    ...many(3, { models: ['claude'], share_fable: '10', share_opus: '20', share_sonnet: '70' }),
    ...many(1, { models: ['claude', 'gpt'], share_sonnet: '100', 'share_gpt-mini': '100' }),
    response({ models: ['claude'], share_opus: '40' }),
  ];
  const shares = question(summarize(SURVEY_V1, responses), 'Models and tools', 'share');
  if (shares.kind !== 'shares') throw new Error('Expected a split.');
  expect(shares.answered).toBe(5);
  const providers = Object.fromEntries(shares.providers.map((provider) => [provider.label, [provider.answered, provider.tiers.filter((item) => item.users).map((item) => [item.label, item.average, item.users])]]));
  expect(providers).toEqual({
    'Anthropic Claude': [4, [['Fable', 8, 3], ['Opus', 15, 3], ['Sonnet', 78, 4]]],
    'OpenAI GPT': [1, [['GPT mini', 100, 1]]],
  });
  expect(shares.sizes.map((item) => [item.label, item.average])).toEqual([['Largest', 6], ['Large', 12], ['Mid-size', 82], ['Small and fast', 0], ['Not sure which', 0]]);
});
