// Tiny IndexedDB wrapper: one store for the workspace JSON, one for PDF bytes.
const DB_NAME = 'autofill-my-pdf';
const DB_VERSION = 1;

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    req.onsuccess = () => {
      const db = req.result;
      // another tab upgraded or the browser closed us: reopen lazily next time
      db.onversionchange = () => {
        db.close();
        dbp = null;
      };
      db.onclose = () => {
        dbp = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbp = null;
      reject(req.error);
    };
  });
  return dbp;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req ? req.result : (undefined as T));
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const kvGet = <T>(key: string) => tx<T | undefined>('kv', 'readonly', (s) => s.get(key));
export const kvSet = (key: string, value: unknown) => tx('kv', 'readwrite', (s) => void s.put(value, key));

const fileCache = new Map<string, Uint8Array>();

export async function putFile(id: string, bytes: Uint8Array): Promise<void> {
  fileCache.set(id, bytes);
  await tx('files', 'readwrite', (s) => void s.put(bytes, id));
}

export async function getFile(id: string): Promise<Uint8Array> {
  const hit = fileCache.get(id);
  if (hit) return hit;
  const v = await tx<ArrayBuffer | Uint8Array | undefined>('files', 'readonly', (s) => s.get(id));
  if (!v) throw new Error('PDF file is missing from storage.');
  const bytes = v instanceof Uint8Array ? v : new Uint8Array(v);
  fileCache.set(id, bytes);
  return bytes;
}

export async function deleteFile(id: string): Promise<void> {
  fileCache.delete(id);
  await tx('files', 'readwrite', (s) => void s.delete(id));
}

export async function allFileIds(): Promise<string[]> {
  const keys = await tx<IDBValidKey[]>('files', 'readonly', (s) => s.getAllKeys());
  return keys.map(String);
}
