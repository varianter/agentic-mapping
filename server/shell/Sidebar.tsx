import { asset } from '../framework/assets';
import { groupPrefix, type Group } from '../domain/groups';
import { displayName, type Sheet } from '../domain/sheets';

export type SidebarKind = 'interviews' | 'submissions';
const LABELS = {
  interviews: { list: 'Interviews', empty: 'No interviews yet.', other: { kind: 'submissions', label: 'Self-submitted maps' } },
  submissions: { list: 'Self-submitted maps', empty: 'No self-submitted maps yet.', other: { kind: 'interviews', label: 'Interviews' } },
};

const meta = (sheet: Sheet, kind: SidebarKind) => {
  const disciplines = [...[sheet.fields.discipline ?? []].flat(), sheet.fields.discipline_other].filter(Boolean);
  return [sheet.fields.date, disciplines.join(', ')].filter(Boolean).join(' · ')
    || (kind === 'submissions' ? `Updated ${new Date(sheet.updatedAt).toISOString().slice(0, 10)}` : 'No details yet');
};

// The interviewer's list beside the sheet: real links, so switching sheets is a normal navigation.
// On phones it is a popover opened from the toolbar (see SidebarToggle). Everything in it is in one group.
export function Sidebar({ kind, sheets, currentId, group }: { kind: SidebarKind; sheets: Sheet[]; currentId?: string; group: Group | null }) {
  const labels = LABELS[kind];
  const prefix = groupPrefix(group?.slug);
  return (
    <aside class="sidebar" id="sidebar" popover="auto" aria-label={labels.list}>
      <div class="sidebar-head">
        <img class="sidebar-logo" src={asset('img/variant-logo-light.svg')} alt="Variant" width="101" height="24" />
        <p class="sidebar-title">Agentic mapping</p>
        <p class="sidebar-group" id="current-group">
          <span>{group ? group.name : 'No group'}</span>
          <a href="/groups" id="switch-group">Switch group</a>
        </p>
        {kind === 'interviews' && (
          <form method="post" action={`${prefix}/interviews`}>
            <button type="submit" class="btn" data-variant="primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
              New interview
            </button>
          </form>
        )}
      </div>
      <p class="sidebar-label" id="sheet-list-label">{labels.list}</p>
      {sheets.length === 0 && <p class="sheet-list-empty">{labels.empty}</p>}
      <ul class="sheet-list" id="sheet-list" aria-labelledby="sheet-list-label">
        {sheets.map((sheet) => (
          <li>
            <a href={`${prefix}/${kind}/${sheet.id}`} data-id={sheet.id} aria-current={sheet.id === currentId ? 'page' : undefined} data-untitled={displayName(sheet) === 'Untitled' ? '' : undefined}>
              <span class="sheet-name">{displayName(sheet)}</span>
              <span class="sheet-meta">{meta(sheet, kind)}</span>
            </a>
          </li>
        ))}
      </ul>
      <nav class="sidebar-foot" aria-label="More">
        <a href={`${prefix}/${labels.other.kind}`} id="view-switch">{labels.other.label}</a>
        <a href="/guide">Interviewer guide</a>
        <form method="post" action={`${prefix}/interviews/import`} enctype="multipart/form-data">
          <label for="upload-file">Upload JSON</label>
          <input type="file" id="upload-file" name="file" accept="application/json,.json" required />
          <button type="submit" class="link-button">Upload</button>
        </form>
        <form method="post" action="/sign-out"><button type="submit" class="link-button" id="sign-out">Sign out</button></form>
      </nav>
    </aside>
  );
}

export function SidebarToggle({ label }: { label: string }) {
  return (
    <button type="button" class="btn sidebar-toggle" data-variant="icon" popovertarget="sidebar" aria-label={label}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>
    </button>
  );
}
