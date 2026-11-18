import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import { buildGoogleNutritionLogDataPoint, googleStatus, parseSavedHealthImport, pushPendingToGoogle, seal } from "../lib/google-health";
import { processGoogleMeals, verifyGoogleNutritionRecord } from "../lib/google-meal-worker";
import { processBackgroundGoogleMeals } from "../lib/background-work";
import { googleMealTarget, queueGoogleMeal, type GoogleMealSnapshot } from "../lib/google-sync-queue";
import { nutritionData } from "../lib/nutrition-data";
import * as schema from "../lib/schema";

const pg = new PGlite();
const db = drizzle(pg, { schema });
const scope = "https://www.googleapis.com/auth/googlehealth.nutrition.writeonly";
before(async () => {
  process.env.FITNESS_INTEGRATION_KEY = randomBytes(32).toString("hex");
  for (const file of (await readdir("migrations")).filter((name) => name.endsWith(".sql")).sort()) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
});
after(async () => { delete process.env.FITNESS_INTEGRATION_KEY; await pg.close(); });
async function account(id: string, scopes = [scope]) {
  await db.insert(schema.user).values({ id, name: id, email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() });
  await db.insert(schema.healthIntegration).values({ userId: id, provider: "google", credential: seal({ accessToken: "synthetic", refreshToken: "synthetic", expiresAt: Date.now() + 3600000, scopes }, id) });
  const data = nutritionData(db, id);
  await data.setPreferences({ timezone: "Europe/London", trackingMode: "fitbit", preferredEnergySource: "google", googleTwoWaySync: true });
  return data;
}
const input = (name = "Synthetic lunch", day = "2026-11-17") => ({ day, time: "12:00", name, category: "lunch" as const,
  items: [{ name: "Synthetic food", calories: 410.5, proteinG: 35, carbsG: 41, fatG: 12, fibreG: 5.5 }] });
function provider() {
  const records = new Map<string, any>();
  let posts = 0;
  const mock = (async (url: string | URL | Request, init?: RequestInit) => {
    const name = String(url).replace("https://health.googleapis.com/v4/", "");
    if (init?.method === "POST" && name.endsWith(":batchDelete")) {
      for (const key of JSON.parse(String(init.body)).names) records.delete(key);
      return Response.json({ done: true });
    }
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      assert.equal(body.nutritionLog.serving, undefined, "Anonymous logs must omit the invalid serving-without-unit object");
      posts++;
      if (records.has(body.name)) return Response.json({}, { status: 409 });
      records.set(body.name, body);
      return Response.json({ done: true, response: { name: body.name } });
    }
    return records.has(name) ? Response.json(records.get(name)) : Response.json({}, { status: 404 });
  }) as typeof fetch;
  return { records, mock, posts: () => posts };
}
test("nutrition payload preserves all five values and rejects mismatched read-back; unknown fibre remains absent", () => {
  const snapshot = { id: "synthetic", name: "Bowl", category: "lunch", consumedAt: "2026-03-29T00:30:00Z", totals: { calories: 410.5, proteinG: 35, carbsG: 41, fatG: 12, fibreG: null } } as GoogleMealSnapshot;
  const name = googleMealTarget(snapshot).name;
  const body = buildGoogleNutritionLogDataPoint(snapshot);
  assert.equal(body.nutritionLog.energy?.kcal, 410.5);
  assert.equal(body.nutritionLog.totalCarbohydrate?.grams, 41);
  assert.equal(body.nutritionLog.totalFat?.grams, 12);
  assert.deepEqual(body.nutritionLog.nutrients, [{ nutrient: "PROTEIN", quantity: { grams: 35 } }]);
  assert.equal(verifyGoogleNutritionRecord({ name, ...body }, snapshot, name), name);
  assert.throws(() => verifyGoogleNutritionRecord({ name, nutritionLog: { ...body.nutritionLog, energy: { kcal: 1 } } }, snapshot, name), /different nutrition/);
});
test("HTTP 400 exposes safe field diagnostics and failed jobs retry in the background", async () => {
  const data = await account("RETRY");
  const logged = await data.log(input());
  const original = globalThis.fetch, remote = provider();
  globalThis.fetch = (async () => Response.json({ error: { message: "private food text not for logs", details: [{ fieldViolations: [{ field: "serving.food_measurement_unit" }] }] } }, { status: 400 })) as typeof fetch;
  try {
    await processGoogleMeals(db, "RETRY", 1);
    const failed = (await googleStatus(db, "RETRY")).mealSync;
    assert.equal(failed.failed, 1);
    assert.match(failed.lastError!, /HTTP 400; check serving.food_measurement_unit/);
    assert.equal(failed.lastError!.includes("private food"), false);
    await db.update(schema.googleMealSync).set({ nextAttemptAt: new Date(0) }).where(eq(schema.googleMealSync.userId, "RETRY"));
    globalThis.fetch = remote.mock;
    assert.equal((await processBackgroundGoogleMeals(db, 1)).synced, 1);
    assert.equal((await googleStatus(db, "RETRY")).mealSync.verified, 1);
    assert.equal(remote.records.size, 1);
    const stored = [...remote.records.values()][0].nutritionLog;
    assert.equal(stored.nutrients.find((n: any) => n.nutrient === "DIETARY_FIBER").quantity.grams, 5.5);
    await queueGoogleMeal(db, "RETRY", logged.meal.id, "upsert", true);
    await processGoogleMeals(db, "RETRY", 1);
    assert.equal(remote.posts(), 1, "Repeat sync must reuse the record ID");
  } finally { globalThis.fetch = original; }
});
test("manual all-history backfill isolates users, skips imports and works outside Google tracking mode", async () => {
  const data = await account("BACKFILL");
  await account("OTHER");
  const one = await data.log(input("Historic breakfast", "2024-06-01"));
  await data.log(input("Recent dinner"));
  const source = "users/123/dataTypes/nutrition-log/dataPoints/external-food-123";
  const parsed = parseSavedHealthImport(JSON.stringify({ name: source, ...buildGoogleNutritionLogDataPoint({ name: "Imported bowl", category: "lunch", consumedAt: "2026-11-16T12:00:00Z", totals: { calories: 400, proteinG: 20, carbsG: 40, fatG: 15, fibreG: null } }) }));
  assert.equal((await data.importHealthRecords(parsed)).mealsImported, 1);
  assert.equal((await data.importHealthRecords(parsed)).mealsImported, 0);
  const echo = parseSavedHealthImport(JSON.stringify({ name: `users/123/dataTypes/nutrition-log/dataPoints/ft-${one.meal.id}-123456abcdef`, ...buildGoogleNutritionLogDataPoint({ ...one.meal }) }));
  assert.equal((await data.importHealthRecords(echo)).mealsImported, 0);
  assert.equal((await db.select().from(schema.googleMealSync).where(eq(schema.googleMealSync.userId, "BACKFILL"))).length, 2);
  const imported = (await db.select().from(schema.meal).where(and(eq(schema.meal.userId, "BACKFILL"), eq(schema.meal.origin, "health_import"))))[0];
  assert.equal(await queueGoogleMeal(db, "BACKFILL", imported.id, "upsert", true), false);
  await data.setPreferences({ timezone: "Europe/London", trackingMode: "manual", preferredEnergySource: "manual", googleTwoWaySync: false });
  const original = globalThis.fetch, remote = provider(); globalThis.fetch = remote.mock;
  try {
    assert.equal((await pushPendingToGoogle(db, "BACKFILL", undefined, "2026-11-18")).mealsQueued, 2);
    await processBackgroundGoogleMeals(db, 10);
    assert.equal(remote.records.size, 2);
    assert.equal((await googleStatus(db, "OTHER")).mealSync.verified, 0);
    assert.equal((await googleStatus(db, "BACKFILL")).mealSync.verified, 2);
    await pushPendingToGoogle(db, "BACKFILL", undefined, "2026-11-18");
    await processBackgroundGoogleMeals(db, 10);
    assert.equal(remote.posts(), 2);
  } finally { globalThis.fetch = original; }
});
test("edits verify the new record before cleanup; failed read-back retains the old record, deletes verify removal", async () => {
  const data = await account("EDIT");
  const logged = await data.log(input());
  const original = globalThis.fetch, remote = provider(); globalThis.fetch = remote.mock;
  try {
    await processGoogleMeals(db, "EDIT", 1);
    const oldName = [...remote.records.keys()][0];
    await data.update({ id: logged.meal.id, appendItems: [{ name: "Extra egg", calories: 80, proteinG: 7, carbsG: 0, fatG: 5, fibreG: 0 }], idempotencyKey: "extra-egg" });
    globalThis.fetch = (async (url, init) => {
      const response = await remote.mock(url, init);
      if ((!init?.method || init.method === "GET") && response.ok && !String(url).endsWith(oldName)) {
        const body = await response.json(); body.nutritionLog.energy.kcal = 1; return Response.json(body);
      }
      return response;
    }) as typeof fetch;
    await processGoogleMeals(db, "EDIT", 1);
    assert.equal((await googleStatus(db, "EDIT")).mealSync.failed, 1);
    assert.ok(remote.records.has(oldName));
    globalThis.fetch = remote.mock;
    await db.update(schema.googleMealSync).set({ nextAttemptAt: new Date(0) }).where(eq(schema.googleMealSync.userId, "EDIT"));
    await processGoogleMeals(db, "EDIT", 1);
    assert.equal(remote.records.size, 1);
    assert.equal(remote.records.has(oldName), false);
    await data.setPreferences({ timezone: "Europe/London", googleTwoWaySync: false });
    await data.remove(logged.meal.id, true);
    await processGoogleMeals(db, "EDIT", 1);
    assert.equal(remote.records.size, 0);
    assert.equal((await db.select().from(schema.googleMealSync).where(eq(schema.googleMealSync.userId, "EDIT"))).length, 0);
  } finally { globalThis.fetch = original; }
});
test("a connection without nutrition write scope fails explicitly before any upload", async () => {
  const data = await account("NOSCOPE", []);
  await data.log(input());
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("Must not call Google without write consent"); }) as typeof fetch;
  try {
    await processGoogleMeals(db, "NOSCOPE", 1);
    assert.match((await googleStatus(db, "NOSCOPE")).mealSync.lastError!, /Reconnect Google Health/);
    await assert.rejects(() => pushPendingToGoogle(db, "NOSCOPE", undefined, "2026-11-18"), /grant meal write permission/);
  } finally { globalThis.fetch = original; }
});
