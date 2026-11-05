import { initForm, downloadJson } from './form.js';

// This entrypoint never imports interviewer storage or loads a sheet list.
for (const element of document.querySelectorAll('[data-interviewer]')) element.remove();
document.title = 'Finish your interview · Agentic mapping';
document.getElementById('app').dataset.sidebar = 'closed';
document.querySelector('.pill').textContent = 'Your interview';

const form = document.getElementById('sheet');
const status = document.getElementById('save-status');
const unavailable = document.getElementById('participant-unavailable');
const saveButton = document.getElementById('participant-save');
const reloadButton = document.getElementById('participant-reload');
const exportButton = document.getElementById('participant-export');
const { readForm, fillForm, markFilledDimensions } = initForm(form);
// The fragment is the intended credential delivery and permits a page reload.
// It never goes in an HTTP URL, storage, an error message or a downloaded draft.
const credential = /^[a-f0-9]{64}$/.test(location.hash.slice(1)) ? location.hash.slice(1) : null;
let revision = null;
let dirty = false;
let busy = false;
let conflicted = false;
let denied = false;

function setStatus(message, state = '') {
  status.textContent = message;
  status.dataset.state = state;
}

function updateControls() {
  saveButton.disabled = busy || denied || conflicted || !dirty || revision === null;
  reloadButton.disabled = busy || denied || !credential;
  exportButton.disabled = busy || revision === null;
}

function denyAccess() {
  denied = true;
  form.hidden = true;
  unavailable.hidden = false;
  setStatus(`Link unavailable.${dirty ? ' Your unsaved draft can still be downloaded.' : ''}`, 'error');
  updateControls();
}

async function request(method = 'GET', body) {
  const response = await fetch('/api/participant', {
    method,
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${credential}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    // Use fixed messages: no server details or credential can enter the UI/logs.
    const error = new Error(response.status === 409 ? 'Newer answers are stored. Download your draft, then reload saved answers and merge your changes.' : 'Could not save or load answers. Your draft is kept; choose Save answers to try again.');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function reportError(error) {
  if ([401, 403, 404].includes(error.status)) return denyAccess();
  if (error.status === 409) conflicted = true;
  setStatus(error.status === 409 ? error.message : 'Could not save or load answers. Your answers are still in the form; choose Save answers or Reload saved to try again.', 'error');
}

async function loadAnswers() {
  form.inert = true;
  try {
    const saved = await request();
    revision = saved.revision;
    fillForm(saved.fields);
    dirty = false;
    conflicted = false;
    form.hidden = false;
    unavailable.hidden = true;
    setStatus('Edit your answers, then choose Save answers.');
  } finally {
    form.inert = false;
  }
}

async function run(action) {
  if (busy || denied) return;
  busy = true;
  updateControls();
  try {
    await action();
  } catch (error) {
    reportError(error);
  } finally {
    busy = false;
    updateControls();
  }
}

saveButton.addEventListener('click', () => run(async () => {
  if (!dirty || conflicted) return;
  const fields = readForm();
  setStatus('Saving…');
  const saved = await request('PUT', { fields, revision });
  revision = saved.revision;
  // Typing while saving stays editable and requires a second explicit save.
  dirty = JSON.stringify(fields) !== JSON.stringify(readForm());
  setStatus(dirty ? 'Unsaved changes. Choose Save answers again.' : 'Saved to server');
}));

reloadButton.addEventListener('click', () => run(async () => {
  if (dirty && !confirm('Discard your unsaved draft and reload saved answers? Download your draft first to keep it.')) return;
  await loadAnswers();
}));

exportButton.addEventListener('click', () => {
  downloadJson({ fields: readForm(), revision });
});

form.addEventListener('input', () => {
  dirty = true;
  markFilledDimensions();
  setStatus(conflicted ? 'Newer answers are stored. Download your draft, then reload and merge your answers.' : 'Unsaved changes. Choose Save answers.', conflicted ? 'error' : '');
  updateControls();
});
form.addEventListener('submit', (event) => event.preventDefault());
addEventListener('beforeunload', (event) => {
  if (!dirty && !busy) return;
  event.preventDefault();
  event.returnValue = '';
});
addEventListener('hashchange', () => location.reload());

if (!credential) {
  denyAccess();
} else {
  run(loadAnswers);
}
