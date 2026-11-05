// The server marks the page with the verified mode: interviewer or participant. My map is server-rendered.
const mode = document.body.dataset.mode;
if (mode === 'participant') {
  document.body.dataset.participant = '';
  await import('./participant.js');
} else if (mode === 'interviewer') {
  const storage = await import('./db.js');
  const { initEditor } = await import('./app.js');
  initEditor(storage);
} else {
  throw new Error('Mode unavailable. Reload this page from the app server.');
}
