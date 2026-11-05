const participant = location.pathname === '/participant';
const preview = location.pathname === '/preview';
if (preview) {
  document.body.dataset.preview = '';
  await import('./preview.js');
} else if (participant) {
  document.body.dataset.participant = '';
  await import('./participant.js');
} else {
  const localMode = document.body.dataset.storageMode === 'local';
  if (!localMode && document.body.dataset.storageMode !== 'server') throw new Error('Storage mode unavailable. Reload this page from the app server.');
  const storage = await import(localMode ? './local-db.js' : './db.js');
  const { initEditor } = await import('./app.js');
  // Server mode also loads the browser store so anonymous models can be offered to the account.
  const localStore = localMode ? undefined : await import('./local-db.js').catch(() => undefined);
  initEditor(storage, { localMode, localStore });
}
