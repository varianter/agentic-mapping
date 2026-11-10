import type { Group } from '../domain/groups';
import type { Wave } from '../domain/waves';
import { asset } from '../framework/assets';
import type { FormState } from '../framework/formAction';
import { Layout } from '../shell/Layout';

export type WaveRow = { wave: Wave; submitted: number; drafts: number };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const day = (time: number) => new Date(time).toISOString().slice(0, 10);

// The survey link people open, while a wave is open. `form` belongs to the action that failed, if any.
export function WavesPage({ group, rows, origin, defaultName, form }: { group: Group; rows: WaveRow[]; origin: string; defaultName: string; form: FormState }) {
  const open = rows.find((row) => row.wave.status === 'open');
  const name = typeof form.values.name === 'string' ? form.values.name : '';
  return (
    <Layout title={`Survey · ${group.name}`} scripts={['elements/copy-button.js']}>
      <main class="groups-page">
        <header class="groups-head">
          <img src={asset('img/variant-logo-dark.svg')} alt="Variant" width="101" height="24" />
          <h1>{`Survey · ${group.name}`}</h1>
          <p>A short, anonymous survey on AI at work. Open a wave, share the link, close it when you have your answers. Run a new wave in a few months to see what changed.</p>
        </header>

        {form.formError && <p class="form-error" role="alert">{form.formError}</p>}

        {open ? (
          <section class="group-new" aria-labelledby="survey-link-label">
            <h2 id="survey-link-label">{`Link for ${open.wave.name}`}</h2>
            <p class="hint">The same link works for every wave: it always opens the one that’s open.</p>
            <copy-button for="survey-link" what="survey link" class="connect-link-row">
              <label class="visually-hidden" for="survey-link">Survey link</label>
              <input type="text" id="survey-link" value={`${origin}/${group.slug}/survey`} readonly autocomplete="off" spellcheck={false} />
              <button type="button" class="btn" data-variant="small">Copy</button>
            </copy-button>
          </section>
        ) : (
          <section class="group-new" aria-labelledby="wave-new-label">
            <h2 id="wave-new-label">Open a new wave</h2>
            <form method="post" action={`/${group.slug}/waves`} id="wave-create">
              <div class="field">
                <label class="lbl" for="wave-name">Name</label>
                <input type="text" id="wave-name" name="name" value={name} placeholder={defaultName} />
              </div>
              <div class="actions"><button type="submit" class="btn" data-variant="primary">Open wave</button></div>
            </form>
          </section>
        )}

        {rows.length > 0 && (
          <ul class="group-list" id="wave-list" aria-label="Waves">
            {rows.map(({ wave, submitted, drafts }) => (
              <li id={`wave-${wave.id}`}>
                <div class="group-row-head">
                  <h2>{wave.name} <span class="pill" data-variant={wave.status}>{wave.status === 'open' ? 'Open' : 'Closed'}</span></h2>
                  <p class="hint">{[`Opened ${day(wave.createdAt)}`, wave.closedAt && `closed ${day(wave.closedAt)}`, plural(submitted, 'answer', 'answers'), drafts && `${drafts} in progress`].filter(Boolean).join(' · ')}</p>
                </div>
                <nav class="group-row-links" aria-label={wave.name}>
                  <a class="btn" data-variant="small" href={`/${group.slug}/waves/${wave.id}`}>Results</a>
                  <a class="btn" data-variant="small" href={`/${group.slug}/waves/${wave.id}.csv`} download>Download CSV</a>
                  <form method="post" action={`/${group.slug}/waves/${wave.id}/${wave.status === 'open' ? 'close' : 'reopen'}`}>
                    <button type="submit" class="btn" data-variant="small">{wave.status === 'open' ? 'Close wave' : 'Reopen'}</button>
                  </form>
                </nav>
              </li>
            ))}
          </ul>
        )}

        <nav class="groups-foot" aria-label="More">
          <a href="/groups">All groups</a>
          <a href={`/${group.slug}/interviews`}>Interviews</a>
          <a href={`/${group.slug}/survey`}>Preview the survey</a>
        </nav>
      </main>
    </Layout>
  );
}
