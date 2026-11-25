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
  await writeBrowserCache("b", "bootstrap", { userId: "b" });
  assert.ok(await readBrowserCache("b", "bootstrap"));
  await clearBrowserCache();
  assert.equal(await readBrowserCache("b", "bootstrap"), null);
});
