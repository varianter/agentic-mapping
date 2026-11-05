import { initForm, downloadJson } from './form.js';

// Interviewer editor: server-stored interviews, private links and PDFs.
export function initEditor(storage) {
  const { allSheets, getSheet, createSheet, putSheet, deleteSheet, issueAccess, revokeAccess } = storage;
  const savedMessage = 'Saved to server';

  const app = document.getElementById('app');
  const form = document.getElementById('sheet');
  const list = document.getElementById('sheet-list');
  const listEmpty = document.getElementById('sheet-list-empty');
  const empty = document.getElementById('empty');
  const status = document.getElementById('save-status');
  const toggle = document.getElementById('toggle-sidebar');
  const confirmDelete = document.getElementById('confirm-delete');
  const narrow = matchMedia('(max-width: 900px)');
  // /submissions lists maps people filled in on their own; / lists interviews.
  const submissions = document.body.dataset.view === 'submissions';
  const source = submissions ? 'self' : 'interview';

  let current = null; // the interview being edited
  let saveTimer = null;
  let dirty = false;
  let saving = null;
  let conflicted = false;
  let navigating = false;
  let actionPending = false;

  const { readForm, fillForm, markFilledDimensions } = initForm(form);

  if (submissions) {
    for (const element of document.querySelectorAll('[data-action="new"], [data-action="issue-access"], [data-action="revoke-access"]')) element.remove();
    document.title = 'Self-submitted maps · Agentic mapping';
    document.getElementById('sidebar').setAttribute('aria-label', 'Self-submitted maps');
    document.getElementById('model-list-label').textContent = 'Self-submitted maps';
    listEmpty.textContent = 'No self-submitted maps yet.';
    empty.querySelector('h2').textContent = 'No self-submitted maps yet';
    empty.querySelector('p').textContent = 'Maps people fill in on their own, without an interview link, show up here.';
    const viewSwitch = document.getElementById('view-switch');
    viewSwitch.href = '/';
    viewSwitch.textContent = 'Interviews';
  }

  const displayName = (sheet) => sheet.fields?.name?.trim() || 'Untitled';

  // ---------- Saving ----------

  function setStatus(text, state = '') {
    status.textContent = text;
    status.dataset.state = state;
  }

  async function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (saving) return saving;
    if (!dirty || !current) return;
    if (conflicted) throw new Error('Download your draft, then reload the saved interview and merge your notes.');
    saving = (async () => {
      while (dirty && current) {
        const sheet = current;
        const fields = readForm();
        dirty = false;
        setStatus('Saving…');
        try {
          const saved = await putSheet({ ...sheet, fields });
          sheet.revision = saved.revision;
          sheet.updatedAt = saved.updatedAt;
          sheet.fields = fields;
        } catch (error) {
          dirty = true;
          conflicted = [404, 409].includes(error.status);
          throw error;
        }
      }
      setStatus(savedMessage);
      renderList().catch(reportError);
    })();
    try {
      await saving;
    } finally {
      saving = null;
    }
  }

  function reportError(error) {
    setStatus(`Couldn’t complete: ${error?.message ?? error} Retry storage.${dirty ? ' Your draft is unsaved; keep editing, print PDF or download JSON.' : ''}`, 'error');
  }

  function scheduleSave() {
    dirty = true;
    setStatus('Unsaved changes…');
    clearTimeout(saveTimer);
    if (conflicted) {
      setStatus('Unsaved conflict: download JSON, then reload the saved interview and merge your notes.', 'error');
      return;
    }
    saveTimer = setTimeout(() => save().catch(reportError), 400);
  }

  form.addEventListener('input', (e) => {
    scheduleSave();
    if (e.target.closest('.dim-panel')) markFilledDimensions();
    if (e.target.name === 'name' && current) {
      current.fields.name = e.target.value;
      renderListItemName(current);
    }
  });
  form.addEventListener('submit', (e) => e.preventDefault());

  addEventListener('beforeunload', (event) => {
    if (!dirty && !saving) return;
    event.preventDefault();
    event.returnValue = '';
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && dirty) save().catch(reportError);
  });

  // ---------- Sidebar list ----------

  async function renderList() {
    const sheets = await allSheets(source);
    sheets.sort((a, b) => {
      const an = a.fields?.name?.trim(), bn = b.fields?.name?.trim();
      if (!an !== !bn) return an ? -1 : 1; // untitled last
      return (an ?? '').localeCompare(bn ?? '', undefined, { sensitivity: 'base' }) || b.updatedAt - a.updatedAt;
    });

    list.replaceChildren(...sheets.map((sheet) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `#${sheet.id}`;
      a.dataset.id = sheet.id;
      const name = document.createElement('span');
      name.className = 'sheet-name';
      const meta = document.createElement('span');
      meta.className = 'sheet-meta';
      const disciplines = [...(sheet.fields?.discipline ?? []), sheet.fields?.discipline_other].filter(Boolean);
      meta.textContent = [sheet.fields?.date, disciplines.join(', ')].filter(Boolean).join(' · ')
        || (submissions ? `Updated ${new Date(sheet.updatedAt).toISOString().slice(0, 10)}` : 'No details yet');
      a.append(name, meta);
      li.append(a);
      renderListItemName(sheet, a);
      return li;
    }));

    listEmpty.hidden = sheets.length > 0;
    markCurrent();
    return sheets;
  }

  function renderListItemName(sheet, a = list.querySelector(`a[data-id="${sheet.id}"]`)) {
    if (!a) return;
    a.querySelector('.sheet-name').textContent = displayName(sheet);
    a.classList.toggle('untitled', !sheet.fields?.name?.trim());
  }

  function markCurrent() {
    for (const a of list.querySelectorAll('a')) {
      if (a.dataset.id === current?.id) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  }

  // ---------- Opening / creating / deleting ----------

  function updateControls() {
    const busy = navigating || actionPending;
    form.inert = busy;
    for (const button of document.querySelectorAll('[data-action]')) {
      button.disabled = busy || (button.hasAttribute('data-needs-sheet') && !current);
    }
  }

  function showSheet(sheet) {
    clearPrivateLink();
    current = sheet;
    fillForm(sheet?.fields);
    form.hidden = !sheet;
    empty.hidden = !!sheet;
    updateControls();
    dirty = false;
    conflicted = false;
    setStatus(sheet ? savedMessage : '');
    markCurrent();
  }

  // ---------- Private participant links ----------

  const linkDialog = document.getElementById('private-link');
  const linkOutput = document.getElementById('private-link-value');
  function clearPrivateLink() {
    linkDialog.close();
    linkOutput.value = '';
  }
  linkDialog.addEventListener('close', () => { linkOutput.value = ''; });

  async function generatePrivateLink() {
    await save();
    const { credential } = await issueAccess(current.id);
    const url = new URL('/participant', location.origin);
    url.hash = credential;
    linkOutput.value = url.href;
    document.getElementById('private-link-copy-status').textContent = '';
    linkDialog.showModal();
  }

  document.getElementById('copy-private-link').addEventListener('click', async () => {
    const feedback = document.getElementById('private-link-copy-status');
    try {
      await navigator.clipboard.writeText(linkOutput.value);
      feedback.textContent = 'Private link copied.';
    } catch {
      linkOutput.focus();
      linkOutput.select();
      feedback.textContent = 'Select and copy the private link above.';
    }
  });

  async function revokePrivateLink() {
    await revokeAccess(current.id);
    clearPrivateLink();
    setStatus('Private link revoked. Open participant forms can no longer read or save.');
  }

  async function openFromHash() {
    if (navigating) {
      if (current) history.replaceState(null, '', `#${current.id}`);
      return;
    }
    navigating = true;
    updateControls();
    try {
      await save();
      const id = location.hash.slice(1);
      if (id) {
        try {
          const sheet = await getSheet(id);
          showSheet(sheet);
          if (narrow.matches) setSidebar(false);
        } catch (error) {
          if (error.status !== 404) throw error;
          showSheet(null);
          setStatus('Interview unavailable. Choose one from your list or create a new interview.', 'error');
        }
        await renderList();
        return;
      }
      const sheets = await renderList();
      const latest = sheets.toSorted((a, b) => b.updatedAt - a.updatedAt)[0];
      if (latest) {
        history.replaceState(null, '', `#${latest.id}`);
        showSheet(latest);
      } else showSheet(null);
    } catch (error) {
      if (current) history.replaceState(null, '', `#${current.id}`);
      throw error;
    } finally {
      navigating = false;
      updateControls();
    }
  }

  function blankSheet() {
    const now = Date.now();
    return { id: crypto.randomUUID(), fields: { date: new Date().toISOString().slice(0, 10) }, createdAt: now, updatedAt: now };
  }

  async function newSheet() {
    await save();
    const sheet = await createSheet(blankSheet());
    history.pushState(null, '', `#${sheet.id}`);
    showSheet(sheet);
    await renderList();
  }

  async function removeCurrent() {
    if (!current) return;
    const target = current;
    document.getElementById('confirm-delete-text').textContent =
      `“${displayName(target)}” will be removed from the server for all your devices. This can’t be undone.`;
    confirmDelete.showModal();
    await new Promise((resolve) => confirmDelete.addEventListener('close', resolve, { once: true }));
    if (confirmDelete.returnValue !== 'delete' || current !== target) return;
    await save();
    await deleteSheet(target);
    showSheet(null);
    history.replaceState(null, '', location.pathname);
    await openFromHash();
  }

  async function reloadSaved() {
    if (!current) return;
    if ((dirty || saving) && !confirm(`Discard your unsaved draft and reload the server copy? Download JSON first to keep your notes.`)) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    if (saving) await saving.catch(() => {});
    try {
      const saved = await getSheet(current.id);
      showSheet(saved);
    } catch (error) {
      if (error.status !== 404) throw error;
      showSheet(null);
      history.replaceState(null, '', location.pathname);
      setStatus('Interview unavailable. Create a new interview or use your downloaded draft.', 'error');
    }
    await renderList();
  }

  async function retryStorage() {
    if (!current) return openFromHash();
    if (dirty) return save();
    await renderList();
    setStatus(savedMessage);
  }

  // ---------- PDF ----------

  async function downloadPdf() {
    await save().catch(reportError);
    const previousTitle = document.title;
    // The browser uses the document title as the PDF's default file name.
    const fields = readForm();
    document.title = `Interview - ${displayName({ fields })}${fields.date ? ` - ${fields.date}` : ''}`;
    addEventListener('afterprint', () => { document.title = previousTitle; }, { once: true });
    print();
  }

  // ---------- Sidebar toggle ----------

  function setSidebar(open) {
    app.dataset.sidebar = open ? 'open' : 'closed';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Hide interview list' : 'Show interview list');
    if (!narrow.matches) {
      try { localStorage.setItem('sidebar', open ? 'open' : 'closed'); } catch {}
    }
  }

  function initialSidebar() {
    if (narrow.matches) return false;
    try { return localStorage.getItem('sidebar') !== 'closed'; } catch { return true; }
  }

  toggle.addEventListener('click', () => setSidebar(app.dataset.sidebar !== 'open'));
  narrow.addEventListener('change', () => setSidebar(initialSidebar()));
  document.getElementById('sidebar').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && narrow.matches) {
      setSidebar(false);
      toggle.focus();
    }
  });

  // ---------- Wiring ----------

  async function runAction(action, handler) {
    if (actionPending || navigating) return;
    actionPending = true;
    updateControls();
    try {
      await handler();
    } catch (error) {
      reportError(error);
    } finally {
      actionPending = false;
      updateControls();
      if (action === 'new' && current) form.elements.name.focus();
    }
  }

  document.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    const handlers = { new: newSheet, delete: removeCurrent, pdf: downloadPdf, retry: retryStorage, reload: reloadSaved, 'issue-access': generatePrivateLink, 'revoke-access': revokePrivateLink, export: () => downloadJson(current ? [{ ...current, fields: readForm() }] : []) };
    if (handlers[action]) runAction(action, handlers[action]);
  });

  addEventListener('hashchange', () => {
    if (actionPending) {
      history.replaceState(null, '', current ? `#${current.id}` : location.pathname);
      return;
    }
    openFromHash().catch(reportError);
  });

  setSidebar(initialSidebar());
  openFromHash().catch(reportError);
}
