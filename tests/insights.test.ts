import { expect, test } from 'bun:test';
import { compileInsights, insightsFileName, insightsMarkdown } from '../server/domain/insights';
import type { Sheet } from '../server/domain/sheets';
import type { SurveyResponse, Wave } from '../server/domain/waves';
import { groupWithWave, setup } from './helpers';

const group = { slug: 'company-a', name: 'Company A', createdAt: 0 };
let ids = 0;
const sheet = (source: 'self' | 'interview', fields: Sheet['fields'], createdAt: number): Sheet => ({
  id: `00000000-0000-0000-0000-${String(++ids).padStart(12, '0')}`, source, group: 'company-a', fields, createdAt, updatedAt: createdAt, revision: 1,
});
const wave = (name: string, createdAt: number): Wave => ({ id: crypto.randomUUID(), group: 'company-a', name, version: 1, status: 'open', createdAt });
const responses = (waveId: string, count: number, answers: SurveyResponse['answers'] = {}, submitted = true): SurveyResponse[] => Array.from({ length: count }, (_, i) => ({
  id: crypto.randomUUID(), waveId, version: 1, answers: { wish: `Synthetic wish ${i + 1}`, ...answers }, createdAt: i, updatedAt: i, revision: 1, ...(submitted ? { submittedAt: i + 1 } : {}),
}));

test('people are numbered by creation, never named, and only their non-blank answers are kept', () => {
  const insights = compileInsights({
    group,
    now: 42,
    waves: [],
    sheets: [
      sheet('interview', { name: 'Synthetic Person', interviewer: 'Synthetic Interviewer', talk_to: 'Synthetic private note', discipline: ['Developer'], discipline_other: 'Data', date: '2026-11-01', context: 'Synthetic bank', team_why_next: 'Synthetic team answer', tools: 'Claude Code\n\n Cursor ', advice: '  ' }, 2),
      sheet('interview', { name: 'Only metadata', date: '2026-11-02', context: 'No answers' }, 1),
      sheet('interview', { why_start: 'Synthetic legacy answer' }, 3),
      sheet('self', { good: 'Synthetic good', name: 'Self name', talk_to: 'Self note', surprised: 'Synthetic surprise' }, 0),
    ],
  });
  expect(insights.exportedAt).toBe(42);
  expect(insights.interviews.map((person) => person.title)).toEqual(['Interview 1', 'Interview 2']);
  expect(insights.interviews[0].parts).toEqual([
    { title: 'About', answers: [{ label: 'Discipline', text: 'Developer, Data' }, { label: 'Date', text: '2026-11-01' }, { label: 'Client, domain, team', text: 'Synthetic bank' }] },
    { title: 'Tools and techniques they use', answers: [{ items: ['Claude Code', 'Cursor'] }] },
    { title: 'Team', answers: [{ label: 'Next level · Why it matters', text: 'Synthetic team answer' }] },
  ]);
  // Sheets made before dimensions had one grid: it counts as Individual.
  expect(insights.interviews[1].parts).toEqual([{ title: 'Individual', answers: [{ label: 'Getting started · Why it matters', text: 'Synthetic legacy answer' }] }]);
  // Self-submitted maps have no interviewer metadata.
  expect(insights.maps).toEqual([{ title: 'Self-submitted map 1', parts: [
    { title: 'What really good looks like, to you', answers: [{ text: 'Synthetic good' }] },
    { title: 'Reflections', answers: [{ label: 'What surprised you', text: 'Synthetic surprise' }] },
  ] }]);
  const all = JSON.stringify(insights);
  for (const secret of ['Synthetic Person', 'Synthetic Interviewer', 'Synthetic private note', 'Self name', 'Self note', '00000000-']) expect(all).not.toContain(secret);
});

test('survey free text comes from submitted responses only, per wave, hidden under five', () => {
  const small = wave('2026 Q3', 1);
  const large = wave('2026 Q4', 2);
  const insights = compileInsights({
    group,
    sheets: [],
    waves: [
      { wave: large, responses: [...responses(large.id, 5, { workplace: ' Synthetic licences ' }), ...responses(large.id, 3, { wish: 'Synthetic draft' }, false)] },
      { wave: small, responses: responses(small.id, 4) },
    ],
  });
  expect(insights.waves.map(({ name, n, hidden }) => ({ name, n, hidden }))).toEqual([
    { name: '2026 Q3', n: 4, hidden: true },
    { name: '2026 Q4', n: 5, hidden: false },
  ]);
  expect(insights.waves[0].questions).toEqual([]);
  const [wish, workplace] = insights.waves[1].questions;
  expect(wish).toEqual({ prompt: 'One thing that would help you get more out of AI', answers: ['Synthetic wish 1', 'Synthetic wish 2', 'Synthetic wish 3', 'Synthetic wish 4', 'Synthetic wish 5'] });
  expect(workplace.answers).toEqual(Array(5).fill('Synthetic licences'));
  expect(JSON.stringify(insights)).not.toContain('Synthetic draft');
});

test('the Markdown file explains its structure, then lists people and survey text under headings', () => {
  const round = wave('2026 Q4', 1);
  const insights = compileInsights({
    group,
    now: Date.UTC(2026, 10, 10),
    sheets: [sheet('interview', { discipline: ['UX'], ind_learn_start: 'Synthetic first line\n# not a heading', tools: 'Claude Code' }, 1)],
    waves: [{ wave: round, responses: responses(round.id, 5) }],
  });
  const markdown = insightsMarkdown(insights);
  expect(insightsFileName(insights)).toBe('company-a-insights-2026-11-10.md');
  expect(markdown).toStartWith('# Agentic mapping: Company A\n\nExported 2026-11-10 · 1 interview · 0 self-submitted maps · 1 survey wave\n\n## About this file\n');
  expect(markdown).toContain('- Team: how your team works together');
  expect(markdown).toContain('- Next level: what you’re reaching for now');
  expect(markdown).toContain('### Interview 1\n\n#### About\n\n- **Discipline:** UX\n\n#### Tools and techniques they use\n\n- Claude Code\n\n#### Individual\n\n- **Getting started · What to learn:** Synthetic first line\n  \\# not a heading\n');
  expect(markdown).toContain('## Self-submitted maps\n\nNo self-submitted maps with answers.\n');
  expect(markdown).toContain('### 2026 Q4\n\nOpen wave, questionnaire v1, 5 submitted responses.\n\n#### One thing that would help you get more out of AI\n\n- Synthetic wish 1\n');
  // Sheets without a group have no survey.
  expect(insightsMarkdown(compileInsights({ group: null, sheets: [], waves: [] }))).not.toContain('Survey');
});

test('interviewers read a group’s insights and download them as Markdown; nobody else can', async () => {
  const { owner, send, browser, store } = setup();
  await groupWithWave(owner);
  // A participant's own map in the group, and an interview the interviewer fills in.
  await browser()('/company-a', { method: 'POST', form: { revision: '0', surprised: 'Synthetic <b>surprise</b>' } });
  const id = (await owner('/company-a/interviews', { method: 'POST' })).headers.get('Location')!.split('/').pop()!;
  await owner(`/company-a/interviews/${id}`, { method: 'POST', form: { revision: '1', name: 'Synthetic Person', talk_to: 'Synthetic private note', org_learn_good: 'Synthetic org answer' } });
  const elsewhere = { ...sheet('interview', { ind_learn_start: 'Synthetic answer elsewhere' }, 1), group: undefined };
  await store.set(`sheet:${elsewhere.id}`, elsewhere);

  expect((await send('/company-a/insights')).headers.get('Location')).toBe('/sign-in');
  expect((await send('/company-a/insights.md')).headers.get('Location')).toBe('/sign-in');
  expect((await setup({ admin: false }).send('/insights')).status).toBe(404);
  expect((await owner('/company-x/insights')).status).toBe(404);

  const html = await (await owner('/company-a/insights')).text();
  expect(html).toContain('<h1>Insights: Company A</h1>');
  expect(html).toContain('href="/company-a/insights.md"');
  expect(html).toContain('<nav class="insights-toc" aria-label="On this page">');
  expect(html).toContain('Interview 1');
  expect(html).toContain('Self-submitted map 1');
  expect(html).toContain('Synthetic &lt;b&gt;surprise&lt;/b&gt;');
  expect(html).toContain(`Hidden: fewer than 5 submitted responses`);
  expect(html).not.toContain('Synthetic answer elsewhere');

  const file = await owner('/company-a/insights.md');
  expect(file.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8');
  expect(file.headers.get('Content-Disposition')).toMatch(/^attachment; filename\*=UTF-8''company-a-insights-\d{4}-\d{2}-\d{2}\.md$/);
  const markdown = await file.text();
  expect(markdown).toContain('- **Getting good · What to learn:** Synthetic org answer');
  expect(markdown).toContain('- **What surprised you:** Synthetic <b>surprise</b>');
  for (const secret of ['Synthetic Person', 'Synthetic private note', id]) {
    expect(markdown).not.toContain(secret);
    expect(html).not.toContain(secret);
  }

  // Sheets without a group have their own insights, and no survey.
  const none = await (await owner('/insights.md')).text();
  expect(none).toContain('# Agentic mapping: No group');
  expect(none).toContain('Synthetic answer elsewhere');
  expect(none).not.toContain('Survey');
  expect(await (await owner('/insights')).text()).not.toContain('id="survey"');
  // `insights` can't become a group id: its URL is this page.
  expect((await owner('/groups', { method: 'POST', form: { name: 'Insights' } })).status).toBe(422);
});
