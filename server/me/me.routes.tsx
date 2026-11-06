import { Hono, type Context } from 'hono';
import { answersOf } from '../domain/fields';
import { getGroup, listGroups, mapPath, slugify, validSlug, type Group } from '../domain/groups';
import { myMapSchema } from '../domain/schemas';
import { clearOwnMap, createOwnMap, findBinding, findBindings } from '../domain/respondents';
import { listSheets, saveAnswers, sourceOf, toolSuggestions } from '../domain/sheets';
import { requireAdminEnabled } from '../framework/auth';
import type { AppEnv } from '../framework/env';
import { formAction } from '../framework/formAction';
import { wantsJson } from '../framework/respond';
import { respondentToken, setRespondentToken } from '../framework/respondentCookie';
import { JoinPage } from './join.view';
import { CannotClearPage, MyMapPage } from './myMap.view';

// The group the URL names (null at /map), or the join page with a 404 when there is no such group. Paths that
// can't be a group id (`/package.json`) are a plain 404.
async function groupFor(c: Context<AppEnv>): Promise<Group | null | Response> {
  const slug = c.req.param('group');
  if (slug === undefined) return null;
  if (!validSlug(slug)) return c.notFound();
  const group = await getGroup(c.get('store'), slug);
  if (group) return group;
  if (wantsJson(c)) return c.json({ error: 'Not found.' }, 404);
  c.status(404);
  return c.render(<JoinPage typed={slug} error={`No group called “${slug}”. Check the link from your interviewer.`} maps={[]} />);
}

const binding = (c: Context<AppEnv>, group: Group | null) => findBinding(c.get('store'), respondentToken(c), group?.slug ?? null);

const myMap = formAction({
  schema: myMapSchema,
  loader: async (c) => {
    const group = await groupFor(c);
    if (group instanceof Response) return group;
    const found = await binding(c, group);
    return { group, found, fields: found?.sheet?.fields ?? {}, revision: found?.sheet?.revision ?? 0, interview: found?.sheet ? sourceOf(found.sheet) === 'interview' : false, adminEnabled: Boolean(c.get('adminKey')) };
  },
  // Respondents are anonymous: only suggest what at least two other people in the same group listed, never one
  // person's own entry, and never what other groups listed.
  page: async (c, { group, found }) => ({ toolSuggestions: toolSuggestions(await listSheets(c.get('store'), { group: group?.slug ?? null }), { exceptId: found?.sheet?.id, minSheets: 2 }) }),
  onSubmit: async (c, { revision, name, answers }, { group, found, interview }) => {
    const store = c.get('store');
    const stored = found?.sheet;
    const home = mapPath(group?.slug);
    // The name on an interview is the interviewer's; the respondent's page has no such field.
    if (interview && name !== undefined) return { formError: 'name: Only your interviewer can change your name.', status: 422 as const };
    const fields = name === undefined ? answers : { ...answers, name };
    const conflict = { formError: 'Your map changed elsewhere or is no longer available. Copy your text, then reload.', status: 409 as const };
    if ((stored?.revision ?? 0) !== revision) return conflict;
    if (!stored) {
      const created = await createOwnMap(store, found?.token, fields, group?.slug ?? null);
      setRespondentToken(c, created.token);
      return { redirect: `${home}?saved`, json: { revision: created.sheet.revision } };
    }
    const saved = await saveAnswers(store, stored, revision, fields);
    if (!saved.ok) return conflict;
    setRespondentToken(c, found!.token);
    return { redirect: `${home}?saved`, json: { revision: saved.sheet.revision } };
  },
  view: ({ found: _found, ...props }) => <MyMapPage {...props} />,
});

// Interviewers start from their lists, in the same group.
async function showMap(c: Context<AppEnv>) {
  if (!c.get('admin')) return myMap(c);
  const group = await groupFor(c);
  if (group instanceof Response) return group;
  return c.redirect(group ? `/${group.slug}/interviews` : '/interviews', 303);
}

// Clearing deletes this group's map only; the browser cookie stays, since it may find maps in other groups.
async function clear(c: Context<AppEnv>) {
  const group = await groupFor(c);
  if (group instanceof Response) return group;
  const found = await binding(c, group);
  if (found && !await clearOwnMap(c.get('store'), found)) {
    c.status(409);
    return c.render(<CannotClearPage home={mapPath(group?.slug)} />);
  }
  return c.redirect(mapPath(group?.slug), 303);
}

async function download(c: Context<AppEnv>) {
  const group = await groupFor(c);
  if (group instanceof Response) return group;
  const found = await binding(c, group);
  c.header('Content-Disposition', 'attachment; filename="my-agentic-map.json"');
  const fields = found?.sheet?.fields;
  const own = !found?.sheet || sourceOf(found.sheet) === 'self';
  return c.json({ fields: { ...(own ? { name: typeof fields?.name === 'string' ? fields.name : '' } : {}), ...answersOf(fields) } });
}

// The start page: type the group id from your interviewer (a GET form, nothing is written), or go on without one.
// It lists the maps this browser already has, so returning people get back in one click.
async function join(c: Context<AppEnv>) {
  if (c.get('admin')) return c.redirect('/groups', 303);
  // Without interviewers there are no groups: straight to the map.
  if (!c.get('adminKey')) return c.redirect('/map', 303);
  const store = c.get('store');
  const typed = c.req.query('group');
  if (typed !== undefined) {
    // People paste the whole link, or type the name: keep the last path segment, as a slug.
    const slug = slugify(typed.split(/[/?#]/).filter(Boolean).pop() ?? '');
    if (slug && await getGroup(store, slug)) return c.redirect(`/${slug}`, 303);
    c.status(slug ? 404 : 422);
    const error = slug ? `No group called “${slug}”. Check the link from your interviewer.` : 'Enter the group id from your interviewer.';
    return c.render(<JoinPage typed={typed} error={error} maps={[]} />);
  }
  const groups = await listGroups(store);
  const names = new Map(groups.map((group) => [group.slug, group.name]));
  const found = respondentToken(c) ? await findBindings(store, respondentToken(c), [null, ...groups.map((group) => group.slug)]) : [];
  const maps = found.map(({ group, sheet }) => ({ href: mapPath(group), label: group ? names.get(group)! : 'Without a group', interview: sourceOf(sheet) === 'interview' }));
  return c.render(<JoinPage maps={maps} />);
}

export const meRoutes = new Hono<AppEnv>()
  .get('/', join)
  .get('/map', showMap)
  .post('/map', myMap)
  .post('/map/clear', clear)
  .get('/map/me.json', download);

// A group's map at `/<slug>`. Mounted after every other feature, so it never hides their pages.
export const groupMapRoutes = new Hono<AppEnv>()
  .get('/:group', requireAdminEnabled, showMap)
  .post('/:group', requireAdminEnabled, myMap)
  .post('/:group/clear', requireAdminEnabled, clear)
  .get('/:group/me.json', requireAdminEnabled, download);
