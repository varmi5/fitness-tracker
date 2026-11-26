// Health data stays on this browser, scoped to the authenticated account. Never cache credentials.
const DB = "fitnesstrackr-private-v1";
const STORE = "records";
const METADATA = "metadata";
export const CACHE_MAX_DAYS = 180;
export const CACHE_MAX_BYTES = 12 * 1024 * 1024;
export const CACHE_IDLE_TTL = 30 * 86400000;

interface CacheMetadata {
  id: string;
  owner: string;
  key: string;
  savedAt: number;
  accessedAt: number;
  bytes: number;
}

export interface CacheRecord extends CacheMetadata { value: unknown }

export function cacheEvictions(rows: CacheMetadata[], now: number): string[] {
  const sorted = [...rows].sort((a, b) => b.accessedAt - a.accessedAt);
  let bytes = 0, days = 0;
  return sorted.filter(row => {
    const expired = now - row.accessedAt > CACHE_IDLE_TTL;
    if (expired) return true;
    const isDay = row.key !== "bootstrap";
    if (bytes + row.bytes > CACHE_MAX_BYTES || (isDay && days >= CACHE_MAX_DAYS)) return true;
    bytes += row.bytes;
    if (isDay) days++;
    return false;
  }).map(row => row.id);
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 2);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      const records = db.objectStoreNames.contains(STORE)
        ? request.transaction!.objectStore(STORE)
        : db.createObjectStore(STORE, { keyPath: "id" });
      const metadata = db.createObjectStore(METADATA, { keyPath: "id" });
      const cursor = records.openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (!row) return;
        const { id, owner, key, bytes, savedAt, accessedAt } = row.value as CacheRecord;
        metadata.put({ id, owner, key, bytes, savedAt, accessedAt } satisfies CacheMetadata);
        row.continue();
      };
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      if (blocked) db.close();
      else resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("The diary cache is open in another tab."));
    };
  });
}

function removeEntry(tx: IDBTransaction, id: string) {
  tx.objectStore(STORE).delete(id);
  tx.objectStore(METADATA).delete(id);
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
}

export async function clearBrowserCache() {
  try {
    const db = await database();
    const tx = db.transaction([STORE, METADATA], "readwrite");
    tx.objectStore(STORE).clear();
    tx.objectStore(METADATA).clear();
    try { await transactionDone(tx); } finally { db.close(); }
  } catch { /* Storage may be disabled or evicted. */ }
}

export async function activateBrowserCache(owner: string) {
  try {
    const db = await database();
    const tx = db.transaction([STORE, METADATA], "readwrite");
    const request = tx.objectStore(METADATA).getAll();
    request.onsuccess = () => {
      for (const row of request.result as CacheMetadata[]) if (row.owner !== owner) removeEntry(tx, row.id);
    };
    try { await transactionDone(tx); } finally { db.close(); }
  } catch { /* Use memory caching instead. */ }
}

export async function readBrowserCache<T>(owner: string, key: string): Promise<{ value: T; savedAt: number } | null> {
  try {
    const db = await database();
    const tx = db.transaction([STORE, METADATA], "readwrite");
    const meta = tx.objectStore(METADATA);
    const request = meta.get(`${owner}:${key}`);
    let entry: { value: T; savedAt: number } | null = null;
    request.onsuccess = () => {
      const row = request.result as CacheMetadata | undefined;
      if (row?.owner !== owner || row.key !== key || Date.now() - row.accessedAt > CACHE_IDLE_TTL) return;
      const record = tx.objectStore(STORE).get(row.id);
      record.onsuccess = () => {
        if (!record.result) return;
        entry = { value: (record.result as CacheRecord).value as T, savedAt: row.savedAt };
        meta.put({ ...row, accessedAt: Date.now() });
      };
    };
    try { await transactionDone(tx); return entry; } finally { db.close(); }
  } catch { return null; }
}

export async function writeBrowserCache(owner: string, key: string, value: unknown, savedAt = Date.now()) {
  try {
    const bytes = JSON.stringify(value).length * 2;
    if (bytes > CACHE_MAX_BYTES / 2) return;
    const db = await database(), now = Date.now();
    const tx = db.transaction([STORE, METADATA], "readwrite");
    const meta = tx.objectStore(METADATA);
    const row = { id: `${owner}:${key}`, owner, key, savedAt, accessedAt: now, bytes };
    tx.objectStore(STORE).put({ ...row, value } satisfies CacheRecord);
    meta.put(row);
    // Enforce the cache limits without pulling every saved diary into JavaScript.
    const request = meta.getAll();
    request.onsuccess = () => {
      const rows = request.result as CacheMetadata[];
      for (const row of rows) if (row.owner !== owner) removeEntry(tx, row.id);
      for (const id of cacheEvictions(rows.filter(row => row.owner === owner), now)) removeEntry(tx, id);
    };
    try { await transactionDone(tx); } finally { db.close(); }
  } catch { /* Quota errors must never break the diary. */ }
}
