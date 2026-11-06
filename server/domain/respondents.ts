import type { Store } from '../store';
import { hashCredential, isToken, newToken } from './credentials';
import { answersOf, hasAnswers, mergeAnswers, RESPONDENT_FIELDS, type Answers } from './fields';
import { groupOf, removeSheet, sourceOf, type Scope, type Sheet } from './sheets';

// `respondent:<hash of browser token>` = { sheetId, linkHash? }: the map a browser cookie finds again without a
// group; `respondent:<hash>:<slug>` is the one in a group, so one browser has one map per group.
// A binding counts only while its sheet exists in that group and, for interviews, the link that connected it is
// still current.
export type Binding = { token: string; key: string; sheet: Sheet | null };

const bindingKey = (token: string, group: Scope) => `respondent:${hashCredential(token)}${group ? `:${group}` : ''}`;

export async function findBinding(store: Store, token: unknown, group: Scope = null): Promise<Binding | null> {
  if (!isToken(token)) return null;
  const key = bindingKey(token, group);
  const binding = await store.get(key);
  const sheet: Sheet | null = binding && await store.get(`sheet:${binding.sheetId}`);
  const current = sheet && groupOf(sheet) === group && (binding.linkHash === undefined || sheet.linkHash === binding.linkHash);
  return { token, key, sheet: current ? sheet : null };
}

// The maps this browser has in any of `groups`, for links back to them.
export async function findBindings(store: Store, token: unknown, groups: Scope[]) {
  const found = await Promise.all(groups.map(async (group) => ({ group, sheet: (await findBinding(store, token, group))?.sheet ?? null })));
  return found.filter((entry): entry is { group: Scope; sheet: Sheet } => Boolean(entry.sheet));
}

export async function bind(store: Store, token: string | undefined, sheet: Sheet) {
  const browserToken = token ?? newToken();
  await store.set(bindingKey(browserToken, groupOf(sheet)), { sheetId: sheet.id, ...(sheet.linkHash ? { linkHash: sheet.linkHash } : {}) });
  return browserToken;
}

// The first save creates the map and the browser token; empty visits store nothing.
export async function createOwnMap(store: Store, token: string | undefined, answers: Answers, group: Scope = null) {
  const now = Date.now();
  const sheet: Sheet = { id: crypto.randomUUID(), source: 'self', ...(group ? { group } : {}), fields: answers, createdAt: now, updatedAt: now, revision: 1 };
  await store.set(`sheet:${sheet.id}`, sheet);
  return { sheet, token: await bind(store, token, sheet) };
}

export async function clearOwnMap(store: Store, binding: Binding) {
  if (binding.sheet && sourceOf(binding.sheet) !== 'self') return false;
  if (binding.sheet) await removeSheet(store, binding.sheet);
  await store.del(binding.key);
  return true;
}

export type Choice = 'merge' | 'interview' | 'mine';
export const CHOICES: Choice[] = ['merge', 'interview', 'mine'];

// The browser's own map, if connecting it to `interview` would need a choice first.
export function ownMapFor(binding: Binding | null, interview: Sheet) {
  const own = binding?.sheet && sourceOf(binding.sheet) === 'self' && binding.sheet.id !== interview.id ? binding.sheet : null;
  return own && hasAnswers(answersOf(own.fields)) ? own : null;
}

// Binds the browser to the interview, combining an own map's answers as chosen; the own map is then deleted.
// `binding` is the browser's binding in the interview's group, so maps in other groups are left alone.
export async function connect(store: Store, binding: Binding | null, interview: Sheet, choice?: Choice) {
  const own = binding?.sheet && sourceOf(binding.sheet) === 'self' && binding.sheet.id !== interview.id ? binding.sheet : null;
  const mine = own ? answersOf(own.fields) : null;
  if (mine && hasAnswers(mine) && choice !== 'interview') {
    const answers = choice === 'merge' ? mergeAnswers(answersOf(interview.fields), mine) : Object.fromEntries(RESPONDENT_FIELDS.map((key) => [key, mine[key] ?? '']));
    await store.set(`sheet:${interview.id}`, { ...interview, fields: { ...interview.fields, ...answers }, updatedAt: Date.now(), revision: interview.revision + 1 });
  }
  const token = await bind(store, binding?.token, interview);
  if (own) await removeSheet(store, own);
  return token;
}
