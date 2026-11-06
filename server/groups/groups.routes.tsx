import { Hono, type Context } from 'hono';
import { createGroup, getGroup, listGroups, renameGroup, type Group } from '../domain/groups';
import { groupSchema, renameGroupSchema } from '../domain/schemas';
import { groupOf, listSheets, sourceOf } from '../domain/sheets';
import { requireAdmin } from '../framework/auth';
import type { AppEnv } from '../framework/env';
import { formAction } from '../framework/formAction';
import { GroupsPage, type GroupRow } from './groups.view';

// Every group with its sheet counts, then the sheets without a group.
async function rows(c: Context<AppEnv>): Promise<GroupRow[]> {
  const store = c.get('store');
  const [groups, sheets] = await Promise.all([listGroups(store), listSheets(store)]);
  const count = (group: Group | null) => {
    const inGroup = sheets.filter((sheet) => groupOf(sheet) === (group?.slug ?? null));
    return { interviews: inGroup.filter((sheet) => sourceOf(sheet) === 'interview').length, maps: inGroup.filter((sheet) => sourceOf(sheet) === 'self').length };
  };
  return [...groups, null].map((group) => ({ group, ...count(group) }));
}

const page = async (c: Context<AppEnv>) => ({ rows: await rows(c), origin: c.get('origin') });

// New group: from its name, with an optional id; then straight to its (empty) interview list.
const create = formAction({
  schema: groupSchema,
  loader: async () => ({ renaming: undefined }),
  page,
  onSubmit: async (c, input) => {
    const created = await createGroup(c.get('store'), input);
    if (!created.ok) return { formError: created.error, fieldErrors: { [created.field]: [created.error] }, status: 422 };
    return { redirect: `/${created.group.slug}/interviews` };
  },
  view: GroupsPage,
});

// Only the display name changes; the id, and so every shared link, stays.
const rename = formAction({
  schema: renameGroupSchema,
  loader: async (c) => {
    const group = await getGroup(c.get('store'), c.req.param('slug'));
    return group ? { renaming: group.slug, group } : c.notFound();
  },
  page,
  onSubmit: async (c, { name }, { group }) => {
    const renamed = await renameGroup(c.get('store'), group, name);
    if (!renamed.ok) return { formError: renamed.error, fieldErrors: { name: [renamed.error] }, status: 422 };
    return { redirect: '/groups' };
  },
  view: ({ group: _group, ...props }) => <GroupsPage {...props} />,
});

export const groupRoutes = new Hono<AppEnv>()
  .use(requireAdmin)
  .on(['GET', 'POST'], '/', create)
  .post('/:slug', rename);
