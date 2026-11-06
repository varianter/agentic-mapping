import { Hono, type Context } from 'hono';
import { answersOf } from '../domain/fields';
import { myMapSchema } from '../domain/schemas';
import { clearOwnMap, createOwnMap, findBinding } from '../domain/respondents';
import { listSheets, saveAnswers, sourceOf, toolSuggestions } from '../domain/sheets';
import type { AppEnv } from '../framework/env';
import { formAction } from '../framework/formAction';
import { clearRespondentToken, respondentToken, setRespondentToken } from '../framework/respondentCookie';
import { CannotClearPage, MyMapPage } from './myMap.view';

const binding = (c: Context<AppEnv>) => findBinding(c.get('store'), respondentToken(c));

const myMap = formAction({
  schema: myMapSchema,
  loader: async (c) => {
    const found = await binding(c);
    return { found, fields: found?.sheet?.fields ?? {}, revision: found?.sheet?.revision ?? 0, interview: found?.sheet ? sourceOf(found.sheet) === 'interview' : false, adminEnabled: Boolean(c.get('adminKey')) };
  },
  // Respondents are anonymous: only suggest what at least two other people listed, never one person's own entry.
  page: async (c, { found }) => ({ toolSuggestions: toolSuggestions(await listSheets(c.get('store')), { exceptId: found?.sheet?.id, minSheets: 2 }) }),
  onSubmit: async (c, { revision, name, answers }, { found, interview }) => {
    const store = c.get('store');
    const stored = found?.sheet;
    // The name on an interview is the interviewer's; the respondent's page has no such field.
    if (interview && name !== undefined) return { formError: 'name: Only your interviewer can change your name.', status: 422 as const };
    const fields = name === undefined ? answers : { ...answers, name };
    const conflict = { formError: 'Your map changed elsewhere or is no longer available. Copy your text, then reload.', status: 409 as const };
    if ((stored?.revision ?? 0) !== revision) return conflict;
    if (!stored) {
      const created = await createOwnMap(store, found?.token, fields);
      setRespondentToken(c, created.token);
      return { redirect: '/?saved', json: { revision: created.sheet.revision } };
    }
    const saved = await saveAnswers(store, stored, revision, fields);
    if (!saved.ok) return conflict;
    setRespondentToken(c, found!.token);
    return { redirect: '/?saved', json: { revision: saved.sheet.revision } };
  },
  view: ({ found: _found, ...props }) => <MyMapPage {...props} />,
});

export const meRoutes = new Hono<AppEnv>()
  // Interviewers start from their interview list.
  .get('/', async (c) => (c.get('admin') ? c.redirect('/interviews', 303) : myMap(c)))
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
    const fields = found?.sheet?.fields;
    const own = !found?.sheet || sourceOf(found.sheet) === 'self';
    return c.json({ fields: { ...(own ? { name: typeof fields?.name === 'string' ? fields.name : '' } : {}), ...answersOf(fields) } });
  });
