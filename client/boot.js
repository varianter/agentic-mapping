const participant = location.pathname === '/participant';
if (participant) {
  document.body.dataset.participant = '';
  await import('./participant.js');
} else {
  const localMode = document.body.dataset.storageMode === 'local';
  if (!localMode && document.body.dataset.storageMode !== 'server') throw new Error('Storage mode unavailable. Reload this page from the app server.');
  const storage = await import(localMode ? './local-db.js' : './db.js');
  const { initEditor } = await import('./app.js');
  initEditor(storage, { localMode });
}
