import { expect, test } from 'bun:test';
import { compileInsights } from '../server/domain/insights';
import type { Sheet } from '../server/domain/sheets';
import type { SurveyResponse, Wave } from '../server/domain/waves';

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
