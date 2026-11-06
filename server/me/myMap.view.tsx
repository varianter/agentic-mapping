import type { FormState } from '../framework/formAction';
import type { Fields } from '../domain/fields';
import { Layout } from '../shell/Layout';
import { Sheet } from '../shell/Sheet';
import { ConfirmButton, DownloadLink, PrintButton, Toolbar } from '../shell/Toolbar';

export type MyMapProps = { fields: Fields; revision: number; interview: boolean; adminEnabled: boolean };

const today = () => new Date().toISOString().slice(0, 10);

// My map: the respondent's own answers, or the interview a private link connected this browser to.
export function MyMapPage({ fields, revision, interview, adminEnabled, toolSuggestions, form }: MyMapProps & { toolSuggestions?: string[]; form: FormState }) {
  const notice = interview
    ? 'Saved on the server. Your interviewer can read your answers.'
    : adminEnabled
      ? 'Saved on the server, where Variant’s interviewers can read your answers. This browser remembers your map.'
      : 'Saved on the server. This browser remembers your map.';
  return (
    <Layout title="My map" scripts={['elements/autosave-form.js', 'elements/sheet-tabs.js', 'elements/tool-list.js', 'elements/print-button.js']}>
      <div class="app">
        <main class="main">
          <Toolbar status={form.formError ? 'Not saved' : form.saved ? 'Saved to server' : ''} state={form.formError ? 'error' : ''}>
            <span class="toolbar-notice">{notice}</span>
            {adminEnabled && <a href="/sign-in" id="self-sign-in">Interviewer sign-in</a>}
            {/* Interview answers belong to the interviewer's sheet; only an own map can be cleared. */}
            {!interview && (
              <ConfirmButton id="confirm-clear" label="Clear">
                <h2 id="confirm-clear-title">Delete your map?</h2>
                <p>Your answers are deleted from the server. This can’t be undone.</p>
                <form method="post" action="/clear" class="actions" data-clear-map>
                  <button type="button" class="btn" commandfor="confirm-clear" command="close" autofocus>Cancel</button>
                  <button type="submit" class="btn" data-variant="danger">Delete my map</button>
                </form>
              </ConfirmButton>
            )}
            <DownloadLink href="/me.json" currentForm />
            <PrintButton title={`My agentic map - ${today()}`} />
          </Toolbar>
          <Sheet audience="respondent" action="/" revision={revision} fields={fields} pill={interview ? 'Your interview' : 'My map'} form={form} respondentName={!interview} toolSuggestions={toolSuggestions} />
        </main>
      </div>
    </Layout>
  );
}

export function CannotClearPage() {
  return (
    <Layout title="Can’t clear">
      <main class="notice">
        <h1>Interview answers can’t be cleared here</h1>
        <p>Your answers belong to your interview. Ask your interviewer to remove them.</p>
        <p><a class="btn" href="/">Back to your answers</a></p>
      </main>
    </Layout>
  );
}
