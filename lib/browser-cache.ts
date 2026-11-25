// Health data stays on this browser, scoped to the authenticated account. Never cache credentials.
const DB = "fitnesstrackr-private-v1";
const STORE = "records";
export const CACHE_MAX_DAYS = 180;
export const CACHE_MAX_BYTES = 12 * 1024 * 1024;
export const CACHE_IDLE_TTL = 30 * 86400000;
export interface CacheRecord { id: string; owner: string; key: string; value: unknown; savedAt: number; accessedAt: number; bytes: number }
export function cacheEvictions(rows: CacheRecord[], now: number): string[] {
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
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function clearBrowserCache() {
  try {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite"); tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* Storage may be disabled or evicted. */ }
}
export async function activateBrowserCache(owner: string) {
  try {
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE);
      const request = store.getAll();
      request.onsuccess = () => { for (const row of request.result as CacheRecord[]) if (row.owner !== owner) store.delete(row.id); };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* Use memory caching instead. */ }
}
export async function readBrowserCache<T>(owner: string, key: string): Promise<{ value: T; savedAt: number } | null> {
  try {
    const db = await database();
    const row = await new Promise<CacheRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE), request = store.get(`${owner}:${key}`);
      request.onsuccess = () => {
        const row = request.result as CacheRecord | undefined;
        if (row?.owner === owner && row.key === key && Date.now() - row.accessedAt <= CACHE_IDLE_TTL) {
          store.put({ ...row, accessedAt: Date.now() }); resolve(row);
        } else resolve(undefined);
      };
      request.onerror = () => reject(request.error);
    });
    db.close();
    return row ? { value: row.value as T, savedAt: row.savedAt } : null;
  } catch { return null; }
}
export async function writeBrowserCache(owner: string, key: string, value: unknown) {
  try {
    const bytes = JSON.stringify(value).length * 2;
    if (bytes > CACHE_MAX_BYTES / 2) return;
    const db = await database(), now = Date.now();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite"), store = tx.objectStore(STORE);
      store.put({ id: `${owner}:${key}`, owner, key, value, savedAt: now, accessedAt: now, bytes } satisfies CacheRecord);
      const request = store.getAll();
      request.onsuccess = () => {
        const rows = request.result as CacheRecord[];
        for (const row of rows) if (row.owner !== owner) store.delete(row.id);
        for (const id of cacheEvictions(rows.filter(row => row.owner === owner), now)) store.delete(id);
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* Quota errors must never break the diary. */ }
}
