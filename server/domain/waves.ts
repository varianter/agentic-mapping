import type { Store } from '../store';
import { hashCredential, isToken, newToken } from './credentials';
import { LATEST_SURVEY, type SurveyAnswers } from './survey';
import { validId } from './sheets';

// A wave is one round of the survey in a group: `wave:<group>:<id>` = { id, group, name, version, status, ... }.
// At most one is open per group, so the group's survey link always means the current round. Waves are never
// deleted: they are the history later rounds are compared with.
export type WaveStatus = 'open' | 'closed';
export type Wave = { id: string; group: string; name: string; version: number; status: WaveStatus; createdAt: number; closedAt?: number };

// One anonymous answer to a wave: `response:<waveId>:<id>`. It holds no name and no browser token; only
// `survey-respondent:<hash of token>:<waveId>` = { responseId } finds it again from the same browser.
// `submittedAt` marks it complete: drafts never count in results.
export type SurveyResponse = { id: string; waveId: string; version: number; answers: SurveyAnswers; createdAt: number; updatedAt: number; submittedAt?: number; revision: number };

const NAME_MAX = 80;
const waveKey = (group: string, id: string) => `wave:${group}:${id}`;
const bindingKey = (token: string, waveId: string) => `survey-respondent:${hashCredential(token)}:${waveId}`;

// `2026 Q4`: waves are usually quarterly.
export const defaultWaveName = (now = Date.now()) => {
  const date = new Date(now);
  return `${date.getUTCFullYear()} Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
};

export const getWave = async (store: Store, group: string, id: unknown): Promise<Wave | null> => (validId(id) ? store.get(waveKey(group, id)) : null);

// Newest first.
export async function listWaves(store: Store, group: string): Promise<Wave[]> {
  const waves: (Wave | null)[] = await Promise.all((await store.keys(`wave:${group}:`)).map((key) => store.get(key)));
  return waves.filter((wave): wave is Wave => Boolean(wave)).toSorted((a, b) => b.createdAt - a.createdAt);
}

export const openWave = async (store: Store, group: string) => (await listWaves(store, group)).find((wave) => wave.status === 'open') ?? null;

export type WaveResult = { ok: true; wave: Wave } | { ok: false; error: string };

const alreadyOpen = (wave: Wave) => ({ ok: false as const, error: `“${wave.name}” is still open. Close it before opening another wave.` });

// A new wave opens at once, with the latest questionnaire. Read-check-write, like sheets.
export async function createWave(store: Store, group: string, name: string, now = Date.now()): Promise<WaveResult> {
  const trimmed = name.trim() || defaultWaveName(now);
  if (trimmed.length > NAME_MAX) return { ok: false, error: `Keep the name under ${NAME_MAX} characters.` };
  const open = await openWave(store, group);
  if (open) return alreadyOpen(open);
  const wave: Wave = { id: crypto.randomUUID(), group, name: trimmed, version: LATEST_SURVEY.version, status: 'open', createdAt: now };
  await store.set(waveKey(group, wave.id), wave);
  return { ok: true, wave };
}

// Closing stops answers coming in; reopening is for the people who missed the deadline.
export async function setWaveStatus(store: Store, wave: Wave, status: WaveStatus): Promise<WaveResult> {
  if (wave.status === status) return { ok: true, wave };
  if (status === 'open') {
    const open = await openWave(store, wave.group);
    if (open) return alreadyOpen(open);
  }
  const { closedAt: _closedAt, ...rest } = wave;
  const updated: Wave = status === 'closed' ? { ...rest, status, closedAt: Date.now() } : { ...rest, status };
  await store.set(waveKey(wave.group, wave.id), updated);
  return { ok: true, wave: updated };
}

export async function listResponses(store: Store, waveId: string): Promise<SurveyResponse[]> {
  const responses: (SurveyResponse | null)[] = await Promise.all((await store.keys(`response:${waveId}:`)).map((key) => store.get(key)));
  return responses.filter((response): response is SurveyResponse => Boolean(response)).toSorted((a, b) => a.createdAt - b.createdAt);
}

export const submittedResponses = async (store: Store, waveId: string) => (await listResponses(store, waveId)).filter((response) => response.submittedAt);

export type ResponseBinding = { token: string | undefined; response: SurveyResponse | null };

// This browser's answer to the wave, if it has one.
export async function findResponse(store: Store, token: unknown, wave: Wave): Promise<ResponseBinding> {
  if (!isToken(token)) return { token: undefined, response: null };
  const binding = await store.get(bindingKey(token, wave.id));
  const response: SurveyResponse | null = binding && await store.get(`response:${wave.id}:${binding.responseId}`);
  return { token, response: response ?? null };
}

export type SavedResponse = { ok: true; response: SurveyResponse; token: string } | { ok: false; reason: 'closed' | 'conflict' };

// The first save creates the response and the browser binding; later saves need the revision the page was
// rendered with. Submitting marks it complete once; it can still be changed while the wave is open.
export async function saveResponse(store: Store, wave: Wave, found: ResponseBinding, revision: number, answers: SurveyAnswers, { submit = false } = {}): Promise<SavedResponse> {
  if (wave.status !== 'open') return { ok: false, reason: 'closed' };
  const stored = found.response;
  if ((stored?.revision ?? 0) !== revision) return { ok: false, reason: 'conflict' };
  const now = Date.now();
  const response: SurveyResponse = stored
    ? { ...stored, answers, updatedAt: now, revision: stored.revision + 1 }
    : { id: crypto.randomUUID(), waveId: wave.id, version: wave.version, answers, createdAt: now, updatedAt: now, revision: 1 };
  if (submit && !response.submittedAt) response.submittedAt = now;
  await store.set(`response:${wave.id}:${response.id}`, response);
  const token = found.token ?? newToken();
  if (!stored) await store.set(bindingKey(token, wave.id), { responseId: response.id });
  return { ok: true, response, token };
}
