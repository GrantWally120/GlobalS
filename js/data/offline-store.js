// The last orbital data the single-file GlobalS loaded, kept in this browser (IndexedDB) so the
// file still starts without internet. The web version doesn't need it: its service worker keeps
// the data instead.

const DB_NAME = 'globals';
const STORE = 'offline';
const KEY = 'last-data';

function openDb() {
  return new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore(STORE);
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}

function run(mode, op) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const rq = op(tx.objectStore(STORE));
    tx.oncomplete = () => {
      db.close();
      resolve(rq.result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  }));
}

/** Keep one snapshot: { manifest, catalogText, groupsText }. */
export const saveSnapshot = (snapshot) => run('readwrite', (store) => store.put({ ...snapshot, savedAt: Date.now() }, KEY));

/** The kept snapshot, or null. */
export const loadSnapshot = () => run('readonly', (store) => store.get(KEY)).then((s) => s ?? null, () => null);

/** Forget it (the Data tab's reset button). */
export const clearSnapshot = () => new Promise((resolve) => {
  const rq = indexedDB.deleteDatabase(DB_NAME);
  rq.onsuccess = rq.onerror = rq.onblocked = () => resolve();
});
