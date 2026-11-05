import { initForm } from './form.js';
import { downloadJson } from './legacy.js';
import { filledLocalModels, saveLocalModels } from './save-local.js';

export function initEditor(storage, { localMode, localStore }) {
  const { allSheets, getSheet, createSheet, putSheet, deleteSheet, issueAccess, revokeAccess } = storage;
  const savedMessage = localMode ? 'Saved in this browser' : 'Saved to server';
  const savedLocation = localMode ? 'browser' : 'server';
  if (localMode) {
    for (const control of document.querySelectorAll('[data-server-only]')) control.hidden = true;
    document.getElementById('model-list-label').textContent = 'This browser’s models';
    document.getElementById('sidebar').setAttribute('aria-label', 'This browser’s models');
    document.getElementById('local-storage-note').hidden = false;
    document.querySelector('#empty h2').textContent = 'Choose a model';
    document.querySelector('#empty p').textContent = 'Choose one from this browser’s list or create a new model. Models are saved only in this browser.';
  } else document.getElementById('sign-in').hidden = true;

  const app = document.getElementById('app');
  const form = document.getElementById('sheet');
  const list = document.getElementById('sheet-list');
  const listEmpty = document.getElementById('sheet-list-empty');
  const empty = document.getElementById('empty');
  const status = document.getElementById('save-status');
  const toggle = document.getElementById('toggle-sidebar');
  const confirmDelete = document.getElementById('confirm-delete');
  const narrow = matchMedia('(max-width: 900px)');

  let current = null; // the sheet being edited
  let saveTimer = null;
  let dirty = false;
  let saving = null;
  let conflicted = false;
  let navigating = false;
  let actionPending = false;

  const { readForm, fillForm, markFilledDimensions } = initForm(form);

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
    if (conflicted) throw new Error('Download your draft, then reload the saved sheet and merge your notes.');
    saving = (async () => {
      while (dirty && current) {
        const sheet = current;
        const fields = readForm();
        dirty = false;
        setStatus('Saving…');
        try {
          const saved = await (localMode && !sheet.revision ? createSheet : putSheet)({ ...sheet, fields });
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
      setStatus('Unsaved conflict: download JSON, then reload the saved sheet and merge your notes.', 'error');
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
    const sheets = await allSheets();
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
      meta.textContent = [sheet.fields?.date, disciplines.join(', ')].filter(Boolean).join(' · ') || 'No details yet';
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
    document.getElementById('import-json').disabled = busy || localMode;
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
    setStatus(sheet ? (sheet.revision ? savedMessage : 'Unsaved draft in this tab') : '');
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
    if (localMode) return;
    await save();
    const { credential, expiresAt } = await issueAccess(current.id);
    const url = new URL('/participant', location.origin);
    url.hash = credential;
    linkOutput.value = url.href;
    document.getElementById('private-link-expiry').textContent = `Expires ${new Date(expiresAt).toLocaleString()}. Any previous link is now unavailable.`;
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
    if (localMode) return;
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
          setStatus('Sheet unavailable. Choose one from your list or create a new sheet.', 'error');
        }
        await renderList();
        return;
      }
      const sheets = await renderList();
      const latest = sheets.toSorted((a, b) => b.updatedAt - a.updatedAt)[0];
      if (latest) {
        history.replaceState(null, '', `#${latest.id}`);
        showSheet(latest);
      } else if (localMode) await newSheet();
      else showSheet(null);
    } catch (error) {
      if (localMode && !current && !location.hash) showLocalDraft();
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

  function showLocalDraft() {
    const sheet = blankSheet();
    showSheet(sheet);
    dirty = true;
    history.replaceState(null, '', `#${sheet.id}`);
  }

  async function newSheet() {
    await save();
    if (localMode) {
      showLocalDraft();
      await save();
    } else {
      const sheet = await createSheet(blankSheet());
      history.pushState(null, '', `#${sheet.id}`);
      showSheet(sheet);
    }
    await renderList();
  }

  async function removeCurrent() {
    if (!current) return;
    const target = current;
    document.getElementById('confirm-delete-text').textContent =
      `“${displayName(target)}” will be removed ${localMode ? 'from this browser' : 'from the server for all your devices'}. This can’t be undone.`;
    confirmDelete.showModal();
    await new Promise((resolve) => confirmDelete.addEventListener('close', resolve, { once: true }));
    if (confirmDelete.returnValue !== 'delete' || current !== target) return;
    await save();
    if (target.revision) await deleteSheet(target);
    showSheet(null);
    history.replaceState(null, '', location.pathname);
    await openFromHash();
  }

  async function importSheets(file) {
    if (localMode) return;
    if (!file) return;
    await save();
    const sheets = JSON.parse(await file.text());
    if (!Array.isArray(sheets)) throw new Error('Choose a capture-sheet JSON export.');
    let imported = 0;
    try {
      for (const sheet of sheets) {
        await createSheet(sheet);
        imported++;
      }
    } catch (error) {
      throw new Error(`Imported ${imported} of ${sheets.length}. ${error.message} Keep the original export; identical imports can be retried.`);
    } finally {
      await renderList();
    }
    await openFromHash();
    setStatus(`Imported ${imported} sheets to server. Original browser data is unchanged.`);
  }

  async function reloadSaved() {
    if (!current) return;
    if ((dirty || saving) && !confirm(`Discard your unsaved draft and reload the ${savedLocation} copy? Download JSON first to keep your notes.`)) return;
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
      setStatus('Sheet unavailable. Create a new sheet. Keep your downloaded draft to recover your notes.', 'error');
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
    document.title = `Capture sheet - ${displayName({ fields })}${fields.date ? ` - ${fields.date}` : ''}`;
    addEventListener('afterprint', () => { document.title = previousTitle; }, { once: true });
    print();
  }

  // ---------- Sidebar toggle ----------

  function setSidebar(open) {
    app.dataset.sidebar = open ? 'open' : 'closed';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Hide sheet list' : 'Show sheet list');
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

  document.getElementById('import-json').addEventListener('change', (event) => {
    const file = event.target.files[0];
    runAction('import', () => importSheets(file));
    event.target.value = '';
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

  // ---------- Save browser models to the account ----------

  async function offerLocalModels() {
    const key = 'save-local-dismissed';
    try { if (sessionStorage.getItem(key)) return; } catch {}
    let models;
    try { models = await filledLocalModels(localStore); } catch { return; }
    if (!models.length) return;
    const dialog = document.getElementById('save-local');
    const note = document.getElementById('save-local-status');
    const confirm = document.getElementById('save-local-confirm');
    const title = document.getElementById('save-local-title');
    const label = () => { title.textContent = `Save ${models.length} browser model${models.length === 1 ? '' : 's'} to your account?`; };
    label();
    confirm.onclick = async () => {
      confirm.disabled = true;
      const total = models.length;
      const result = await saveLocalModels(localStore, storage, models);
      models = models.slice(result.saved);
      const message = `Saved ${result.saved} of ${total}`;
      note.textContent = result.error ? `${message}. ${result.error.message ?? 'Upload failed.'} Save again to retry the rest.` : message;
      setStatus(message, result.error ? 'error' : '');
      confirm.disabled = false;
      if (result.saved) renderList().catch(reportError);
      if (!result.error) dialog.close('saved');
      else { confirm.textContent = 'Save again'; label(); }
    };
    dialog.addEventListener('close', () => {
      if (dialog.returnValue !== 'saved') { try { sessionStorage.setItem(key, '1'); } catch {} }
    }, { once: true });
    dialog.showModal();
  }
  if (!localMode && localStore) offerLocalModels();
}
