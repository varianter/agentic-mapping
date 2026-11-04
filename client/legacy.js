// Read the old database only after an explicit export; never change its contents.
export async function exportLegacy() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('agentic-mapping', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sheets', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const sheets = await new Promise((resolve, reject) => {
      const transaction = db.transaction('sheets', 'readonly');
      const request = transaction.objectStore('sheets').getAll();
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
    downloadJson(sheets, 'agentic-mapping-legacy.json');
    return sheets.length;
  } finally {
    db.close();
  }
}

export function downloadJson(sheets, filename = 'agentic-mapping-draft.json') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(sheets, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const button = document.getElementById('export-legacy');
button?.addEventListener('click', async () => {
  const status = document.getElementById('export-status');
  try {
    status.textContent = `Exported ${await exportLegacy()} sheets. The originals remain in this browser.`;
  } catch (error) {
    status.textContent = `Couldn’t export: ${error.message}`;
  }
});
