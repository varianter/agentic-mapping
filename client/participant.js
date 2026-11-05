// A private link connects this browser to its interview, then opens it as My map at /.
// This entrypoint never imports interviewer storage or loads a sheet list.
for (const element of document.querySelectorAll('[data-interviewer]')) element.remove();
document.title = 'Your interview · Agentic mapping';
document.getElementById('app').dataset.sidebar = 'closed';

const status = document.getElementById('save-status');
const unavailable = document.getElementById('participant-unavailable');
const choiceDialog = document.getElementById('connect-choice');
// The fragment is the intended credential delivery and permits a page reload.
// It never goes in an HTTP URL, storage, an error message or a download.
const credential = /^[a-f0-9]{64}$/.test(location.hash.slice(1)) ? location.hash.slice(1) : null;
let pending = false;

function setStatus(message, state = '') {
  status.textContent = message;
  status.dataset.state = state;
}

function denyAccess() {
  unavailable.hidden = false;
  setStatus('Link unavailable.', 'error');
}

async function connect(choice) {
  const response = await fetch('/api/participant/connect', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(choice ? { choice } : {}),
  });
  if (!response.ok) {
    // Fixed messages: no server details or credential can enter the UI/logs.
    const error = new Error('Could not open your interview.');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

const answered = (fields) => Object.values(fields).filter((value) => value.trim()).length;

async function start(choice) {
  if (pending) return;
  pending = true;
  setStatus('Opening your interview…');
  try {
    const result = await connect(choice);
    if (result.needsChoice) {
      document.getElementById('connect-choice-text').textContent =
        `This browser has your own map with ${answered(result.mine)} answers. The interview has ${answered(result.interview)}. Your own map is deleted once you choose.`;
      setStatus('Choose how to combine your answers.');
      choiceDialog.showModal();
      return;
    }
    location.replace('/');
  } catch (error) {
    if ([401, 403, 404].includes(error.status)) return denyAccess();
    setStatus('Could not open your interview. Check your connection and reload this page.', 'error');
  } finally {
    pending = false;
  }
}

choiceDialog.addEventListener('close', () => {
  const choice = choiceDialog.returnValue;
  choiceDialog.returnValue = '';
  // Escape is not a choice; ask again.
  if (!['merge', 'interview', 'mine'].includes(choice)) return choiceDialog.showModal();
  start(choice);
});
addEventListener('hashchange', () => location.reload());

if (!credential) denyAccess();
else start();
