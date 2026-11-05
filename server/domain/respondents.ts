import type { Store } from '../store';
import { hashCredential, isToken, newToken } from './credentials';
import { answersOf, hasAnswers, mergeAnswers, RESPONDENT_FIELDS, type Answers } from './fields';
import { removeSheet, sourceOf, type Sheet } from './sheets';

// `respondent:<hash of browser token>` = { sheetId, linkHash? }: the map a browser cookie finds again.
// A binding counts only while its sheet exists and, for interviews, the link that connected it is still current.
export type Binding = { token: string; key: string; sheet: Sheet | null };

export async function findBinding(store: Store, token: unknown): Promise<Binding | null> {
  if (!isToken(token)) return null;
  const key = `respondent:${hashCredential(token)}`;
  const binding = await store.get(key);
  const sheet: Sheet | null = binding && await store.get(`sheet:${binding.sheetId}`);
  return { token, key, sheet: sheet && (binding.linkHash === undefined || sheet.linkHash === binding.linkHash) ? sheet : null };
}

export async function bind(store: Store, token: string | undefined, sheet: Sheet) {
  const browserToken = token ?? newToken();
  await store.set(`respondent:${hashCredential(browserToken)}`, { sheetId: sheet.id, ...(sheet.linkHash ? { linkHash: sheet.linkHash } : {}) });
  return browserToken;
}

// The first save creates the map and the browser token; empty visits store nothing.
export async function createOwnMap(store: Store, token: string | undefined, answers: Answers) {
  const now = Date.now();
  const sheet: Sheet = { id: crypto.randomUUID(), source: 'self', fields: answers, createdAt: now, updatedAt: now, revision: 1 };
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
