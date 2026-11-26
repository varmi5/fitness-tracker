import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheEvictions, CACHE_MAX_BYTES, CACHE_IDLE_TTL, type CacheRecord } from "../lib/browser-cache";
const now = Date.now();
const row = (i: number, extra: Partial<CacheRecord> = {}): CacheRecord => ({ id: `u:${i}`, key: `day:1900-01-${i}`, owner: "u", value: {}, bytes: 100, savedAt: now - 1000, accessedAt: now - i, ...extra });
test("cache retains any historical date and evicts least recently accessed days beyond 180", () => {
  const records = Array.from({ length: 182 }, (_, i) => row(i));
  assert.deepEqual(cacheEvictions(records, now), ["u:180", "u:181"]);
  assert.equal(cacheEvictions([row(1, { key: "day:1995-01-01" })], now).length, 0);
});
test("cache enforces byte and inactivity budgets without charging expired records against live data", () => {
  const records = [row(0, { accessedAt: now - CACHE_IDLE_TTL - 1, bytes: CACHE_MAX_BYTES }), row(1), row(2, { bytes: CACHE_MAX_BYTES })];
  assert.deepEqual(new Set(cacheEvictions(records, now)), new Set(["u:0", "u:2"]));
});
test("bootstrap snapshot does not consume a visited-day slot", () => {
  const records = [row(0, { key: "bootstrap" }), ...Array.from({ length: 180 }, (_, i) => row(i + 1))];
  assert.equal(cacheEvictions(records, now).length, 0);
});

test("persistent cache survives reopening, isolates accounts, and clears device records", async () => {
  await import("fake-indexeddb/auto");
  const { activateBrowserCache, clearBrowserCache, readBrowserCache, writeBrowserCache } = await import("../lib/browser-cache");
  await clearBrowserCache();
  await activateBrowserCache("a");
  await writeBrowserCache("a", "day:2020-01-01", { meals: [{ name: "Synthetic food" }] });
  assert.deepEqual((await readBrowserCache<{ meals: { name: string }[] }>("a", "day:2020-01-01"))?.value.meals, [{ name: "Synthetic food" }]);
  assert.equal(await readBrowserCache("b", "day:2020-01-01"), null);
  await activateBrowserCache("b");
  assert.equal(await readBrowserCache("a", "day:2020-01-01"), null);
  const fullSnapshotTime = Date.now() - 5000;
  await writeBrowserCache("b", "bootstrap", { userId: "b" }, fullSnapshotTime);
  assert.equal((await readBrowserCache("b", "bootstrap"))?.savedAt, fullSnapshotTime);
  await clearBrowserCache();
  assert.equal(await readBrowserCache("b", "bootstrap"), null);
});

test("the previous browser cache schema retains saved diary data on upgrade", async () => {
  const { IDBFactory } = await import("fake-indexeddb");
  const original = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  try {
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("fitnesstrackr-private-v1", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("records", { keyPath: "id" });
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = legacy.transaction("records", "readwrite");
      tx.objectStore("records").put({
        ...row(1), id: "u:day:2020-01-01", key: "day:2020-01-01", value: { day: "2020-01-01" },
      });
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    legacy.close();
    const { readBrowserCache } = await import("../lib/browser-cache");
    assert.deepEqual((await readBrowserCache("u", "day:2020-01-01"))?.value, { day: "2020-01-01" });
  } finally {
    globalThis.indexedDB = original;
  }
});

test("a late startup response keeps confirmed changes without carrying metrics across dates or accounts", async () => {
  const { createStartupCache } = await import("../lib/startup-cache");
  const create = (userId: string, day: string, weight: number) => ({
    userId, activeDay: day, daily: { day, target: 1900 },
    tracker: { readings: [{ value: weight }] }, google: { lastSync: null },
  }) as import("../app/types").InitialAppData;
  const date = "2026-11-25", nextDate = "2026-11-26";
  const cache = createStartupCache();
  const old = create("a", date, 73);
  const synced = create("a", date, 72.4);
  cache.seed(old);
  const requestStarted = cache.revision;
  cache.update(() => ({ tracker: synced.tracker, daily: { ...synced.daily, target: 2000 } }));
  const current = cache.refresh(old, requestStarted);
  assert.equal(current.tracker.readings[0].value, 72.4);
  assert.equal(current.daily.target, 2000);

  const tomorrow = cache.refresh(create("a", nextDate, 73), requestStarted);
  assert.equal(tomorrow.tracker.readings[0].value, 72.4);
  assert.equal(tomorrow.daily.day, nextDate);
  assert.equal(tomorrow.daily.target, 1900);

  const otherAccount = cache.refresh(create("b", date, 80), requestStarted);
  assert.equal(otherAccount.tracker.readings[0].value, 80);
});
