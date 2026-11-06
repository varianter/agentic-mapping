import { asset } from '../framework/assets';
import { Layout } from '../shell/Layout';

export type OwnMapLink = { href: string; label: string; interview: boolean };

// The start page: the group id box, the maps this browser already has, and the way on without a group.
export function JoinPage({ typed = '', error, maps }: { typed?: string; error?: string; maps: OwnMapLink[] }) {
  return (
    <Layout title="Start">
      <main class="notice" id="join">
        <img src={asset('img/variant-logo-dark.svg')} alt="Variant" width="101" height="24" />
        <h1>Agentic mapping</h1>
        <p>Enter the group id your interviewer gave you. Your map is saved in that group.</p>
        <form method="get" action="/" id="join-form">
          <div class="field">
            <label class="lbl" for="group">Group id</label>
            <input type="text" id="group" name="group" value={typed} placeholder="company-a" autocomplete="off" autocapitalize="none" spellcheck={false} required autofocus aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'join-error' : undefined} />
          </div>
          {error && <p class="form-error" id="join-error" role="alert">{error}</p>}
          <div class="actions"><button type="submit" class="btn" data-variant="primary">Continue</button></div>
        </form>
        {maps.length > 0 && (
          <section class="own-maps" aria-labelledby="own-maps-label">
            <h2 id="own-maps-label">Your maps in this browser</h2>
            <ul id="own-maps">
              {maps.map((map) => <li><a href={map.href}>{map.label}</a>{map.interview && <span class="hint"> · your interview</span>}</li>)}
            </ul>
          </section>
        )}
        <p class="join-links">
          <a href="/map" id="no-group">Continue without a group</a>
          <a href="/sign-in">Interviewer sign-in</a>
        </p>
      </main>
    </Layout>
  );
}
