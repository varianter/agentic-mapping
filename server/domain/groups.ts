import type { Store } from '../store';

// A group is a workspace for one company: its interviews and self-submitted maps, and the respondent URL
// `/<slug>`. `group:<slug>` = { slug, name, createdAt }. The slug is readable, not secret, and fixed once
// created, so shared links keep working; only the display name can change.
export type Group = { slug: string; name: string; createdAt: number };

// Root paths the app already uses, or may: a group there would hide a page.
export const RESERVED = new Set(['admin', 'api', 'assets', 'clear', 'connect', 'groups', 'guide', 'img', 'insights', 'interviews', 'map', 'me', 'participant', 'sign-in', 'sign-out', 'static', 'submissions']);

const NAME_MAX = 80;

// What someone typed (a name or an id) as a slug: `Company Å ` becomes `company-a`.
export const slugify = (text: string) => text.trim().toLowerCase()
  .replace(/æ/g, 'ae').replace(/[øœ]/g, 'o').replace(/ß/g, 'ss')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');

export const validSlug = (slug: unknown): slug is string => typeof slug === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/.test(slug) && !RESERVED.has(slug);

export const getGroup = async (store: Store, slug: unknown): Promise<Group | null> => (validSlug(slug) ? store.get(`group:${slug}`) : null);

export async function listGroups(store: Store): Promise<Group[]> {
  const groups: (Group | null)[] = await Promise.all((await store.keys('group:')).map((key) => store.get(key)));
  return groups.filter((group): group is Group => Boolean(group)).toSorted((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export type GroupResult = { ok: true; group: Group } | { ok: false; field: 'name' | 'slug'; error: string };

const checkName = (name: string) => (!name ? 'Give the group a name.' : name.length > NAME_MAX ? `Keep the name under ${NAME_MAX} characters.` : null);

// The slug comes from the name unless one is given. Read-check-write, like sheets: a taken slug is never overwritten.
export async function createGroup(store: Store, { name, slug }: { name: string; slug?: string }): Promise<GroupResult> {
  const trimmed = name.trim();
  const nameError = checkName(trimmed);
  if (nameError) return { ok: false, field: 'name', error: nameError };
  const id = slug?.trim() ? slugify(slug) : slugify(trimmed);
  if (RESERVED.has(id)) return { ok: false, field: 'slug', error: `“${id}” is used by the app. Choose another id.` };
  if (!validSlug(id)) return { ok: false, field: 'slug', error: 'Use 2–40 letters, digits or hyphens for the id.' };
  if (await store.get(`group:${id}`)) return { ok: false, field: 'slug', error: `A group with the id “${id}” already exists.` };
  const group: Group = { slug: id, name: trimmed, createdAt: Date.now() };
  await store.set(`group:${id}`, group);
  return { ok: true, group };
}

export async function renameGroup(store: Store, group: Group, name: string): Promise<GroupResult> {
  const trimmed = name.trim();
  const nameError = checkName(trimmed);
  if (nameError) return { ok: false, field: 'name', error: nameError };
  const renamed = { ...group, name: trimmed };
  await store.set(`group:${group.slug}`, renamed);
  return { ok: true, group: renamed };
}

// Where a group's pages live: interviewer lists under `/<slug>/…` (no prefix without a group), and the
// respondent's map at `/<slug>` (`/map` without a group).
export const groupPrefix = (slug: string | null | undefined) => (slug ? `/${slug}` : '');
export const mapPath = (slug: string | null | undefined) => (slug ? `/${slug}` : '/map');
