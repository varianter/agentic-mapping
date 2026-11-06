import type { Child } from 'hono/jsx';

// The sticky bar above a sheet: save status on the left, page actions on the right.
export function Toolbar({ status = '', state = '', children }: { status?: string; state?: string; children?: Child }) {
  return (
    <div class="toolbar">
      <span class="save-status" id="save-status" role="status" aria-live="polite" data-state={state}>{status}</span>
      <span class="spacer"></span>
      {children}
    </div>
  );
}

// Prints the sheet, after the last autosave; the PDF's default file name comes from `title`.
export function PrintButton({ title }: { title: string }) {
  return (
    <print-button data-title={title}>
      <button type="button" class="btn" data-variant="primary">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>
        <span class="btn-text">Download PDF</span>
      </button>
    </print-button>
  );
}

export function DownloadLink({ href, currentForm = false }: { href: string; currentForm?: boolean }) {
  return (
    <a class="btn" href={href} download data-current-form={currentForm ? '' : undefined}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 4H7a2 2 0 0 0-2 2v4l-2 2 2 2v4a2 2 0 0 0 2 2h1M16 4h1a2 2 0 0 1 2 2v4l2 2-2 2v4a2 2 0 0 1-2 2h-1"/></svg>
      <span class="btn-text">Download JSON</span>
    </a>
  );
}

// A confirm dialog opened by Invoker Commands, with no script. (A GET-form fallback doesn't work: browsers still
// submit a `commandfor` button inside a form until they ship the button "auto" type.)
export function ConfirmButton({ id, label, variant, children }: { id: string; label: Child; variant?: string; children: Child }) {
  return (
    <>
      <button type="button" class="btn" data-variant={variant} commandfor={id} command="show-modal">{label}</button>
      <dialog id={id} aria-labelledby={`${id}-title`}>{children}</dialog>
    </>
  );
}
