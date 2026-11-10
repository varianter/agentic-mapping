import { expect, test } from 'bun:test';
import { surveyStepSchema } from '../server/domain/schemas';
import { applyStep, keepSubject, missingRequired, phrase, rowsFor, SURVEY_V1, surveyFields, subjectOf, unevenShares, type Question } from '../server/domain/survey';

const step = (key: string) => SURVEY_V1.steps.find((item) => item.key === key)!;
const matrix = (stepKey: string, name: string) => step(stepKey).questions.find((question) => question.name === name) as Extract<Question, { kind: 'matrix' }>;

test('every answer name is unique, and every choice has distinct values', () => {
  const fields = surveyFields(SURVEY_V1);
  expect(new Set(fields).size).toBe(fields.length);
  for (const question of SURVEY_V1.steps.flatMap((item) => item.questions)) {
    if (question.kind === 'text' || question.kind === 'shares') continue;
    const values = question.options.map((item) => item.value);
    expect(new Set(values).size).toBe(values.length);
  }
});

test('a step accepts only its own questions and their options', () => {
  const schema = surveyStepSchema(step('tools'));
  expect(schema.safeParse({ revision: '0', wave: 'w', models: ['claude', 'gpt'], models_other: 'Synthetic', autonomy: 'handoff' }).data)
    .toEqual({ revision: 0, wave: 'w', answers: { models: ['claude', 'gpt'], models_other: 'Synthetic', autonomy: 'handoff' } });
  expect(schema.safeParse({ revision: '0', wave: 'w', models: 'claude' }).data?.answers).toEqual({ models: ['claude'] });
  for (const posted of [{ revision: '0', wave: 'w', autonomy: 'magic' }, { revision: '0', wave: 'w', models: ['claude', 'nope'] }, { revision: '0', wave: 'w', role: 'developer' }, { wave: 'w', autonomy: 'chat' }, { revision: '0', autonomy: 'chat' }]) {
    expect(schema.safeParse(posted).success).toBe(false);
  }
  expect(surveyStepSchema(step('often')).safeParse({ revision: '1', wave: 'w', task_code: 'default' }).success).toBe(true);
});

test('saving a step clears unticked checkboxes and keeps everything else', () => {
  const stored = { role: 'developer', models: ['claude'], autonomy: 'chat' };
  expect(applyStep(stored, step('tools'), { autonomy: 'parallel' })).toEqual({ role: 'developer', models: [], tools: [], pays: [], autonomy: 'parallel' });
  expect(missingRequired(step('you'), { role: 'ux' })).toEqual(['context']);
  expect(missingRequired(step('you'), { role: 'ux', context: 'own' })).toEqual([]);
});

test('task rows follow the role, and context questions follow who you work for', () => {
  const tasks = matrix('often', 'task');
  const keys = (answers: Record<string, string>) => rowsFor(tasks, answers).map((row) => row.key);
  expect(keys({ role: 'developer' })).toContain('code');
  expect(keys({ role: 'ui' })).not.toContain('code');
  expect(keys({ role: 'ui' })).toContain('visual');
  expect(keys({})).toHaveLength(tasks.rows.length);
  expect(keys({ role: 'other' })).toHaveLength(tasks.rows.length);
  expect(phrase('{Subject}: how does {subject} expect you to work?', subjectOf({ context: 'between' }))).toBe('Your customer: how does your customer expect you to work?');
  expect(phrase('{Subject}', subjectOf({ context: 'own' }))).toBe('Your organization');
});

test('listing other tools ticks Other, emptying the list unticks it, and the list may be longer than a short answer', () => {
  const tools = step('tools');
  expect(applyStep({}, tools, { tools: ['cursor'], tools_other: 'Aider\nZed' })).toMatchObject({ tools: ['cursor', 'other'], tools_other: 'Aider\nZed' });
  expect(applyStep({ tools: ['other'], tools_other: 'Aider' }, tools, { tools: ['cursor', 'other'], tools_other: '\n' }).tools).toEqual(['cursor']);
  expect(surveyStepSchema(tools).safeParse({ revision: '1', wave: 'w', tools_other: 'x'.repeat(1500) }).success).toBe(true);
  expect(surveyStepSchema(tools).safeParse({ revision: '1', wave: 'w', models_other: 'x'.repeat(300) }).success).toBe(false);
});

test('each ticked provider’s split takes whole percentages and must add up to 100 once started', () => {
  const tools = step('tools');
  const schema = surveyStepSchema(tools);
  expect(schema.safeParse({ revision: '1', wave: 'w', models: ['claude'], share_opus: '30', share_sonnet: '70', share_gpt: '' }).success).toBe(true);
  for (const share of ['101', '-5', '12.5', 'x']) expect(schema.safeParse({ revision: '1', wave: 'w', share_opus: share }).success).toBe(false);
  // Unticking a family drops its tiers.
  const merged = applyStep({ share_gemini: '50' }, tools, { models: ['claude', 'gpt'], share_opus: '30', share_sonnet: '60', share_gpt: '100', 'share_gemini-pro': '10' });
  expect(merged).toMatchObject({ share_opus: '30', share_sonnet: '60', share_gpt: '100' });
  expect(merged['share_gemini-pro']).toBeUndefined();
  expect(unevenShares(tools, merged)).toEqual([{ name: 'share', group: 'Anthropic Claude', total: 90 }]);
  expect(unevenShares(tools, { ...merged, share_haiku: '10' })).toEqual([]);
  // A provider left empty is skipped, even when another is filled in.
  expect(unevenShares(tools, { models: ['claude', 'gpt'], share_opus: '100' })).toEqual([]);
});

test('changing who the context step is about clears its answers; customer and between are the same subject', () => {
  const stored = { context: 'customer', role: 'ux', expectation: 'expects', industry: 'energy', industry_other: 'x', maturity_policy: 'emerging' };
  expect(keepSubject(SURVEY_V1, stored, { ...stored, context: 'own' })).toEqual({ context: 'own', role: 'ux' });
  expect(keepSubject(SURVEY_V1, stored, { ...stored, context: 'between' })).toEqual({ ...stored, context: 'between' });
});
