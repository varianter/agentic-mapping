// Anonymous models live in this origin/profile, separate from legacy originals.
const DB_NAME = 'agentic-mapping-local';
const STORE = 'sheets';
let dbPromise;

const failure = (message, status) => Object.assign(new Error(message), { status });
const validId = (id) => typeof id === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id);
const validRevision = (revision) => Number.isSafeInteger(revision) && revision > 0;
function validate(sheet, revision = false) {
  if (!sheet || !validId(sheet.id) || !sheet.fields || typeof sheet.fields !== 'object' || Array.isArray(sheet.fields)
    || !Object.entries(sheet.fields).every(([key, value]) => key.length <= 100 && (typeof value === 'string' || (Array.isArray(value) && value.every((item) => typeof item === 'string'))))
    || !Number.isSafeInteger(sheet.createdAt) || sheet.createdAt < 0 || !Number.isSafeInteger(sheet.updatedAt) || sheet.updatedAt < 0
    || (revision && !validRevision(sheet.revision))) throw failure('Invalid model or revision.', 400);
}

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      let failed = false;
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onerror = () => {
        failed = true;
        reject(request.error);
      };
      request.onblocked = () => {
        failed = true;
        reject(new Error('Browser storage is blocked. Close other app tabs and retry.'));
      };
      request.onsuccess = () => {
        const db = request.result;
        if (failed) { db.close(); return; }
        db.onversionchange = () => { db.close(); dbPromise = undefined; };
        resolve(db);
      };
    }).catch((error) => { dbPromise = undefined; throw error; });
  }
  return dbPromise;
}

async function run(mode, operation) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result;
    let error;
    const abort = (reason) => { error = reason; tx.abort(); };
    // Request success is provisional; acknowledge only transaction completion.
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(error ?? tx.error ?? new Error('Browser storage failed. Retry to save your draft.'));
    try { operation(tx.objectStore(STORE), (value) => { result = value; }, abort); }
    catch (reason) { abort(reason); }
  });
}

export const allSheets = () => run('readonly', (store, done) => {
  store.getAll().onsuccess = (event) => done(event.target.result);
});
export const getSheet = (id) => run('readonly', (store, done, abort) => {
  if (!validId(id)) return abort(failure('Model unavailable.', 404));
  store.get(id).onsuccess = (event) => {
    const sheet = event.target.result;
    if (!sheet) return abort(failure('Model unavailable.', 404));
    done(sheet);
  };
});
export async function createSheet(sheet) {
  validate(sheet);
  const saved = structuredClone({ id: sheet.id, fields: sheet.fields, createdAt: sheet.createdAt, updatedAt: sheet.updatedAt, revision: 1 });
  return run('readwrite', (store, done, abort) => {
    store.get(saved.id).onsuccess = (event) => {
      try {
        if (event.target.result) return abort(failure('Model ID already exists; nothing was overwritten.', 409));
        store.add(saved);
        done(saved);
      } catch (error) { abort(error); }
    };
  });
}

function change(sheet, remove) {
  return run('readwrite', (store, done, abort) => {
    // Read and compare inside the write transaction so competing tabs serialize.
    store.get(sheet.id).onsuccess = (event) => {
      try {
        const stored = event.target.result;
        if (!stored) return abort(failure('Model unavailable. It may have been deleted in another tab.', 404));
        if (stored.revision !== sheet.revision) return abort(failure('Another tab changed this model. Download your draft, then reload before saving or deleting.', 409));
        if (remove) store.delete(sheet.id);
        else {
          const saved = { ...stored, fields: sheet.fields, updatedAt: Date.now(), revision: stored.revision + 1 };
          store.put(saved);
          done(saved);
        }
      } catch (error) { abort(error); }
    };
  });
}
export async function putSheet(sheet) {
  validate(sheet, true);
  return change(structuredClone(sheet), false);
}
export async function deleteSheet(sheet) {
  validate(sheet, true);
  return change(structuredClone(sheet), true);
}
