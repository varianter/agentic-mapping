import { initForm } from './form.js';

// Logged-out preview: never imports interviewer storage and never calls the server.
for (const element of document.querySelectorAll('[data-interviewer]')) element.remove();
document.title = 'Preview · Agentic mapping';
document.getElementById('app').dataset.sidebar = 'closed';
document.querySelector('.pill').textContent = 'Preview';

const KEY = 'agentic-mapping-preview';
const form = document.getElementById('sheet');
const status = document.getElementById('save-status');
const { readForm, fillForm, markFilledDimensions } = initForm(form);

function setStatus(message, state = '') {
  status.textContent = message;
  status.dataset.state = state;
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    setStatus('Browser storage is unavailable. Your answers will not be kept after reload.', 'error');
    return {};
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(readForm()));
    setStatus('Saved in this browser');
  } catch {
    setStatus('Could not save in this browser. Your answers will be lost on reload.', 'error');
  }
}

fillForm(load());
form.hidden = false;
form.addEventListener('input', () => {
  markFilledDimensions();
  save();
});
form.addEventListener('submit', (event) => event.preventDefault());
document.getElementById('preview-clear').addEventListener('click', () => {
  if (!confirm('Clear all preview answers from this browser?')) return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    setStatus('Could not clear browser storage.', 'error');
    return;
  }
  fillForm({});
  setStatus('Preview cleared');
});
