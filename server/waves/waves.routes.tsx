import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Group } from '../domain/groups';
import { waveSchema } from '../domain/schemas';
import { createWave, defaultWaveName, getWave, listResponses, listWaves, setWaveStatus, type Wave, type WaveStatus } from '../domain/waves';
import { requireAdmin } from '../framework/auth';
import type { AppEnv } from '../framework/env';
import { formAction } from '../framework/formAction';
import { resolveGroup } from '../framework/group';
import { WavesPage, type WaveRow } from './waves.view';

// The survey's waves in one group, mounted at `/:group/waves`: open, close and reopen them, and their results.
const groupOf = (c: Context<AppEnv>) => c.get('group') as Group;

async function rows(c: Context<AppEnv>): Promise<WaveRow[]> {
  const store = c.get('store');
  const waves = await listWaves(store, groupOf(c).slug);
  return Promise.all(waves.map(async (wave) => {
    const responses = await listResponses(store, wave.id);
    const submitted = responses.filter((response) => response.submittedAt).length;
    return { wave, submitted, drafts: responses.length - submitted };
  }));
}

const page = async (c: Context<AppEnv>) => ({ rows: await rows(c), origin: c.get('origin'), defaultName: defaultWaveName() });

const create = formAction({
  schema: waveSchema,
  loader: async (c: Context<AppEnv>) => ({ group: groupOf(c) }),
  page,
  onSubmit: async (c, { name }, { group }) => {
    const created = await createWave(c.get('store'), group.slug, name);
    return created.ok ? { redirect: `/${group.slug}/waves` } : { formError: created.error, status: 409 };
  },
  view: WavesPage,
});

const status = (to: WaveStatus) => formAction({
  schema: z.strictObject({}),
  loader: async (c) => {
    const wave = await getWave(c.get('store'), groupOf(c).slug, c.req.param('id'));
    return wave ? { group: groupOf(c), wave } : c.notFound();
  },
  page,
  onSubmit: async (c, _data, { group, wave }: { group: Group; wave: Wave }) => {
    const changed = await setWaveStatus(c.get('store'), wave, to);
    return changed.ok ? { redirect: `/${group.slug}/waves` } : { formError: changed.error, status: 409 };
  },
  view: ({ wave: _wave, ...props }) => <WavesPage {...props} />,
});

export const waveRoutes = new Hono<AppEnv>()
  .use(requireAdmin, resolveGroup)
  .on(['GET', 'POST'], '/', create)
  .post('/:id/close', status('closed'))
  .post('/:id/reopen', status('open'));
