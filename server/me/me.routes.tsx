import { Hono, type Context } from 'hono';
import { answersOf } from '../domain/fields';
import { answersSchema } from '../domain/schemas';
import { clearOwnMap, createOwnMap, findBinding } from '../domain/respondents';
import { saveAnswers, sourceOf } from '../domain/sheets';
import type { AppEnv } from '../framework/env';
import { formAction } from '../framework/formAction';
import { clearRespondentToken, respondentToken, setRespondentToken } from '../framework/respondentCookie';
import { CannotClearPage, MyMapPage } from './myMap.view';

const binding = (c: Context<AppEnv>) => findBinding(c.get('store'), respondentToken(c));

const myMap = formAction({
  schema: answersSchema,
  loader: async (c) => {
    const found = await binding(c);
    return { found, fields: found?.sheet?.fields ?? {}, revision: found?.sheet?.revision ?? 0, interview: found?.sheet ? sourceOf(found.sheet) === 'interview' : false, adminEnabled: Boolean(c.get('adminKey')) };
  },
  onSubmit: async (c, { revision, answers }, { found }) => {
    const store = c.get('store');
    const stored = found?.sheet;
    const conflict = { formError: 'Your map changed elsewhere or is no longer available. Copy your text, then reload.', status: 409 as const };
    if ((stored?.revision ?? 0) !== revision) return conflict;
    if (!stored) {
      const created = await createOwnMap(store, found?.token, answers);
      setRespondentToken(c, created.token);
      return { redirect: '/?saved', json: { revision: created.sheet.revision } };
    }
    const saved = await saveAnswers(store, stored, revision, answers);
    if (!saved.ok) return conflict;
    setRespondentToken(c, found!.token);
    return { redirect: '/?saved', json: { revision: saved.sheet.revision } };
  },
  view: ({ found: _found, ...props }) => <MyMapPage {...props} />,
});

export const meRoutes = new Hono<AppEnv>()
  // Interviewers start from their interview list.
  .get('/', async (c, next) => (c.get('admin') ? next() : myMap(c)))
  .post('/', myMap)
  .post('/clear', async (c) => {
    const found = await binding(c);
    if (found && !await clearOwnMap(c.get('store'), found)) {
      c.status(409);
      return c.render(<CannotClearPage />);
    }
    clearRespondentToken(c);
    return c.redirect('/', 303);
  })
  .get('/me.json', async (c) => {
    const found = await binding(c);
    c.header('Content-Disposition', 'attachment; filename="my-agentic-map.json"');
    return c.json({ fields: answersOf(found?.sheet?.fields) });
  });
