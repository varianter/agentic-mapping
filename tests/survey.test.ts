import { expect, test } from 'bun:test';
import { surveyStepSchema } from '../server/domain/schemas';
import { applyStep, missingRequired, phrase, rowsFor, SURVEY_V1, surveyFields, subjectOf, unevenShares, type Question } from '../server/domain/survey';

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
  expect(schema.safeParse({ revision: '0', models: ['claude', 'gpt'], models_other: 'Synthetic', autonomy: 'handoff' }).data)
    .toEqual({ revision: 0, answers: { models: ['claude', 'gpt'], models_other: 'Synthetic', autonomy: 'handoff' } });
  expect(schema.safeParse({ revision: '0', models: 'claude' }).data?.answers).toEqual({ models: ['claude'] });
  for (const posted of [{ revision: '0', autonomy: 'magic' }, { revision: '0', models: ['claude', 'nope'] }, { revision: '0', role: 'developer' }, { autonomy: 'chat' }]) {
    expect(schema.safeParse(posted).success).toBe(false);
  }
  expect(surveyStepSchema(step('often')).safeParse({ revision: '1', task_code: 'default' }).success).toBe(true);
});

test('saving a step clears unticked checkboxes and keeps everything else', () => {
  const stored = { role: 'developer', models: ['claude'], autonomy: 'chat' };
  expect(applyStep(stored, step('tools'), { autonomy: 'parallel' })).toEqual({ role: 'developer', models: [], tools: [], autonomy: 'parallel' });
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

test('a model split covers only ticked families, takes whole percentages and must add up to 100 once started', () => {
  const tools = step('tools');
  const schema = surveyStepSchema(tools);
  expect(schema.safeParse({ revision: '1', models: ['claude'], share_opus: '30', share_sonnet: '70', share_gpt: '' }).success).toBe(true);
  for (const share of ['101', '-5', '12.5', 'x']) expect(schema.safeParse({ revision: '1', share_opus: share }).success).toBe(false);
  // Unticking a family drops its tiers.
  const merged = applyStep({ share_gpt: '50' }, tools, { models: ['claude'], share_opus: '30', share_sonnet: '60', share_gpt: '10' });
  expect(merged).toMatchObject({ share_opus: '30', share_sonnet: '60' });
  expect(merged.share_gpt).toBeUndefined();
  expect(unevenShares(tools, merged)).toEqual([{ name: 'share', total: 90 }]);
  expect(unevenShares(tools, { ...merged, share_haiku: '10' })).toEqual([]);
  expect(unevenShares(tools, { models: ['claude'] })).toEqual([]);
});
