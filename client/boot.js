// Legacy participant connect page until /connect replaces it. Everything else is server-rendered.
if (document.body.dataset.mode === 'participant') {
  document.body.dataset.participant = '';
  await import('./participant.js');
} else {
  throw new Error('Mode unavailable. Reload this page from the app server.');
}
