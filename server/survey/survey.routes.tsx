import { Hono, type Context } from 'hono';
import type { Group } from '../domain/groups';
import { surveyStepSchema } from '../domain/schemas';
import { applyStep, missingRequired, phrase, subjectOf, surveyFor, unevenShares, type Survey } from '../domain/survey';
import { findResponse, openWave, saveResponse } from '../domain/waves';
import { requireAdminEnabled } from '../framework/auth';
import type { AppEnv } from '../framework/env';
import { formAction } from '../framework/formAction';
import { resolveGroup } from '../framework/group';
import { wantsJson } from '../framework/respond';
import { respondentToken, setRespondentToken } from '../framework/respondentCookie';
import { DonePage, IntroPage, NoSurveyPage, StepPage } from './survey.view';

// The survey people answer, mounted at `/:group/survey`: the group's open wave, one step per page, then a
// summary. Anonymous: the browser cookie finds this browser's answer to the wave, nothing else.
async function load(c: Context<AppEnv>) {
  const store = c.get('store');
  const group = c.get('group') as Group;
  const wave = await openWave(store, group.slug);
  if (!wave) {
    if (c.req.method === 'POST') {
      const message = 'This survey has closed. Your last saved answers are kept.';
      if (wantsJson(c)) return c.json({ error: message }, 409);
      c.status(409);
    }
    return c.render(<NoSurveyPage group={group} />);
  }
  const found = await findResponse(store, respondentToken(c), wave);
  const response = found.response;
  return { group, wave, survey: surveyFor(wave.version), found, answers: response?.answers ?? {}, revision: response?.revision ?? 0, submitted: Boolean(response?.submittedAt) };
}

type Loaded = Exclude<Awaited<ReturnType<typeof load>>, Response>;
type Go = 'next' | 'back' | 'submit' | undefined;

// One form action per questionnaire version and step, made the first time it's needed.
const actions = new Map<string, ReturnType<typeof stepAction>>();
const stepAction = (survey: Survey, index: number) => formAction({
  schema: surveyStepSchema(survey.steps[index]),
  loader: async (c: Context<AppEnv>) => load(c),
  onSubmit: async (c, { revision, wave: rendered, answers: posted }, { group, wave, survey, found, answers }: Loaded) => {
    const closed = { formError: 'This survey has closed. Your last saved answers are kept.', status: 409 as const };
    if (rendered !== wave.id) return closed;
    const step = survey.steps[index];
    const path = `/${group.slug}/survey`;
    const go = (['next', 'back', 'submit'].includes(c.req.query('go') ?? '') ? c.req.query('go') : undefined) as Go;
    const merged = applyStep(answers, step, posted);
    const submit = go === 'submit' && index === survey.steps.length - 1;
    // Moving on needs this step's required answers; submitting needs every step's.
    if (go === 'next' || submit) {
      const missing = missingRequired(step, merged);
      if (missing.length) return { formError: 'Answer the questions marked required to go on.', fieldErrors: Object.fromEntries(missing.map((name) => [name, ['Answer this to go on.']])), status: 422 };
      const [uneven] = unevenShares(step, merged);
      if (uneven) return { formError: `Your ${uneven.group} split adds up to ${uneven.total}%. Make it 100%, or leave it empty.`, fieldErrors: { [uneven.name]: [`Your ${uneven.group} split adds up to ${uneven.total}%, not 100%.`] }, status: 422 };
      const earlier = survey.steps.findIndex((other) => missingRequired(other, merged).length);
      if (submit && earlier >= 0) return { formError: `Step ${earlier + 1}, “${phrase(survey.steps[earlier].title, subjectOf(merged))}”, has a required answer missing. Go back and answer it first.`, status: 422 };
    }
    const saved = await saveResponse(c.get('store'), wave, found, revision, merged, { submit });
    if (!saved.ok) {
      return saved.reason === 'closed'
        ? closed
        : { formError: 'Your answers changed in another tab. Reload this page, then go on.', status: 409 };
    }
    setRespondentToken(c, saved.token);
    const target = submit ? `${path}/done`
      : go === 'next' ? `${path}/${index + 2}`
        : go === 'back' ? (index === 0 ? path : `${path}/${index}`)
          : `${path}/${index + 1}?saved`;
    return { redirect: target, json: { revision: saved.response.revision } };
  },
  view: ({ found: _found, ...props }) => <StepPage {...props} index={index} />,
});

async function step(c: Context<AppEnv>) {
  const index = Number(c.req.param('step')) - 1;
  // The wave (and so the questionnaire) is read again by the action's loader; reads are cheap, steps rare.
  const wave = await openWave(c.get('store'), (c.get('group') as Group).slug);
  const survey = surveyFor(wave?.version ?? 0);
  if (index >= survey.steps.length) return c.notFound();
  const key = `${survey.version}:${index}`;
  const action = actions.get(key) ?? actions.set(key, stepAction(survey, index)).get(key)!;
  return action(c);
}

async function intro(c: Context<AppEnv>) {
  const loaded = await load(c);
  if (loaded instanceof Response) return loaded;
  return c.render(<IntroPage {...loaded} />);
}

async function done(c: Context<AppEnv>) {
  const loaded = await load(c);
  if (loaded instanceof Response) return loaded;
  if (!loaded.submitted) return c.redirect(`/${loaded.group.slug}/survey`, 303);
  return c.render(<DonePage {...loaded} />);
}

export const surveyRoutes = new Hono<AppEnv>()
  .use(requireAdminEnabled, resolveGroup)
  .get('/', intro)
  .get('/done', done)
  .on(['GET', 'POST'], '/:step{[1-9]}', step);
