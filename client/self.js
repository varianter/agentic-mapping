import { initForm, downloadJson } from './form.js';
import { loadMap, saveMap, clearMap } from './self-db.js';

// My map: one browser-only map with the respondent's own answers. Never calls the server.
for (const element of document.querySelectorAll('[data-interviewer]')) element.remove();
document.title = 'My map · Agentic mapping';
document.getElementById('app').dataset.sidebar = 'closed';
document.querySelector('.pill').textContent = 'My map';
document.getElementById('self-sign-in').hidden = !('adminEnabled' in document.body.dataset);

const form = document.getElementById('sheet');
const status = document.getElementById('save-status');
const { readForm, fillForm, markFilledDimensions } = initForm(form);
let saveTimer = null;
let dirty = false;
let saving = null;

function setStatus(message, state = '') {
  status.textContent = message;
  status.dataset.state = state;
}

async function save() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (saving) await saving.catch(() => {});
  if (!dirty) return;
  dirty = false;
  saving = saveMap(readForm());
  try {
    await saving;
    if (!dirty) setStatus('Saved in this browser');
  } catch (error) {
    dirty = true;
    setStatus(`Could not save in this browser: ${error?.message ?? error} Keep this tab open, or download JSON or PDF.`, 'error');
  } finally {
    saving = null;
  }
}

form.addEventListener('input', () => {
  dirty = true;
  markFilledDimensions();
  setStatus('Unsaved changes…');
  clearTimeout(saveTimer);
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

document.getElementById('self-clear').addEventListener('click', async () => {
  if (!confirm('Clear your map from this browser? This can’t be undone.')) return;
  clearTimeout(saveTimer);
  dirty = false;
  if (saving) await saving.catch(() => {});
  try {
    await clearMap();
  } catch {
    setStatus('Could not clear browser storage.', 'error');
    return;
  }
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

try {
  fillForm(await loadMap());
} catch {
  setStatus('Browser storage is unavailable. Your answers will not be kept after reload; download JSON or PDF.', 'error');
}
form.hidden = false;
