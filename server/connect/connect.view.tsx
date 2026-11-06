import { asset } from '../framework/assets';
import { Layout } from '../shell/Layout';

// The one page that needs JS: the private credential is in the URL fragment, which never reaches the server,
// so connect.js posts it in a form body instead.
export function ConnectPage() {
  return (
    <Layout title="Your interview" scripts={['connect.js']}>
      <main class="notice">
        <img src={asset('img/variant-logo-dark.svg')} alt="Variant" width="101" height="24" />
        <h1>Your interview</h1>
        <p id="connect-status" role="status">Opening your interview…</p>
        <noscript><p>This private link needs JavaScript to open, so it never travels in a web address. Turn JavaScript on and reload.</p></noscript>
        <form id="connect-form" method="post" action="/connect" hidden>
          <input type="hidden" name="credential" />
        </form>
      </main>
    </Layout>
  );
}

export function UnavailablePage() {
  return (
    <Layout title="Link unavailable">
      <main class="notice" id="participant-unavailable">
        <h1>Link unavailable</h1>
        <p>Ask your interviewer for a new private link. No other interview has been opened.</p>
        <p><a href="/">Fill in your own map instead</a></p>
      </main>
    </Layout>
  );
}

const answers = (count: number) => `${count} ${count === 1 ? 'answer' : 'answers'}`;

// A browser with its own map chooses how to combine it with the interview; the own map is then deleted.
export function ChoicePage({ credential, mine, interview }: { credential: string; mine: number; interview: number }) {
  return (
    <Layout title="Combine your answers">
      <main class="notice">
        <h1>You already have a map in this browser</h1>
        <p id="connect-choice-text">{`This browser has your own map with ${answers(mine)}. The interview has ${answers(interview)}. Your own map is deleted once you choose.`}</p>
        <p>Merge keeps every answer; where both have one, the interview’s comes first.</p>
        <form method="post" action="/connect" id="connect-choice" class="actions">
          <input type="hidden" name="credential" value={credential} />
          <button class="btn" name="choice" value="interview">Keep interview answers</button>
          <button class="btn" name="choice" value="mine">Replace with my answers</button>
          <button class="btn" data-variant="primary" name="choice" value="merge" autofocus>Merge both</button>
        </form>
      </main>
    </Layout>
  );
}
