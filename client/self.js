import { initForm, downloadJson } from './form.js';

// My map: the respondent's own answers. With interviewers enabled it is saved on the server, where they can
// read it; without them nobody could, so it stays in this browser's IndexedDB.
const serverSaved = 'adminEnabled' in document.body.dataset;
const storage = await import(serverSaved ? './me-db.js' : './self-db.js');
for (const element of document.querySelectorAll('[data-interviewer]')) element.remove();
document.title = 'My map · Agentic mapping';
document.getElementById('app').dataset.sidebar = 'closed';
document.querySelector('.pill').textContent = 'My map';
document.getElementById('self-sign-in').hidden = !serverSaved;

const form = document.getElementById('sheet');
const status = document.getElementById('save-status');
const notice = document.querySelector('.self-notice');
const clearButton = document.getElementById('self-clear');
const { readForm, fillForm, markFilledDimensions } = initForm(form);
const savedMessage = serverSaved ? 'Saved to server' : 'Saved in this browser';
let saveTimer = null;
let dirty = false;
let saving = null;
let conflicted = false;
// Server only: 0 until the first save creates the map.
let revision = 0;

function setStatus(message, state = '') {
  status.textContent = message;
  status.dataset.state = state;
}

function showSource(source) {
  const interview = source === 'interview';
  document.querySelector('.pill').textContent = interview ? 'Your interview' : 'My map';
  notice.textContent = !serverSaved
    ? 'Saved only in this browser, never sent to the server'
    : interview
      ? 'Saved on the server. Your interviewer can read your answers.'
      : 'Saved on the server, where Variant’s interviewers can read your answers. This browser remembers your map.';
  // Interview answers belong to the interviewer's sheet; only an own map can be cleared.
  clearButton.hidden = interview;
}

async function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (saving) await saving.catch(() => {});
  if (!dirty || conflicted) return;
  dirty = false;
  const fields = readForm();
  saving = serverSaved ? storage.saveMap(fields, revision).then((saved) => { revision = saved.revision; }) : storage.saveMap(fields);
  try {
    await saving;
    if (!dirty) setStatus(savedMessage);
  } catch (error) {
    dirty = true;
    conflicted = error?.status === 409;
    setStatus(conflicted
      ? `${error.message}`
      : `Could not save: ${error?.message ?? error} Keep this tab open and keep typing to retry, or download JSON or PDF.`, 'error');
  } finally {
    saving = null;
  }
}

form.addEventListener('input', () => {
  dirty = true;
  markFilledDimensions();
  clearTimeout(saveTimer);
  if (conflicted) return;
  setStatus('Unsaved changes…');
  saveTimer = setTimeout(save, 400);
});
form.addEventListener('submit', (event) => event.preventDefault());
addEventListener('beforeunload', (event) => {
  if (!dirty && !saving) return;
  event.preventDefault();
  event.returnValue = '';
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && dirty) save();
});

clearButton.addEventListener('click', async () => {
  if (!confirm(serverSaved ? 'Delete your map from the server? This can’t be undone.' : 'Clear your map from this browser? This can’t be undone.')) return;
  clearTimeout(saveTimer);
  dirty = false;
  if (saving) await saving.catch(() => {});
  try {
    await storage.clearMap();
  } catch {
    setStatus(serverSaved ? 'Could not delete your map. Try again.' : 'Could not clear browser storage.', 'error');
    return;
  }
  revision = 0;
  conflicted = false;
  fillForm({});
  setStatus('Map cleared');
});
document.getElementById('self-export').addEventListener('click', () => downloadJson({ fields: readForm() }, 'my-agentic-map.json'));
document.getElementById('self-pdf').addEventListener('click', async () => {
  await save();
  const previousTitle = document.title;
  // The browser uses the document title as the PDF's default file name.
  document.title = `My agentic map - ${new Date().toISOString().slice(0, 10)}`;
  addEventListener('afterprint', () => { document.title = previousTitle; }, { once: true });
  print();
});

showSource('self');
if (serverSaved) {
  try {
    const saved = await storage.loadMap();
    revision = saved.revision;
    fillForm(saved.fields);
    showSource(saved.source);
    form.hidden = false;
  } catch {
    // Without the stored revision, a save could create a second map; keep the form closed.
    setStatus('Could not load your map. Reload the page to try again.', 'error');
  }
} else {
  try {
    fillForm(await storage.loadMap());
  } catch {
    setStatus('Browser storage is unavailable. Your answers will not be kept after reload; download JSON or PDF.', 'error');
  }
  form.hidden = false;
}
