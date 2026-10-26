// Small promise wrapper around IndexedDB. Everything lives on the device.
const DB_NAME = 'inkwell';
const DB_VERSION = 1;
const STORES = {
  dividers: [],
  subjects: [],
  notes: ['subjectId'],
  pages: ['noteId'],
  blobs: [],
  recordings: ['noteId'],
};

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const [name, indexes] of Object.entries(STORES)) {
        if (d.objectStoreNames.contains(name)) continue;
        const s = d.createObjectStore(name, { keyPath: 'id' });
        for (const ix of indexes) s.createIndex(ix, ix, { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const d = await open();
  const t = d.transaction(store, mode);
  const result = fn(t.objectStore(store));
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  return result instanceof IDBRequest ? result.result : result;
}

export const db = {
  get: (store, id) => tx(store, 'readonly', s => s.get(id)),
  put: (store, obj) => tx(store, 'readwrite', s => { s.put(obj); return obj; }),
  putMany: (store, objs) => tx(store, 'readwrite', s => { for (const o of objs) s.put(o); }),
  del: (store, id) => tx(store, 'readwrite', s => { s.delete(id); }),
  delMany: (store, ids) => tx(store, 'readwrite', s => { for (const id of ids) s.delete(id); }),
  all: async store => { const d = await open(); return wrap(d.transaction(store).objectStore(store).getAll()); },
  byIndex: async (store, index, value) => {
    const d = await open();
    return wrap(d.transaction(store).objectStore(store).index(index).getAll(value));
  },
  clearAll: async () => {
    const d = await open();
    const t = d.transaction(Object.keys(STORES), 'readwrite');
    for (const n of Object.keys(STORES)) t.objectStore(n).clear();
    return new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); });
  },
  stores: Object.keys(STORES),
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 9);

export async function putBlob(blob) {
  const id = uid();
  await db.put('blobs', { id, blob, type: blob.type });
  return id;
}

export async function getBlob(id) {
  const r = await db.get('blobs', id);
  return r ? r.blob : null;
}
