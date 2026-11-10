// The survey's questions, defined once: steps, forms, schemas, results and the CSV are built from these tables.
// A wave is pinned to the version it opened with, so results stay comparable; change wording in a new version.
// Options are anchored sentences, not bare numbers, so answers mean the same thing to everyone, in every wave.

export type Option = { value: string; label: string; hint?: string };
export type Row = { key: string; label: string; roles?: string[] };
type Base = { name: string; prompt: string; hint?: string; required?: boolean };
export type Question =
  | Base & { kind: 'single'; options: Option[]; display?: 'cards' | 'chips' | 'select'; other?: boolean }
  | Base & { kind: 'multi'; options: Option[]; other?: boolean }
  | Base & { kind: 'matrix'; rows: Row[]; options: Option[]; legend?: boolean }
  | Base & { kind: 'text' };
export type Step = { key: string; title: string; intro: string; questions: Question[] };
export type Survey = { version: number; minutes: number; steps: Step[] };

export type SurveyAnswers = Record<string, string | string[]>;
// Who the context questions are about: the customer you mainly work for, or your own organization.
export type Subject = 'customer' | 'own';

const option = (value: string, label: string, hint?: string): Option => ({ value, label, ...(hint ? { hint } : {}) });

export const ROLES = [
  option('developer', 'Developer'),
  option('ux', 'UX'),
  option('ui', 'UI'),
  option('service-design', 'Service design'),
  option('product', 'Product manager'),
  option('project', 'Project / process'),
  option('data', 'Data / analytics'),
  option('other', 'Other'),
];

// The headline maturity measure: how much of the work people hand to AI, one rung at a time.
export const AUTONOMY = [
  option('none', 'I don’t use AI for work', 'Everything is done by hand.'),
  option('chat', 'I ask questions in a chat', 'Explanations, drafts and ideas I copy from.'),
  option('suggest', 'It suggests while I work', 'Autocomplete and inline suggestions in my tools.'),
  option('stepwise', 'An agent makes changes, I approve each step', 'It edits files or designs; I review every change as it goes.'),
  option('handoff', 'I hand off a whole task and review the result', 'A ticket or a brief in, a finished change out.'),
  option('parallel', 'I run several agents at once', 'In parallel or in the background, while I steer and review.'),
  option('workflow', 'Agents are part of how we work', 'They run in our pipelines, board or reviews, and I supervise.'),
];

const TOOLS = [
  option('claude-code', 'Claude Code'),
  option('codex', 'Codex'),
  option('cursor', 'Cursor'),
  option('github-copilot', 'GitHub Copilot'),
  option('windsurf', 'Windsurf'),
  option('chat-apps', 'ChatGPT, Claude or Gemini apps'),
  option('m365-copilot', 'Microsoft 365 Copilot'),
  option('figma-ai', 'Figma AI'),
  option('builders', 'v0, Lovable or Bolt'),
  option('custom', 'Internal or custom agents'),
  option('other', 'Other'),
];

const AGREE = [
  option('1', 'Strongly disagree'),
  option('2', 'Disagree'),
  option('3', 'Neither'),
  option('4', 'Agree'),
  option('5', 'Strongly agree'),
];

const ALL_BUT_DEV = ['ux', 'ui', 'service-design', 'product', 'project', 'data'];

export const SURVEY_V1: Survey = {
  version: 1,
  minutes: 7,
  steps: [
    {
      key: 'you',
      title: 'About you',
      intro: 'No names. These answers let us compare roles, not people.',
      questions: [
        { kind: 'single', name: 'role', prompt: 'What is your main role?', options: ROLES, display: 'chips', required: true },
        {
          kind: 'single', name: 'experience', prompt: 'How long have you worked in product development?', display: 'chips',
          options: [option('lt3', 'Under 3 years'), option('3-7', '3–7 years'), option('8-15', '8–15 years'), option('gt15', 'Over 15 years')],
        },
        {
          kind: 'single', name: 'context', prompt: 'Who have you mainly worked for these last three months?', required: true,
          hint: 'Later questions ask about them.',
          options: [
            option('customer', 'An external customer', 'On a customer project.'),
            option('own', 'My own organization', 'In-house work.'),
            option('between', 'Between projects', 'Answer about your most recent customer.'),
          ],
        },
      ],
    },
    {
      key: 'often',
      title: 'How often',
      intro: 'Think of the last two weeks, not your best or worst day.',
      questions: [
        {
          kind: 'single', name: 'frequency', prompt: 'In the last two weeks, how often did you use AI at work?',
          options: [
            option('none', 'Not at all'),
            option('rarely', 'Once or twice'),
            option('weekly', 'Every week'),
            option('most-days', 'Most days'),
            option('daily', 'Every day, for much of the day'),
          ],
        },
        {
          kind: 'matrix', name: 'task', prompt: 'For the work you do, how do you use AI today?', hint: 'Skip what isn’t part of your work.',
          options: [option('never', 'Never'), option('tried', 'Tried it'), option('regular', 'Regularly'), option('default', 'It’s how I do it')],
          rows: [
            { key: 'code', label: 'Writing code', roles: ['developer', 'data'] },
            { key: 'review', label: 'Reviewing code', roles: ['developer'] },
            { key: 'test', label: 'Testing and QA', roles: ['developer', 'project'] },
            { key: 'ops', label: 'Debugging and operations', roles: ['developer'] },
            { key: 'research', label: 'Research and discovery', roles: ALL_BUT_DEV },
            { key: 'specs', label: 'Specs, stories and tickets', roles: ['developer', 'ux', 'service-design', 'product', 'project'] },
            { key: 'prototype', label: 'Prototyping and sketching ideas', roles: ['developer', 'ux', 'ui', 'service-design', 'product'] },
            { key: 'visual', label: 'Visual and UI design', roles: ['ux', 'ui'] },
            { key: 'analysis', label: 'Analysis and data', roles: ['data', 'product', 'ux', 'service-design', 'project'] },
            { key: 'planning', label: 'Planning and estimation', roles: ['developer', 'product', 'project'] },
            { key: 'writing', label: 'Writing and communication' },
            { key: 'meetings', label: 'Meeting notes and summaries' },
          ],
        },
      ],
    },
    {
      key: 'tools',
      title: 'Models and tools',
      intro: 'What you actually used in the last month.',
      questions: [
        {
          kind: 'multi', name: 'models', prompt: 'Which models did you use?', hint: 'By family; versions change too often to compare.', other: true,
          options: [
            option('claude', 'Anthropic Claude'),
            option('gpt', 'OpenAI GPT'),
            option('gemini', 'Google Gemini'),
            option('copilot', 'Microsoft Copilot', 'Whatever model it runs.'),
            option('mistral', 'Mistral'),
            option('open', 'Open-weight models', 'Llama, Qwen, DeepSeek…'),
            option('unknown', 'I don’t know which model'),
            option('other', 'Other'),
          ],
        },
        {
          kind: 'single', name: 'model_choice', prompt: 'Who picks the model you use?',
          options: [
            option('me', 'I pick it myself, per task'),
            option('default', 'I use whatever my tool defaults to'),
            option('fixed', 'It’s chosen for me', 'By the customer or my employer.'),
            option('unknown', 'Don’t know'),
          ],
        },
        { kind: 'multi', name: 'tools', prompt: 'Which tools did you use?', options: TOOLS, other: true },
        { kind: 'single', name: 'main_tool', prompt: 'Which one is your main tool?', options: TOOLS, display: 'select' },
        { kind: 'single', name: 'autonomy', prompt: 'Which best describes how you usually work with AI?', hint: 'Pick your usual day, not what you’ve tried once.', options: AUTONOMY },
        {
          kind: 'single', name: 'pays', prompt: 'Who pays for your AI tools?', display: 'chips',
          options: [option('customer', 'The customer'), option('employer', 'My employer'), option('me', 'I do'), option('mixed', 'A mix'), option('free', 'Free tiers only')],
        },
      ],
    },
    {
      key: 'experience',
      title: 'How it’s going',
      intro: 'Your own experience, good and bad.',
      questions: [
        {
          kind: 'matrix', name: 'agree', prompt: 'How much do you agree?', options: AGREE,
          rows: [
            { key: 'enjoy', label: 'I enjoy working with AI.' },
            { key: 'quality', label: 'The quality of my work has improved.' },
            { key: 'faster', label: 'I deliver more in the same time.' },
            { key: 'value', label: 'The people I work for get more value from me.' },
            { key: 'trust', label: 'I use the output without checking it thoroughly.' },
            { key: 'skills', label: 'I worry about losing skills.' },
          ],
        },
        {
          kind: 'single', name: 'time_saved', prompt: 'How much time does AI save you in a normal week?', display: 'chips',
          options: [option('none', 'None'), option('lt1', 'Under an hour'), option('1-3', '1–3 hours'), option('3-8', '3–8 hours'), option('gt8', 'More than 8 hours')],
        },
        {
          kind: 'single', name: 'blocker', prompt: 'What holds you back the most?',
          options: [
            option('rules', 'Rules where I work'),
            option('access', 'No access to the tools I need'),
            option('quality', 'The output isn’t good enough'),
            option('knowhow', 'I don’t know how to get more out of it'),
            option('time', 'No time to learn'),
            option('none', 'Nothing holds me back'),
          ],
        },
      ],
    },
    {
      key: 'context',
      title: '{Subject}',
      intro: 'Your view from where you sit. “Don’t know” is a useful answer.',
      questions: [
        {
          kind: 'single', name: 'expectation', prompt: 'How does {subject} expect you to use AI?',
          options: [
            option('forbids', 'Forbids it', 'Not allowed in our work.'),
            option('tolerates', 'Tolerates it quietly', 'Allowed if nobody has to talk about it.'),
            option('neutral', 'Neutral', 'No stance either way.'),
            option('encourages', 'Encourages it', 'Welcome, and sometimes asked about.'),
            option('expects', 'Expects it', 'Assumed to be part of how we work.'),
            option('requires', 'Requires it and follows up', 'Measured or reported on.'),
            option('unknown', 'Don’t know'),
          ],
        },
        {
          kind: 'matrix', name: 'maturity', prompt: 'How far has {subject} come?', legend: true,
          options: [
            option('none', 'Not there', 'Nothing in place.'),
            option('emerging', 'Emerging', 'First steps, patchy.'),
            option('established', 'Established', 'In place and used.'),
            option('leading', 'Leading', 'Ahead of most, and improving it.'),
            option('unknown', 'Don’t know'),
          ],
          rows: [
            { key: 'policy', label: 'Guidelines and policy for AI' },
            { key: 'tooling', label: 'Approved AI tools' },
            { key: 'data', label: 'Clearance to use AI with code and data' },
            { key: 'leadership', label: 'Leadership’s stance' },
            { key: 'teams', label: 'Use of AI in their own teams' },
            { key: 'product', label: 'AI in the products they build' },
          ],
        },
        {
          kind: 'single', name: 'industry', prompt: 'Which industry is {subject} in?', hint: 'No names: the industry is enough.', display: 'select', other: true,
          options: [
            option('public', 'Public sector'),
            option('finance', 'Finance / insurance'),
            option('energy', 'Energy'),
            option('health', 'Health'),
            option('retail', 'Retail / e-commerce'),
            option('media', 'Media'),
            option('transport', 'Transport / logistics'),
            option('telecom', 'Telecom'),
            option('manufacturing', 'Manufacturing / industry'),
            option('tech', 'Tech / SaaS'),
            option('non-profit', 'Non-profit'),
            option('other', 'Other'),
          ],
        },
        {
          kind: 'single', name: 'size', prompt: 'How many people work on product development at {subject}?', hint: 'Developers, designers, product and data, not everyone employed.', display: 'chips',
          options: [option('lt10', 'Under 10'), option('10-50', '10–50'), option('50-200', '50–200'), option('200-1000', '200–1000'), option('gt1000', 'Over 1000'), option('unknown', 'Don’t know')],
        },
      ],
    },
    {
      key: 'last',
      title: 'Last word',
      intro: 'Optional, and the most useful answer for us to read.',
      questions: [
        { kind: 'text', name: 'wish', prompt: 'One thing that would help you get more out of AI' },
      ],
    },
  ],
};

export const SURVEYS: Record<number, Survey> = { 1: SURVEY_V1 };
export const LATEST_SURVEY = SURVEY_V1;
export const surveyFor = (version: number) => SURVEYS[version] ?? LATEST_SURVEY;

// A matrix row is its own answer, `<question>_<row>`; "Other" options add a short text answer, `<question>_other`.
export const rowField = (question: Question, row: Row) => `${question.name}_${row.key}`;
export const otherField = (question: Question) => `${question.name}_other`;

export const subjectOf = (answers: SurveyAnswers): Subject => (answers.context === 'own' ? 'own' : 'customer');
const SUBJECT_TEXT = { customer: 'your customer', own: 'your organization' };
// Context questions read "your customer" or "your organization", from step 1's answer.
export const phrase = (text: string, subject: Subject) => text
  .replaceAll('{subject}', SUBJECT_TEXT[subject])
  .replaceAll('{Subject}', SUBJECT_TEXT[subject].replace(/^./, (first) => first.toUpperCase()));

// Rows meant for some roles only; without a role, or with "Other", every row shows.
export const rowsFor = (question: Extract<Question, { kind: 'matrix' }>, answers: SurveyAnswers) => {
  const role = typeof answers.role === 'string' ? answers.role : '';
  return question.rows.filter((row) => !row.roles || !role || role === 'other' || row.roles.includes(role));
};

// Every answer name a question can hold, in order.
export const questionFields = (question: Question) => (question.kind === 'matrix'
  ? question.rows.map((row) => rowField(question, row))
  : [question.name, ...('other' in question && question.other ? [otherField(question)] : [])]);
export const surveyFields = (survey: Survey) => survey.steps.flatMap((step) => step.questions.flatMap(questionFields));

export const labelOf = (question: Question, value: string) => (question.kind === 'text' ? value : question.options.find((item) => item.value === value)?.label ?? value);

// What a step's form posted, merged into the stored answers. Checkboxes send nothing when none are ticked, so a
// multi-choice question in the step is cleared then; other questions keep their answer until a new one comes.
export function applyStep(answers: SurveyAnswers, step: Step, posted: SurveyAnswers): SurveyAnswers {
  const result = { ...answers };
  for (const question of step.questions) {
    if (question.kind === 'multi') result[question.name] = [posted[question.name] ?? []].flat();
    for (const name of questionFields(question)) {
      if (question.kind === 'multi' && name === question.name) continue;
      if (posted[name] !== undefined) result[name] = posted[name];
    }
  }
  return result;
}

// Questions a step needs answered before moving on; everything else can be skipped.
export const missingRequired = (step: Step, answers: SurveyAnswers) => step.questions
  .filter((question) => question.required && !(typeof answers[question.name] === 'string' && answers[question.name]))
  .map((question) => question.name);
