import { allSheets, getSheet, putSheet, deleteSheet } from './db.js';

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

// ---------- Dimensions: one 3x3 grid each, shown as tabs ----------

const DIMENSIONS = [
  { key: 'ind', name: 'Individual', hint: 'How you work on your own' },
  { key: 'team', name: 'Team', hint: 'How your team works together' },
  { key: 'org', name: 'Organization', hint: 'What your organization enables or gets in the way of' },
];
const GRID_FIELDS = ['learn', 'why', 'found'].flatMap((q) => ['start', 'good', 'next'].map((l) => `${q}_${l}`));

const tabList = document.getElementById('dim-tabs');
const panelHost = document.getElementById('dim-panels');
const template = document.getElementById('matrix-template');

for (const dim of DIMENSIONS) {
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'dim-tab';
  tab.id = `tab-${dim.key}`;
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-controls', `panel-${dim.key}`);
  tab.dataset.dim = dim.key;
  tab.textContent = dim.name;
  tabList.append(tab);

  const panel = template.content.firstElementChild.cloneNode(true);
  panel.id = `panel-${dim.key}`;
  panel.dataset.dim = dim.key;
  panel.setAttribute('aria-labelledby', tab.id);
  panel.querySelector('.dim-name').textContent = dim.name;
  panel.querySelector('.dim-hint').textContent = dim.hint;
  for (const ta of panel.querySelectorAll('textarea')) ta.name = `${dim.key}_${ta.name}`;
  for (const sr of panel.querySelectorAll('.cell .visually-hidden')) sr.textContent = `${dim.name}: ${sr.textContent}`;
  panelHost.append(panel);
}

function selectDimension(key, { focus = false } = {}) {
  for (const tab of tabList.children) {
    const on = tab.dataset.dim === key;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    if (on && focus) tab.focus();
  }
  for (const panel of panelHost.children) panel.toggleAttribute('data-active', panel.dataset.dim === key);
}

function markFilledDimensions() {
  for (const dim of DIMENSIONS) {
    const filled = [...document.getElementById(`panel-${dim.key}`).querySelectorAll('textarea')].some((t) => t.value.trim());
    const tab = document.getElementById(`tab-${dim.key}`);
    tab.toggleAttribute('data-filled', filled);
    tab.setAttribute('aria-description', filled ? 'Has notes' : 'Empty');
  }
}

tabList.addEventListener('click', (e) => {
  const tab = e.target.closest('[role="tab"]');
  if (tab) selectDimension(tab.dataset.dim);
});
tabList.addEventListener('keydown', (e) => {
  const tabs = [...tabList.children];
  const i = tabs.indexOf(document.activeElement);
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (next === undefined || i < 0) return;
  e.preventDefault();
  selectDimension(tabs[(next + tabs.length) % tabs.length].dataset.dim, { focus: true });
});
selectDimension(DIMENSIONS[0].key);

// ---------- Form <-> data ----------

function readForm() {
  const fields = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') {
      fields[el.name] ??= [];
      if (el.checked) fields[el.name].push(el.value);
    } else {
      fields[el.name] = el.value;
    }
  }
  return fields;
}

function fillForm(fields = {}) {
  // Sheets made before dimensions existed had one grid: treat it as Individual.
  fields = { ...fields };
  for (const name of GRID_FIELDS) {
    if (fields[name] && !fields[`ind_${name}`]) fields[`ind_${name}`] = fields[name];
  }
  for (const el of form.elements) {
    if (!el.name) continue;
    const value = fields[el.name];
    if (el.type === 'checkbox') el.checked = Array.isArray(value) && value.includes(el.value);
    else el.value = value ?? '';
  }
  markFilledDimensions();
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
  if (!current) return;
  current.fields = readForm();
  current.updatedAt = Date.now();
  try {
    await putSheet(current);
    renderList();
    setStatus(`Saved ${new Date(current.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
  } catch (err) {
    setStatus(`Couldn’t save: ${err?.message ?? err}`, 'error');
  }
}

function scheduleSave() {
  setStatus('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
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

// Don't lose the last keystrokes when the tab is hidden or closed.
addEventListener('pagehide', () => saveTimer && save());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && saveTimer) save();
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

function showSheet(sheet) {
  current = sheet;
  fillForm(sheet?.fields);
  form.hidden = !sheet;
  empty.hidden = !!sheet;
  for (const btn of document.querySelectorAll('[data-needs-sheet]')) btn.disabled = !sheet;
  setStatus(sheet ? 'Saved' : '');
  markCurrent();
}

async function openFromHash() {
  if (saveTimer) await save();
  const id = location.hash.slice(1);
  const sheet = id ? await getSheet(id) : null;
  if (sheet) {
    showSheet(sheet);
    if (narrow.matches) setSidebar(false);
    await renderList();
    return;
  }
  // No (valid) sheet in the URL: open the most recently edited one.
  const sheets = await renderList();
  const latest = sheets.toSorted((a, b) => b.updatedAt - a.updatedAt)[0];
  if (latest) location.replace(`#${latest.id}`);
  else showSheet(null);
}

async function newSheet() {
  if (saveTimer) await save();
  const now = Date.now();
  const sheet = {
    id: crypto.randomUUID(),
    fields: { date: new Date().toISOString().slice(0, 10) },
    createdAt: now,
    updatedAt: now,
  };
  await putSheet(sheet);
  history.pushState(null, '', `#${sheet.id}`); // no hashchange, so we control timing
  await openFromHash();
  form.elements.name.focus();
}

async function removeCurrent() {
  if (!current) return;
  document.getElementById('confirm-delete-text').textContent =
    `“${displayName(current)}” will be removed from this browser. This can’t be undone.`;
  confirmDelete.showModal();
  confirmDelete.addEventListener('close', async () => {
    if (confirmDelete.returnValue !== 'delete') return;
    clearTimeout(saveTimer);
    saveTimer = null;
    await deleteSheet(current.id);
    current = null;
    history.replaceState(null, '', location.pathname);
    await openFromHash();
  }, { once: true });
}

// ---------- PDF ----------

async function downloadPdf() {
  await save();
  const previousTitle = document.title;
  // The browser uses the document title as the PDF's default file name.
  document.title = `Capture sheet - ${displayName(current)}${current.fields.date ? ` - ${current.fields.date}` : ''}`;
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

document.addEventListener('click', (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action === 'new') newSheet();
  else if (action === 'delete') removeCurrent();
  else if (action === 'pdf') downloadPdf();
});

addEventListener('hashchange', openFromHash);

setSidebar(initialSidebar());
// Ask the browser not to evict this site's storage under pressure.
navigator.storage?.persist?.();
openFromHash().catch((err) => setStatus(`Couldn’t open storage: ${err?.message ?? err}`, 'error'));
