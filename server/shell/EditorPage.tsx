import type { FormState } from '../framework/formAction';
import { displayName, type Sheet } from '../domain/sheets';
import type { ImportResult } from '../domain/import';
import { Layout } from './Layout';
import { Sheet as SheetForm } from './Sheet';
import { Sidebar, SidebarToggle, type SidebarKind } from './Sidebar';
import { ConfirmButton, DownloadLink, PrintButton, Toolbar } from './Toolbar';

const SCRIPTS = ['elements/autosave-form.js', 'elements/sheet-tabs.js', 'elements/tool-list.js', 'elements/print-button.js', 'elements/copy-button.js'];

// What differs between the interviewer's two lists: interviews and self-submitted maps.
const KINDS = {
  interviews: { one: 'interview', pill: 'Interview', print: 'Interview - {name} - {date}', toggle: 'Show interview list', empty: 'No interviews yet', emptyText: 'Make one for each conversation. Everything you type is saved to the server as you go.' },
  submissions: { one: 'map', pill: 'Self-submitted map', print: 'Self-submitted map - {name}', toggle: 'Show map list', empty: 'No self-submitted maps yet', emptyText: 'Maps people fill in on their own, without an interview link, show up here.' },
};

export type EditorProps = { kind: SidebarKind; sheet: Sheet; sheets: Sheet[]; connectUrl?: string; toolSuggestions?: string[] };

// The interviewer's editor for one sheet: the list beside it, the whole sheet, and its actions.
export function EditorPage({ kind, sheet, sheets, connectUrl, toolSuggestions, form }: EditorProps & { form: FormState }) {
  const labels = KINDS[kind];
  const action = `/${kind}/${sheet.id}`;
  return (
    <Layout title={displayName(sheet)} scripts={SCRIPTS}>
      <div class="app">
        <Sidebar kind={kind} sheets={sheets} currentId={sheet.id} />
        <main class="main">
          <Toolbar status={form.formError ? 'Not saved' : form.saved ? 'Saved to server' : ''} state={form.formError ? 'error' : ''}>
            <SidebarToggle label={labels.toggle} />
            <ConfirmButton id="confirm-delete" variant="danger" label={<span class="btn-text">Delete</span>}>
              <h2 id="confirm-delete-title">{`Delete this ${labels.one}?`}</h2>
              <p id="confirm-delete-text">“{displayName(sheet)}” will be removed from the server for all your devices. This can’t be undone.</p>
              <div class="actions">
                <button type="button" class="btn" commandfor="confirm-delete" command="close" autofocus>Cancel</button>
                {/* Submits the sheet form itself, so the delete carries its current revision. */}
                <button type="submit" class="btn" data-variant="danger" form="sheet" formaction={`${action}/delete`} formnovalidate>{`Delete ${labels.one}`}</button>
              </div>
            </ConfirmButton>
            <DownloadLink href={`${action}.json`} />
            <PrintButton title={labels.print} />
          </Toolbar>
          <SheetForm audience="interviewer" action={action} revision={sheet.revision} fields={sheet.fields} pill={labels.pill} form={form} toolSuggestions={toolSuggestions}>
            {connectUrl && (
              <section class="connect-link" id="connect-link" aria-labelledby="connect-link-label">
                <div>
                  <h2 id="connect-link-label"><label for="connect-link-value">Connect URL</label></h2>
                  <p class="hint">Send privately: the participant can keep filling in their answers on their own computer.</p>
                </div>
                <copy-button for="connect-link-value" class="connect-link-row">
                  <input type="text" id="connect-link-value" value={connectUrl} readonly autocomplete="off" spellcheck={false} />
                  <button type="button" class="btn">Copy</button>
                </copy-button>
              </section>
            )}
          </SheetForm>
        </main>
      </div>
    </Layout>
  );
}

export function EmptyListPage({ kind, sheets }: { kind: SidebarKind; sheets: Sheet[] }) {
  const labels = KINDS[kind];
  return (
    <Layout title={labels.empty}>
      <div class="app">
        <Sidebar kind={kind} sheets={sheets} />
        <main class="main">
          <Toolbar><SidebarToggle label={labels.toggle} /></Toolbar>
          <div class="empty" id="empty">
            <h2>{labels.empty}</h2>
            <p>{labels.emptyText}</p>
            {kind === 'interviews' && <form method="post" action="/interviews"><button type="submit" class="btn" data-variant="primary">New interview</button></form>}
          </div>
        </main>
      </div>
    </Layout>
  );
}

export function NoticePage({ kind, sheets, title, message }: { kind: SidebarKind; sheets: Sheet[]; title: string; message: string }) {
  return (
    <Layout title={title}>
      <div class="app">
        <Sidebar kind={kind} sheets={sheets} />
        <main class="main">
          <Toolbar><SidebarToggle label={KINDS[kind].toggle} /></Toolbar>
          <div class="empty">
            <h2>{title}</h2>
            <p id="notice-text">{message}</p>
          </div>
        </main>
      </div>
    </Layout>
  );
}

export function importMessage({ total, imported, exists, invalid, bySource }: ImportResult) {
  const skipped = [exists && `${exists} skipped: a different sheet with that ID exists`, invalid && `${invalid} skipped: invalid`].filter(Boolean);
  const self = bySource.self ? ` ${bySource.self} of them are self-submitted maps.` : '';
  return `Uploaded ${imported} of ${total} sheets.${self}${skipped.length ? ` ${skipped.join('; ')}.` : ''}`;
}
