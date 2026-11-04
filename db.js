// Tiny promise wrapper around IndexedDB: one object store of capture sheets.

const DB_NAME = 'agentic-mapping';
const STORE = 'sheets';

const dbPromise = new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function run(mode, fn) {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export const allSheets = () => run('readonly', (s) => s.getAll());
export const getSheet = (id) => run('readonly', (s) => s.get(id));
export const putSheet = (sheet) => run('readwrite', (s) => s.put(sheet));
export const deleteSheet = (id) => run('readwrite', (s) => s.delete(id));
