// My map: one record in this browser's IndexedDB. Never sent to the server.
import { RESPONDENT_FIELDS } from './fields.js';

const DB_NAME = 'agentic-mapping-self';
const STORE = 'map';
const KEY = 'me';
let dbPromise;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      let failed = false;
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
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
    // Request success is provisional; acknowledge only transaction completion.
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('Browser storage failed. Retry to save your map.'));
    operation(tx.objectStore(STORE), (value) => { result = value; });
  });
}

// Keeps only the respondent's own answers, so interviewer fields never end up here.
const respondentFields = (fields = {}) => Object.fromEntries(RESPONDENT_FIELDS.filter((key) => typeof fields[key] === 'string').map((key) => [key, fields[key]]));

export const loadMap = () => run('readonly', (store, done) => {
  store.get(KEY).onsuccess = (event) => done(respondentFields(event.target.result?.fields));
});
export const saveMap = (fields) => run('readwrite', (store) => {
  store.put({ fields: respondentFields(fields), updatedAt: Date.now() }, KEY);
});
export const clearMap = () => run('readwrite', (store) => {
  store.delete(KEY);
});
