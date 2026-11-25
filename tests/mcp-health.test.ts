import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { drizzle } from "drizzle-orm/pglite";
import {
  analyzeHeartRateCoverage,
  buildGoogleNutritionLogDataPoint,
  buildGoogleWeightDataPoint,
  disconnectGoogle,
  parseGoogleHeartRate,
  parseGoogleRecovery,
  parseGoogleRollup,
  parseGoogleSleep,
  parseGoogleStepIntervals,
  parseGoogleWorkouts,
  parseSavedHealthImport,
  pushMealToGoogle,
  pushWeightToGoogle,
  seal,
  syncGoogle,
  syncGoogleAllUsers,
  unseal,
} from "../lib/google-health";
import { allowedMcpCallback } from "../lib/mcp-config";
import { fitnessMcp } from "../lib/mcp-tools";
import { nutritionData } from "../lib/nutrition-data";
import { trackerData } from "../lib/tracker-data";
import * as schema from "../lib/schema";

const pg = new PGlite();
const db = drizzle(pg, { schema });

before(async () => {
  const migrations = (await readdir("migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const migration of migrations) {
    await pg.exec(await readFile(`migrations/${migration}`, "utf8"));
  }
  await db.insert(schema.user).values({
    id: "M1",
    name: "M1",
    email: "m1@example.test",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

after(async () => pg.close());

test("Google Health dailyRollUp parser handles total-calories, active-energy-burned, steps, weight, active-zone-minutes, distance, and floors", () => {
  const total = parseGoogleRollup("total-calories", {
    rollupDataPoints: [
      { civilStartTime: { date: { year: 2026, month: 11, day: 17 } }, totalCalories: { kcalSum: 2345.6 } },
    ],
  });
  assert.equal(total.rows.get("2026-11-17"), 2345.6);

  const active = parseGoogleRollup("active-energy-burned", {
    rollupDataPoints: [
      { civilStartTime: { date: { year: 2026, month: 11, day: 17 } }, activeEnergyBurned: { kcalSum: 512.3 } },
    ],
  });
  assert.equal(active.rows.get("2026-11-17"), 512.3);

  const steps = parseGoogleRollup("steps", {
    rollupDataPoints: [
      { civilStartTime: { date: { year: 2026, month: 11, day: 17 } }, steps: { countSum: "9842" } },
    ],
  });
  assert.equal(steps.rows.get("2026-11-17"), 9842);

  const weight = parseGoogleRollup("weight", {
    rollupDataPoints: [
      { civilStartTime: { date: { year: 2026, month: 11, day: 17 } }, weight: { weightGramsAvg: 74250 } },
    ],
  });
  assert.equal(weight.rows.get("2026-11-17"), 74.25);

  const azm = parseGoogleRollup("active-zone-minutes", {
    rollupDataPoints: [
      { civilStartTime: { date: { year: 2026, month: 11, day: 17 } }, activeZoneMinutes: { minutesSum: 41.6 } },
      { civilStartTime: { date: { year: 2026, month: 11, day: 18 } }, activeZoneMinutes: { activeZoneMinutesSum: 28 } },
    ],
  });
  assert.equal(azm.field, "activeZoneMinutes");
  assert.equal(azm.rows.get("2026-11-17"), 42);
  assert.equal(azm.rows.get("2026-11-18"), 28);

  const dist = parseGoogleRollup("distance", {
    rollupDataPoints: [
      { civilStartTime: { date: { year: 2026, month: 11, day: 17 } }, distance: { metersSum: 6432.84 } },
      { civilStartTime: { date: { year: 2026, month: 11, day: 18 } }, distance: { millimetersSum: 5120400 } },
    ],
  });
  assert.equal(dist.field, "distanceMeters");
  assert.equal(dist.rows.get("2026-11-17"), 6432.8);
  assert.equal(dist.rows.get("2026-11-18"), 5120.4);

  const floors = parseGoogleRollup("floors", {
    rollupDataPoints: [
      { civilStartTime: { date: { year: 2026, month: 11, day: 17 } }, floors: { countSum: 14.2 } },
      { civilStartTime: { date: { year: 2026, month: 11, day: 18 } }, floors: { floorsSum: 9 } },
    ],
  });
  assert.equal(floors.field, "floors");
  assert.equal(floors.rows.get("2026-11-17"), 14);
  assert.equal(floors.rows.get("2026-11-18"), 9);
});

test("AES-256-GCM seal/unseal enforces user AAD binding", () => {
  const keyHex = randomBytes(32).toString("hex");
  const cipher = seal({ accessToken: "secret-tok", refreshToken: "ref-tok" }, "user-A", keyHex);
  const plain = unseal(cipher, "user-A", keyHex) as { accessToken: string };
  assert.equal(plain.accessToken, "secret-tok");
  assert.throws(() => unseal(cipher, "user-B", keyHex));
});

test("MCP OAuth redirect URI validation accepts ChatGPT and loopback Codex callbacks only", () => {
  assert.equal(allowedMcpCallback("https://chatgpt.com/connector_platform_oauth_redirect"), true);
  assert.equal(allowedMcpCallback("https://chatgpt.com/connector/oauth/abc-123"), true);
  assert.equal(allowedMcpCallback("http://127.0.0.1:51234/callback"), true);
  assert.equal(allowedMcpCallback("https://evil.example.com/callback"), false);
  assert.equal(allowedMcpCallback("https://chatgpt.com/connector_platform_oauth_redirect#frag"), false);
});

test("MCP server enforces read vs write scopes and executes meal + energy tools against DB", async () => {
  // Read-only client must not see write tools
  const readServer = fitnessMcp("M1", ["fitness:read"], db);
  const [readClientT, readServerT] = InMemoryTransport.createLinkedPair();
  const readClient = new Client({ name: "test-read", version: "1.0.0" });
  await Promise.all([readServer.connect(readServerT), readClient.connect(readClientT)]);
  const readTools = (await readClient.listTools()).tools.map((t) => t.name);
  assert.ok(readTools.includes("get_daily_log"));
  assert.ok(readTools.includes("get_fitness_summary"));
  assert.equal(readTools.includes("log_meal"), false);
  assert.equal(readTools.includes("delete_meal"), false);
  await Promise.all([readClient.close(), readServer.close()]);

  // Read+write client can log, retrieve, append, and delete with confirmation
  const rwServer = fitnessMcp("M1", ["fitness:read", "fitness:write"], db);
  const [rwClientT, rwServerT] = InMemoryTransport.createLinkedPair();
  const rwClient = new Client({ name: "test-rw", version: "1.0.0" });
  await Promise.all([rwServer.connect(rwServerT), rwClient.connect(rwClientT)]);

  const rwTools = (await rwClient.listTools()).tools.map((t) => t.name);
  assert.equal(rwTools.length, 14);
  assert.equal(rwTools.includes("set_nutrition_targets"), false);
  assert.equal(rwTools.includes("set_logging_reminders"), false);

  const logged = await rwClient.callTool({
    name: "log_meal",
    arguments: {
      day: "2026-11-17",
      time: "08:45",
      name: "Breakfast eggs",
      category: "breakfast",
      idempotencyKey: "mcp-test-1",
      items: [
        { name: "Three large eggs", amount: 180, unit: "g", calories: 257, proteinG: 22.7, carbsG: 2, fatG: 17.5, estimationMethod: "weighed" },
      ],
    },
  });
  const loggedJson = JSON.parse((logged.content as { text: string }[])[0].text);
  assert.equal(loggedJson.dailyTotals.calories, 257);
  assert.equal(loggedJson.remainingCalorieAllowance, 1643);

  const appended = await rwClient.callTool({
    name: "update_meal",
    arguments: {
      id: loggedJson.meal.id,
      idempotencyKey: "mcp-append-1",
      appendItems: [
        { name: "Cholula hot sauce", amount: 15, unit: "ml", calories: 3, proteinG: 0.1, carbsG: 0.5, fatG: 0, estimationMethod: "measured" },
      ],
    },
  });
  const appendedJson = JSON.parse((appended.content as { text: string }[])[0].text);
  assert.equal(appendedJson.dailyTotals.calories, 260);

  const settings = await rwClient.callTool({ name: "get_nutrition_settings", arguments: {} });
  assert.equal(JSON.parse((settings.content as { text: string }[])[0].text).timezone, "Europe/London");

  const deleted = await rwClient.callTool({
    name: "delete_meal",
    arguments: { id: loggedJson.meal.id, confirmation: "DELETE" },
  });
  assert.equal(JSON.parse((deleted.content as { text: string }[])[0].text).day.meals.length, 0);

  const audit = await nutritionData(db, "M1").recentAudit(10);
  assert.equal(audit.length, 4);

  await Promise.all([rwClient.close(), rwServer.close()]);
});

test("MCP settings writes require both fitness:read and fitness:settings:write plus APPLY confirmation, and stay user-isolated", async () => {
  await db.insert(schema.user).values({
    id: "M2",
    name: "M2",
    email: "m2@example.test",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // fitness:settings:write alone (without fitness:read) must register zero tools
  const writeOnlyServer = fitnessMcp("M1", ["fitness:settings:write"], db);
  const [woClientT, woServerT] = InMemoryTransport.createLinkedPair();
  const woClient = new Client({ name: "test-wo", version: "1.0.0" });
  await Promise.all([writeOnlyServer.connect(woServerT), woClient.connect(woClientT)]);
  await assert.rejects(() => woClient.listTools(), /Method not found/);
  await Promise.all([woClient.close(), writeOnlyServer.close()]);

  // Authorized settings client can preview and apply targets + reminders for M1 only
  const swServer = fitnessMcp("M1", ["fitness:read", "fitness:write", "fitness:settings:write"], db);
  const [swClientT, swServerT] = InMemoryTransport.createLinkedPair();
  const swClient = new Client({ name: "test-sw", version: "1.0.0" });
  await Promise.all([swServer.connect(swServerT), swClient.connect(swClientT)]);
  const swTools = (await swClient.listTools()).tools.map((t) => t.name);
  assert.ok(swTools.includes("set_nutrition_targets"));
  assert.ok(swTools.includes("set_logging_reminders"));

  const m2Before = await nutritionData(db, "M2").daily("2026-11-18");

  // Missing confirmation='APPLY' must be rejected
  const preview = await swClient.callTool({
    name: "preview_nutrition_targets",
    arguments: { calories: 2050, proteinG: 165, carbsG: 190, fatG: 65, fibreG: 34 },
  });
  assert.equal(preview.isError, false);
  const rebalanced = JSON.parse((preview.content as { text: string }[])[0].text);
  assert.equal(rebalanced.saved, false);

  const unconfirmed = await swClient.callTool({
    name: "set_nutrition_targets",
    arguments: {
      targets: { ...rebalanced, effectiveFrom: "2026-11-18" },
      confirmation: "NO",
    },
  });
  assert.equal(unconfirmed.isError, true);

  // Explicit APPLY persists targets for M1 only
  const appliedTargets = await swClient.callTool({
    name: "set_nutrition_targets",
    arguments: {
      targets: { calories: 2050, proteinG: 165, carbsG: 199, fatG: 66, fibreG: 34, effectiveFrom: "2026-11-18" },
      confirmation: "APPLY",
    },
  });
  assert.equal(appliedTargets.isError, false);
  assert.equal((await nutritionData(db, "M1").daily("2026-11-18")).macroTargets.proteinG, 165);
  assert.equal((await nutritionData(db, "M2").daily("2026-11-18")).macroTargets.proteinG, m2Before.macroTargets.proteinG);

  // Logging a meal must never change nutrition targets
  await swClient.callTool({
    name: "log_meal",
    arguments: {
      day: "2026-11-18",
      time: "12:30",
      name: "Chicken salad",
      category: "lunch",
      idempotencyKey: "mcp-preserve-targets-1",
      items: [{ name: "Chicken", amount: 150, unit: "g", calories: 250, proteinG: 45, carbsG: 2, fatG: 6, estimationMethod: "weighed" }],
    },
  });
  const m1Day = await nutritionData(db, "M1").daily("2026-11-18");
  assert.equal(m1Day.target, 2050);
  assert.equal(m1Day.macroTargets.proteinG, 165);

  const appliedReminders = await swClient.callTool({
    name: "set_logging_reminders",
    arguments: { settings: { enabled: true, times: ["19:15"] }, confirmation: "APPLY" },
  });
  assert.equal(appliedReminders.isError, false);
  assert.deepEqual(JSON.parse((appliedReminders.content as { text: string }[])[0].text).times, ["19:15"]);

  await Promise.all([swClient.close(), swServer.close()]);
});

test("Google Health v4 outbound weight & nutrition payloads follow API schema", () => {
  const wt = buildGoogleWeightDataPoint({
    weightKg: 74.35,
    recordedAt: "2026-11-17T08:00:00.000Z",
    note: "Morning weigh-in",
  });
  assert.equal(wt.weight.weightGrams, 74350);
  assert.equal(wt.weight.sampleTime.physicalTime, "2026-11-17T08:00:00.000Z");

  const nut = buildGoogleNutritionLogDataPoint({
    name: "Skyr & berries",
    category: "breakfast",
    consumedAt: "2026-11-17T08:30:00.000Z",
    totals: { calories: 310, proteinG: 26.5, carbsG: 28, fatG: 3.2, fibreG: 5.4 },
  });
  assert.equal(nut.nutritionLog.mealType, "BREAKFAST");
  assert.equal(nut.nutritionLog.energy?.kcal, 310);
  assert.deepEqual(nut.nutritionLog.nutrients?.map((n) => n.nutrient), [
    "PROTEIN",
    "DIETARY_FIBER",
  ]);
});

test("Saved Google Health JSON & Fitbit CSV imports sync height/weights without overwriting manual scale entries", async () => {
  // User manually logs scale weight on 2026-11-15
  await trackerData(db, "M1").saveLog({
    date: "2026-11-15",
    values: [{ key: "weight", value: 75.0 }],
    note: "Home digital scale",
  });

  const csvPayload = [
    "Date,Calories Burned,Activity Calories,Steps,Weight (lbs)",
    "2026-11-15,2410,510,9400,166.0",
    "2026-11-16,2380,470,8800,164.0",
  ].join("\n");
  const parsedCsv = parseSavedHealthImport(csvPayload, "Europe/London");
  assert.equal(parsedCsv.energyEntries.length, 2);

  const googleRawJson = JSON.stringify({
    dataPoints: [
      { height: { heightMillimeters: 1785 } },
      {
        nutritionLog: {
          interval: { startTime: "2026-11-16T12:30:00Z" },
          foodDisplayName: "Imported Lentil Dhal",
          mealType: "LUNCH",
          energy: { kcal: 420 },
          nutrients: [
            { nutrient: "PROTEIN", quantity: { grams: 22 } },
            { nutrient: "DIETARY_FIBER", quantity: { grams: 11 } },
          ],
        },
      },
    ],
  });
  const parsedRaw = parseSavedHealthImport(googleRawJson, "Europe/London");
  assert.equal(parsedRaw.heightCm, 178.5);
  assert.equal(parsedRaw.meals.length, 1);

  const data = nutritionData(db, "M1");
  const res1 = await data.importHealthRecords(parsedCsv);
  assert.equal(res1.energyImported, 2);
  const res2 = await data.importHealthRecords(parsedRaw);
  assert.equal(res2.heightUpdated, true);
  assert.equal(res2.mealsImported, 1);

  const snap = await trackerData(db, "M1").snapshot();
  assert.equal(snap.settings.heightCm, 178.5);
  const nov15Weight = snap.readings.find((r) => r.metric === "weight" && r.date === "2026-11-15");
  const nov16Weight = snap.readings.find((r) => r.metric === "weight" && r.date === "2026-11-16");
  // Manual entry stays untouched (75.0 kg), imported entry populates empty day (164 lbs -> 74.39 kg)
  assert.equal(nov15Weight?.value, 75.0);
  assert.equal(nov16Weight?.value, 74.39);
});

test("User-scoped syncToken updates across MCP meal/target/reminder mutations without leaking across users", async () => {
  const m1Data = nutritionData(db, "M1");
  const m2Data = nutritionData(db, "M2");
  const swServer = fitnessMcp("M1", ["fitness:read", "fitness:write", "fitness:settings:write"], db);
  const [swClientT, swServerT] = InMemoryTransport.createLinkedPair();
  const swClient = new Client({ name: "test-sync", version: "1.0.0" });
  await Promise.all([swServer.connect(swServerT), swClient.connect(swClientT)]);

  const m2Start = await m2Data.syncToken();
  const tok0 = await m1Data.syncToken();

  const logged = await swClient.callTool({
    name: "log_meal",
    arguments: {
      day: "2026-11-19",
      time: "13:00",
      name: "Sync test salmon bowl",
      category: "lunch",
      idempotencyKey: "mcp-sync-1",
      items: [{ name: "Salmon", amount: 150, unit: "g", calories: 312, proteinG: 30, carbsG: 0, fatG: 20, estimationMethod: "weighed" }],
    },
  });
  assert.equal(logged.isError, false);
  const loggedId = JSON.parse((logged.content as { text: string }[])[0].text).meal.id;
  const tok1 = await m1Data.syncToken();
  assert.notEqual(tok1, tok0);
  assert.equal(await m2Data.syncToken(), m2Start);

  const upd = await swClient.callTool({
    name: "update_meal",
    arguments: {
      id: loggedId,
      idempotencyKey: "mcp-sync-2",
      appendItems: [{ name: "Rice", amount: 150, unit: "g", calories: 195, proteinG: 4, carbsG: 42, fatG: 0.5, estimationMethod: "weighed" }],
    },
  });
  assert.equal(upd.isError, false);
  const tok2 = await m1Data.syncToken();
  assert.notEqual(tok2, tok1);
  assert.equal(await m2Data.syncToken(), m2Start);

  const tgt = await swClient.callTool({
    name: "set_nutrition_targets",
    arguments: {
      targets: { calories: 2100, proteinG: 170, carbsG: 204.3, fatG: 67, fibreG: 35, effectiveFrom: "2026-11-19" },
      confirmation: "APPLY",
    },
  });
  assert.equal(tgt.isError, false);
  const tok3 = await m1Data.syncToken();
  assert.notEqual(tok3, tok2);
  assert.equal(await m2Data.syncToken(), m2Start);

  const rem = await swClient.callTool({
    name: "set_logging_reminders",
    arguments: { settings: { enabled: false, times: ["12:30", "19:30"] }, confirmation: "APPLY" },
  });
  assert.equal(rem.isError, false);
  const tok4 = await m1Data.syncToken();
  assert.notEqual(tok4, tok3);
  assert.equal(await m2Data.syncToken(), m2Start);

  const del = await swClient.callTool({
    name: "delete_meal",
    arguments: { id: loggedId, confirmation: "DELETE" },
  });
  assert.equal(del.isError, false);
  const tok5 = await m1Data.syncToken();
  assert.notEqual(tok5, tok4);
  assert.equal(await m2Data.syncToken(), m2Start);

  await Promise.all([swClient.close(), swServer.close()]);
});

test("parseGoogleSleep deduplicates stage enums, preserves short naps separately, and assigns overnight sleep to wake date", () => {
  const parsed = parseGoogleSleep({
    dataPoints: [
      {
        name: "users/me/dataTypes/sleep/dataPoints/short-nap",
        sleep: {
          interval: {
            startTime: "2026-11-21T14:00:00Z",
            endTime: "2026-11-21T14:45:00Z",
            civilEndTime: { date: { year: 2026, month: 11, day: 21 } },
          },
          summary: { minutesAsleep: 45, minutesAwake: 0 },
        },
      },
      {
        name: "users/me/dataTypes/sleep/dataPoints/overnight-1",
        sleep: {
          interval: {
            startTime: "2026-11-21T23:30:00Z",
            endTime: "2026-11-22T07:10:00Z",
            civilEndTime: { date: { year: 2026, month: 11, day: 22 } },
          },
          summary: {
            minutesAsleep: 425,
            minutesAwake: 35,
            stagesSummary: [
              { stage: "DEEP", minutes: 70 },
              { stage: "DEEP", minutes: 88 },
              { stage: "REM", minutes: 112 },
              { stage: "LIGHT", minutes: 225 },
              { stage: "AWAKE", minutes: 35 },
            ],
          },
        },
      },
    ],
    nextPageToken: "page-2",
  });

  assert.equal(parsed.nextPageToken, "page-2");
  assert.equal(parsed.sessions.size, 1);
  assert.equal(parsed.allSessions.length, 2);
  const nov22 = parsed.sessions.get("2026-11-22");
  assert.ok(nov22);
  assert.equal(nov22.sessionId, "overnight-1");
  assert.equal(nov22.minutesAsleep, 425);
  assert.equal(nov22.deepMinutes, 88);
  assert.equal(nov22.remMinutes, 112);
  assert.equal(nov22.lightMinutes, 225);
  assert.equal(nov22.minutesAwake, 35);
});

test("Saved sleep import, syncToken sensitivity, multi-user disconnect isolation, and MCP get_daily_log score", async () => {
  const m1Data = nutritionData(db, "M1");
  const m2Data = nutritionData(db, "M2");

  // Give M1 a fake Google connection plus both google & manual data, and M2 its own google data.
  await db.insert(schema.healthIntegration).values([
    {
      userId: "M1",
      provider: "google",
      credential: seal({ accessToken: "a1", refreshToken: "r1", expiresAt: Date.now() + 999999, scopes: [] }, "M1", "0".repeat(64)),
      accountLabel: "m1-fitbit@gmail.com",
      status: "connected",
    },
    {
      userId: "M2",
      provider: "google",
      credential: seal({ accessToken: "a2", refreshToken: "r2", expiresAt: Date.now() + 999999, scopes: [] }, "M2", "0".repeat(64)),
      accountLabel: "m2-fitbit@gmail.com",
      status: "connected",
    },
  ]);
  await m1Data.setPreferences({ timezone: "Europe/London", trackingMode: "fitbit" });
  await m2Data.setPreferences({ timezone: "Europe/London", trackingMode: "fitbit" });

  const tokM1BeforeSleep = await m1Data.syncToken();
  const tokM2BeforeSleep = await m2Data.syncToken();

  const fitbitSleepJson = JSON.stringify({
    sleep: [
      {
        dateOfSleep: "2026-11-22",
        startTime: "2026-11-21T23:50:00.000",
        endTime: "2026-11-22T07:20:00.000",
        minutesAsleep: 418,
        minutesAwake: 32,
        levels: { summary: { deep: { minutes: 90 }, rem: { minutes: 108 }, light: { minutes: 220 } } },
      },
    ],
  });
  const parsedSleepImport = parseSavedHealthImport(fitbitSleepJson, "Europe/London");
  assert.equal(parsedSleepImport.sleepEntries.length, 1);
  const resSleep = await m1Data.importHealthRecords(parsedSleepImport);
  assert.equal(resSleep.sleepImported, 1);

  const tokM1AfterSleep = await m1Data.syncToken();
  assert.notEqual(tokM1AfterSleep, tokM1BeforeSleep);
  assert.equal(await m2Data.syncToken(), tokM2BeforeSleep);

  // Save manual energy for M1 on 2026-11-22 and google data (including recovery & workouts) for both M1 and M2
  await m1Data.saveEnergy({ day: "2026-11-22", source: "manual", totalKcal: 2350, complete: true });
  await m1Data.saveEnergy({ day: "2026-11-22", source: "google", totalKcal: 2420, steps: 9800, complete: true });
  await m1Data.importHealthRecords({
    recoveryEntries: [{ day: "2026-11-22", source: "google", restingHrBpm: 56, hrvRmssdMs: 52 }],
    workoutEntries: [{ day: "2026-11-22", source: "google", sessionId: "m1-run", title: "Morning Run", durationSeconds: 2400, caloriesKcal: 360 }],
  });
  await m2Data.saveEnergy({ day: "2026-11-22", source: "google", totalKcal: 2150, steps: 7100, complete: true });
  await m2Data.importHealthRecords({
    sleepEntries: [{ day: "2026-11-22", source: "google", minutesAsleep: 390 }],
    recoveryEntries: [{ day: "2026-11-22", source: "google", restingHrBpm: 60, hrvRmssdMs: 41 }],
    workoutEntries: [{ day: "2026-11-22", source: "google", sessionId: "m2-walk", title: "Brisk Walk", durationSeconds: 1500 }],
  });

  // Verify MCP get_daily_log exposes nutritionScore and sleep cleanly
  await m1Data.log({
    day: "2026-11-22",
    time: "09:00",
    name: "Porridge & berries",
    category: "breakfast",
    items: [
      { name: "Porridge oats", amount: 60, unit: "g", calories: 222, proteinG: 6.6, carbsG: 36, fatG: 4.8, fibreG: 5.4, estimationMethod: "weighed" },
      { name: "Blueberries", amount: 80, unit: "g", calories: 46, proteinG: 0.6, carbsG: 11.2, fatG: 0.2, fibreG: 2.0, estimationMethod: "weighed" },
    ],
  });

  const readServer = fitnessMcp("M1", ["fitness:read"], db);
  const [rcT, rsT] = InMemoryTransport.createLinkedPair();
  const readClient = new Client({ name: "test-score-mcp", version: "1.0.0" });
  await Promise.all([readServer.connect(rsT), readClient.connect(rcT)]);
  const logRes = await readClient.callTool({ name: "get_daily_log", arguments: { day: "2026-11-22" } });
  const logJson = JSON.parse((logRes.content as { text: string }[])[0].text);
  assert.ok(logJson.nutritionScore);
  assert.ok(typeof logJson.nutritionScore.score === "number");
  assert.equal(logJson.sleep?.minutesAsleep, 418);
  await Promise.all([readClient.close(), readServer.close()]);

  // Disconnecting M1 cleans up M1's Google energy, sleep, recovery & workout rows ONLY and resets M1 trackingMode to manual
  await disconnectGoogle(db, "M1");
  const m1PrefAfterDisconnect = await m1Data.settings();
  assert.equal(m1PrefAfterDisconnect.trackingMode, "manual");
  assert.equal(m1PrefAfterDisconnect.preferredEnergySource, "manual");

  const m1DayAfterDisconnect = await m1Data.daily("2026-11-22");
  assert.equal(m1DayAfterDisconnect.sleep, null);
  assert.equal(m1DayAfterDisconnect.recovery, null);
  assert.deepEqual(m1DayAfterDisconnect.workouts, []);
  assert.equal(m1DayAfterDisconnect.energySources.google, undefined);
  assert.equal(m1DayAfterDisconnect.energySources.manual?.totalKcal, 2350);

  const m1RecRows = await db.select().from(schema.dailyRecovery).where(eq(schema.dailyRecovery.userId, "M1"));
  const m1WktRows = await db.select().from(schema.dailyWorkout).where(eq(schema.dailyWorkout.userId, "M1"));
  assert.equal(m1RecRows.length, 0);
  assert.equal(m1WktRows.length, 0);

  const m2PrefAfterM1Disconnect = await m2Data.settings();
  assert.equal(m2PrefAfterM1Disconnect.trackingMode, "fitbit");
  const m2DayAfterM1Disconnect = await m2Data.daily("2026-11-22");
  assert.equal(m2DayAfterM1Disconnect.sleep?.minutesAsleep, 390);
  assert.equal(m2DayAfterM1Disconnect.recovery?.restingHrBpm, 60);
  assert.equal(m2DayAfterM1Disconnect.workouts.length, 1);
  assert.equal(m2DayAfterM1Disconnect.energySources.google?.totalKcal, 2150);

  const m2HealthRow = await db.select().from(schema.healthIntegration).where(eq(schema.healthIntegration.userId, "M2"));
  assert.equal(m2HealthRow.length, 1);
});

test("MCP tools gate Fitbit metrics strictly on trackingMode and drop manual diary-complete copy", async () => {
  const m2Data = nutritionData(db, "M2");
  await m2Data.importHealthRecords({
    energyEntries: [
      {
        day: "2026-11-22",
        source: "google",
        totalKcal: 2240,
        activeKcal: 480,
        steps: 8500,
        activeZoneMinutes: 34,
        distanceMeters: 6200,
        floors: 11,
        complete: true,
      },
    ],
    recoveryEntries: [
      { day: "2026-11-22", source: "google", restingHrBpm: 58, hrvRmssdMs: 44, skinTempDeltaC: -0.2 },
    ],
    workoutEntries: [
      { day: "2026-11-22", source: "google", sessionId: "m2-swim", title: "Pool Swim", durationSeconds: 1800, activeZoneMinutes: 22 },
    ],
  });

  const server = fitnessMcp("M2", ["fitness:read"], db);
  const [cT, sT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-mode-mcp", version: "1.0.0" });
  await Promise.all([server.connect(sT), client.connect(cT)]);

  // In fitbit mode, M2 sees Fitbit sleep, recovery, workouts, and activeZoneMinutes
  const fitbitBal = await client.callTool({ name: "get_energy_balance", arguments: { from: "2026-11-22", to: "2026-11-22" } });
  const fitbitBalJson = JSON.parse((fitbitBal.content as { text: string }[])[0].text);
  assert.equal(fitbitBalJson.trackingMode, "fitbit");
  assert.equal(fitbitBalJson.days[0].activeZoneMinutes, 34);
  assert.equal(fitbitBalJson.days[0].floors, 11);
  assert.equal(fitbitBalJson.days[0].recovery?.restingHrBpm, 58);
  assert.equal(fitbitBalJson.days[0].workouts.length, 2); // m2-walk + m2-swim
  assert.equal(fitbitBalJson.days[0].sleep?.minutesAsleep, 390);
  assert.equal(fitbitBalJson.days[0].sleep?.sleepEfficiencyPct, null); // minutesAwake was null

  const remRes = await client.callTool({ name: "get_logging_reminders", arguments: {} });
  const remJson = JSON.parse((remRes.content as { text: string }[])[0].text);
  assert.ok(Array.isArray(remJson.suggestions));
  assert.equal(JSON.stringify(remJson.suggestions).toLowerCase().includes("mark the diary complete"), false);

  // Switch M2 to manual mode (even while healthIntegration row remains connected!)
  await m2Data.setPreferences({ timezone: "Europe/London", trackingMode: "manual" });
  const settingsRes = await client.callTool({ name: "get_nutrition_settings", arguments: {} });
  assert.equal(JSON.parse((settingsRes.content as { text: string }[])[0].text).trackingMode, "manual");

  const manualLog = await client.callTool({ name: "get_daily_log", arguments: { day: "2026-11-22" } });
  const manualLogJson = JSON.parse((manualLog.content as { text: string }[])[0].text);
  assert.equal(manualLogJson.trackingMode, "manual");
  assert.equal(manualLogJson.energy, null);
  assert.equal(manualLogJson.sleep, null);
  assert.equal(manualLogJson.recovery, null);
  assert.deepEqual(manualLogJson.workouts, []);

  const manualSum = await client.callTool({ name: "get_fitness_summary", arguments: { from: "2026-11-22", to: "2026-11-22" } });
  const manualSumJson = JSON.parse((manualSum.content as { text: string }[])[0].text);
  assert.equal(manualSumJson.trackingMode, "manual");
  assert.equal(manualSumJson.days[0].activeZoneMinutes, null);
  assert.equal(manualSumJson.days[0].sleep, null);
  assert.equal(manualSumJson.days[0].recovery, null);
  assert.deepEqual(manualSumJson.days[0].workouts, []);

  const manualHist = await client.callTool({ name: "get_nutrition_history", arguments: { from: "2026-11-22", to: "2026-11-22" } });
  assert.equal(JSON.parse((manualHist.content as { text: string }[])[0].text).trackingMode, "manual");

  await Promise.all([client.close(), server.close()]);
});

test("parseGoogleRecovery and parseGoogleWorkouts support dailyRollUp and dataPoints envelopes across Fitbit Air metrics", () => {
  const rhr = parseGoogleRecovery("daily-resting-heart-rate", {
    dataPoints: [
      { dailyRestingHeartRate: { date: { year: 2026, month: 11, day: 17 }, beatsPerMinute: 57.6 } },
    ],
  }, "Europe/London");
  assert.equal(rhr.field, "restingHrBpm");
  assert.equal(rhr.rows.get("2026-11-17"), 57.6);

  const hrv = parseGoogleRecovery("daily-heart-rate-variability", {
    rollupDataPoints: [
      { civilStartTime: { date: { year: 2026, month: 11, day: 17 } }, dailyHeartRateVariability: { rmssdMilliseconds: 48.34 } },
      { civilStartTime: { date: { year: 2026, month: 11, day: 18 } }, heartRateVariability: { rmssdMsAvg: 51.2 } },
    ],
  }, "Europe/London");
  assert.equal(hrv.field, "hrvRmssdMs");
  assert.equal(hrv.rows.get("2026-11-17"), 48.3);
  assert.equal(hrv.rows.get("2026-11-18"), 51.2);

  const spo2 = parseGoogleRecovery("daily-oxygen-saturation", {
    dataPoints: [
      { dailyOxygenSaturation: { date: { year: 2026, month: 11, day: 17 }, percentageAvg: 97.44 } },
      { civilStartTime: { date: { year: 2026, month: 11, day: 18 } }, oxygenSaturation: { percentage: 98.1 } },
    ],
  }, "Europe/London");
  assert.equal(spo2.field, "spo2Pct");
  assert.equal(spo2.rows.get("2026-11-17"), 97.4);
  assert.equal(spo2.rows.get("2026-11-18"), 98.1);

  const br = parseGoogleRecovery("daily-respiratory-rate", {
    dataPoints: [
      { dailyRespiratoryRate: { date: { year: 2026, month: 11, day: 17 }, breathsPerMinute: 14.84 } },
    ],
  }, "Europe/London");
  assert.equal(br.field, "respiratoryRate");
  assert.equal(br.rows.get("2026-11-17"), 14.8);

  const temp = parseGoogleRecovery("daily-sleep-temperature-derivations", {
    dataPoints: [
      { dailySleepTemperatureDerivations: { date: { year: 2026, month: 11, day: 17 }, nightlyTemperatureCelsiusDelta: -0.34 } },
      { civilStartTime: { date: { year: 2026, month: 11, day: 18 } }, dailySleepTemperatureDerivations: { deltaCelsius: 0 } },
    ],
  }, "Europe/London");
  assert.equal(temp.field, "skinTempDeltaC");
  assert.equal(temp.rows.get("2026-11-17"), -0.3);
  assert.equal(temp.rows.get("2026-11-18"), 0);

  const vo2 = parseGoogleRecovery("daily-vo2-max", {
    dataPoints: [
      { dailyVo2Max: { date: { year: 2026, month: 11, day: 17 }, vo2Max: 46.28 } },
      { civilStartTime: { date: { year: 2026, month: 11, day: 18 } }, vo2Max: { mlPerKgPerMin: 47.1 } },
    ],
  }, "Europe/London");
  assert.equal(vo2.field, "vo2Max");
  assert.equal(vo2.rows.get("2026-11-17"), 46.3);
  assert.equal(vo2.rows.get("2026-11-18"), 47.1);

  const bf = parseGoogleRecovery("body-fat", {
    dataPoints: [
      { bodyFat: { sampleTime: { physicalTime: "2026-11-17T08:00:00Z" }, percentage: 16.44 } },
    ],
  }, "Europe/London");
  assert.equal(bf.field, "bodyFatPct");
  assert.equal(bf.rows.get("2026-11-17"), 16.4);

  const workouts = parseGoogleWorkouts({
    dataPoints: [
      {
        name: "users/me/dataTypes/exercise/dataPoints/ex-run-1",
        exercise: {
          interval: {
            startTime: "2026-11-17T07:15:00Z",
            endTime: "2026-11-17T08:00:00Z",
            civilStartTime: { date: { year: 2026, month: 11, day: 17 }, time: { hours: 7, minutes: 15 } },
          },
          exerciseType: "RUNNING",
          displayName: "Tempo Run",
          activeDuration: "2700s",
          metricsSummary: {
            caloriesKcal: 485.4,
            distanceMeters: 7520.6,
            averageHeartRateBpm: 158.2,
            activeZoneMinutes: 39.4,
          },
        },
      },
    ],
    nextPageToken: "next-wkt",
  }, "Europe/London");
  assert.equal(workouts.nextPageToken, "next-wkt");
  assert.equal(workouts.workouts.length, 1);
  assert.deepEqual(workouts.workouts[0], {
    day: "2026-11-17",
    sessionId: "ex-run-1",
    startTime: "2026-11-17T07:15:00.000Z",
    endTime: "2026-11-17T08:00:00.000Z",
    exerciseType: "RUNNING",
    title: "Tempo Run",
    durationSeconds: 2700,
    caloriesKcal: 485.4,
    distanceMeters: 7520.6,
    avgHrBpm: 158.2,
    activeZoneMinutes: 39,
  });
});

test("parseSavedHealthImport and importHealthRecords persist extended Fitbit CSV and JSON recovery & workout records", async () => {
  const m1Data = nutritionData(db, "M1");
  await m1Data.setPreferences({ timezone: "Europe/London", trackingMode: "fitbit", preferredEnergySource: "google" });

  const csvFitbit = [
    "Date,Calories Burned,Activity Calories,Steps,Active Zone Minutes,Distance,Floors,Resting Heart Rate,HRV,SpO2,Body Fat",
    "2026-11-23,2480,610,11200,46,8400,15,55,54.2,97.8,15.6",
  ].join("\n");
  const parsedCsv = parseSavedHealthImport(csvFitbit, "Europe/London");
  assert.equal(parsedCsv.energyEntries.length, 1);
  assert.equal(parsedCsv.energyEntries[0].activeZoneMinutes, 46);
  assert.equal(parsedCsv.energyEntries[0].distanceMeters, 8400);
  assert.equal(parsedCsv.energyEntries[0].floors, 15);
  assert.equal(parsedCsv.recoveryEntries.length, 1);
  assert.equal(parsedCsv.recoveryEntries[0].restingHrBpm, 55);
  assert.equal(parsedCsv.recoveryEntries[0].hrvRmssdMs, 54.2);
  assert.equal(parsedCsv.recoveryEntries[0].spo2Pct, 97.8);
  assert.equal(parsedCsv.recoveryEntries[0].bodyFatPct, 15.6);

  const jsonFitbit = JSON.stringify({
    dailyRecovery: [
      {
        day: "2026-11-24",
        restingHrBpm: 54,
        hrvRmssdMs: 58.5,
        spo2Pct: 98.2,
        respiratoryRate: 14.4,
        skinTempDeltaC: -0.1,
        vo2Max: 47.5,
        bodyFatPct: 15.4,
      },
    ],
    workouts: [
      {
        day: "2026-11-24",
        sessionId: "json-cycle-1",
        title: "Indoor Cycling",
        exerciseType: "BIKING",
        startTime: "2026-11-24T18:00:00Z",
        endTime: "2026-11-24T18:45:00Z",
        durationSeconds: 2700,
        caloriesKcal: 410,
        distanceMeters: 18500,
        avgHrBpm: 146,
        activeZoneMinutes: 35,
      },
    ],
  });
  const parsedJson = parseSavedHealthImport(jsonFitbit, "Europe/London");
  assert.equal(parsedJson.recoveryEntries.length, 1);
  assert.equal(parsedJson.workoutEntries.length, 1);

  const resCsv = await m1Data.importHealthRecords(parsedCsv);
  assert.equal(resCsv.energyImported, 1);
  assert.equal(resCsv.recoveryImported, 1);

  const resJson = await m1Data.importHealthRecords(parsedJson);
  assert.equal(resJson.recoveryImported, 1);
  assert.equal(resJson.workoutsImported, 1);

  const nov23 = await m1Data.daily("2026-11-23");
  assert.equal(nov23.energy?.activeZoneMinutes, 46);
  assert.equal(nov23.energy?.distanceMeters, 8400);
  assert.equal(nov23.energy?.floors, 15);
  assert.equal(nov23.recovery?.restingHrBpm, 55);
  assert.equal(nov23.recovery?.hrvRmssdMs, 54.2);

  const nov24 = await m1Data.daily("2026-11-24");
  assert.equal(nov24.recovery?.vo2Max, 47.5);
  assert.equal(nov24.recovery?.skinTempDeltaC, -0.1);
  assert.equal(nov24.workouts.length, 1);
  assert.equal(nov24.workouts[0].title, "Indoor Cycling");
  assert.equal(nov24.workouts[0].activeZoneMinutes, 35);
});

test("syncGoogle ingests Fitbit Air metrics best-effort and syncGoogleAllUsers/push skip manual trackingMode users", async () => {
  process.env.FITNESS_INTEGRATION_KEY = "0".repeat(64);
  const m1Data = nutritionData(db, "M1");
  const m2Data = nutritionData(db, "M2");

  const fullScopes = [
    "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
    "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
    "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
    "https://www.googleapis.com/auth/googlehealth.nutrition.writeonly",
    "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.writeonly",
  ];

  await db
    .insert(schema.healthIntegration)
    .values({
      userId: "M1",
      provider: "google",
      credential: seal({ accessToken: "tok-m1", refreshToken: "ref-m1", expiresAt: Date.now() + 3600000, scopes: fullScopes }, "M1"),
      accountLabel: "m1@example.test",
      status: "connected",
    })
    .onConflictDoUpdate({
      target: [schema.healthIntegration.userId, schema.healthIntegration.provider],
      set: {
        credential: seal({ accessToken: "tok-m1", refreshToken: "ref-m1", expiresAt: Date.now() + 3600000, scopes: fullScopes }, "M1"),
        status: "connected",
      },
    });

  await m1Data.setPreferences({ timezone: "Europe/London", trackingMode: "fitbit", preferredEnergySource: "google", googleTwoWaySync: true });
  await m2Data.setPreferences({ timezone: "Europe/London", trackingMode: "manual", preferredEnergySource: "manual", googleTwoWaySync: true });

  const originalFetch = globalThis.fetch;
  const fetchedUrls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    fetchedUrls.push(url);
    if (url.includes("/total-calories/dataPoints:dailyRollUp")) {
      return Response.json({ rollupDataPoints: [{ civilStartTime: { date: { year: 2026, month: 11, day: 17 } }, totalCalories: { kcalSum: 2510 } }] });
    }
    if (url.includes("/active-energy-burned/dataPoints:dailyRollUp")) {
      return Response.json({ rollupDataPoints: [{ civilStartTime: { date: { year: 2026, month: 11, day: 17 } }, activeEnergyBurned: { kcalSum: 640 } }] });
    }
    if (url.includes("/steps/dataPoints:dailyRollUp")) {
      return Response.json({ rollupDataPoints: [{ civilStartTime: { date: { year: 2026, month: 11, day: 17 } }, steps: { countSum: 10450 } }] });
    }
    if (url.includes("/active-zone-minutes/dataPoints:dailyRollUp")) {
      return Response.json({ rollupDataPoints: [{ civilStartTime: { date: { year: 2026, month: 11, day: 17 } }, activeZoneMinutes: { minutesSum: 49 } }] });
    }
    if (url.includes("/distance/dataPoints:dailyRollUp")) {
      return Response.json({ rollupDataPoints: [{ civilStartTime: { date: { year: 2026, month: 11, day: 17 } }, distance: { metersSum: 7890.2 } }] });
    }
    if (url.includes("/floors/dataPoints:dailyRollUp")) {
      return new Response("Forbidden optional metric", { status: 403 }); // Verify optional endpoint failure never fails sync!
    }
    if (url.includes("/daily-resting-heart-rate/")) {
      return Response.json({ dataPoints: [{ dailyRestingHeartRate: { date: { year: 2026, month: 11, day: 17 }, beatsPerMinute: 56 } }] });
    }
    if (url.includes("/daily-heart-rate-variability/")) {
      return Response.json({ dataPoints: [{ dailyHeartRateVariability: { date: { year: 2026, month: 11, day: 17 }, rmssdMilliseconds: 53.4 } }] });
    }
    if (url.includes("/exercise/dataPoints")) {
      return Response.json({
        dataPoints: [
          {
            name: "users/me/dataTypes/exercise/dataPoints/sync-wkt-1",
            exercise: {
              interval: { startTime: "2026-11-17T17:00:00Z", endTime: "2026-11-17T17:40:00Z" },
              exerciseType: "STRENGTH_TRAINING",
              displayName: "Kettlebell Session",
              activeDuration: "2400s",
              metricsSummary: { caloriesKcal: 310, averageHeartRateBpm: 134, activeZoneMinutes: 28 },
            },
          },
        ],
      });
    }
    return Response.json({ rollupDataPoints: [], dataPoints: [] });
  }) as typeof fetch;

  try {
    const syncRes = await syncGoogle(db, "M1", "2026-11-16", "2026-11-17");
    assert.equal(syncRes.syncedDays, 1);
    assert.equal(syncRes.syncedRecoveryDays, 1);
    assert.equal(syncRes.syncedWorkouts, 1);

    const nov17 = await m1Data.daily("2026-11-17");
    assert.equal(nov17.energy?.totalKcal, 2510);
    assert.equal(nov17.energy?.activeZoneMinutes, 49);
    assert.equal(nov17.energy?.distanceMeters, 7890.2);
    assert.equal(nov17.recovery?.restingHrBpm, 56);
    assert.equal(nov17.recovery?.hrvRmssdMs, 53.4);
    assert.equal(nov17.workouts.length, 1);
    assert.equal(nov17.workouts[0].title, "Kettlebell Session");

    // syncGoogleAllUsers must sync M1 (fitbit mode) and skip M2 (manual mode)
    await syncGoogleAllUsers(db);
    const m2Rec = await db.select().from(schema.dailyRecovery).where(eq(schema.dailyRecovery.userId, "M2"));
    assert.equal(m2Rec.some((r) => r.day === "2026-11-17"), false);

    // Switching M1 to manual mode must cause pushWeightToGoogle and pushMealToGoogle to skip network calls and queueing
    await m1Data.setPreferences({ timezone: "Europe/London", trackingMode: "manual", preferredEnergySource: "manual", googleTwoWaySync: true });
    const existingMeal = (await m1Data.daily("2026-11-22")).meals[0];
    fetchedUrls.length = 0;
    const wtPush = await pushWeightToGoogle(db, "M1", { day: "2026-11-17", weightKg: 74.0 });
    const mealPush = await pushMealToGoogle(db, "M1", existingMeal);
    assert.equal(wtPush.pushed, false);
    assert.equal(mealPush.queued, false);
    assert.equal(fetchedUrls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FITNESS_INTEGRATION_KEY;
  }
});

test("health MCP exposes only the user's synced sleep, vitals and workouts in manual mode", async () => {
  for (const id of ["HEALTH-A", "HEALTH-B"]) {
    await db.insert(schema.user).values({id,name:id,email:`${id}@example.test`,createdAt:new Date(),updatedAt:new Date()});
    await nutritionData(db,id).importHealthRecords({
      sleepEntries:[{day:"2026-11-17",source:"google",minutesAsleep:id==="HEALTH-A"?420:500,sleepStart:"2026-11-16T23:00:00Z",sleepEnd:"2026-11-17T06:00:00Z"}],
      recoveryEntries:[{day:"2026-11-17",source:"google",restingHrBpm:id==="HEALTH-A"?55:70}],
      workoutEntries:[{day:"2026-11-17",source:"google",sessionId:id,title:id==="HEALTH-A"?"Cycling":"Private run",durationSeconds:1800}],
    });
    await nutritionData(db,id).setPreferences({timezone:"Europe/London",trackingMode:"manual",preferredEnergySource:"manual"});
  }
  const server=fitnessMcp("HEALTH-A",["fitness:read"],db);
  const [ct,st]=InMemoryTransport.createLinkedPair();const client=new Client({name:"health-read",version:"1"});
  await Promise.all([server.connect(st),client.connect(ct)]);
  try {
    const result=await client.callTool({name:"get_health_history",arguments:{from:"2026-11-17",to:"2026-11-18"}});
    assert.equal(result.isError,false);
    const data=JSON.parse((result.content as {text:string}[])[0].text);
    assert.equal(data.sleepSessions.length, 1);assert.equal(data.sleepSessions[0].completed, true);assert.equal(data.sleepSessions[0].minutesAsleep,420);assert.equal(data.sleep[0].minutesAsleep,420);assert.equal(data.recovery[0].restingHrBpm,55);
    assert.equal(data.workouts[0].title,"Cycling");assert.equal(data.workouts.length,1);
    assert.equal(data.days[1].hasSleep,false);assert.equal(data.days[1].hasRecovery,false);
    assert.ok(data.sleep[0].syncedAt);assert.equal(JSON.stringify(data).includes("Private run"),false);
  } finally { await Promise.all([client.close(),server.close()]); }
});

test("Stage 2: parseGoogleWorkouts reads metricsSummary.averageHeartRateBeatsPerMinute and HR/step parsers handle pagination & gaps", () => {
  const workoutRes = parseGoogleWorkouts({
    dataPoints: [
      {
        name: "users/me/dataTypes/exercise/dataPoints/hevy-nov23",
        exercise: {
          displayName: "Upper A",
          exerciseType: "EXERCISE_TYPE_WEIGHTLIFTING",
          interval: {
            startTime: "2026-11-23T13:42:00Z",
            endTime: "2026-11-23T15:02:00Z",
          },
          metricsSummary: {
            averageHeartRateBeatsPerMinute: 124.5,
            caloriesExpended: { kcal: 340 },
          },
        },
      },
    ],
  }, "Europe/London");
  assert.equal(workoutRes.workouts.length, 1);
  assert.equal(workoutRes.workouts[0].avgHrBpm, 124.5);
  assert.equal(workoutRes.workouts[0].durationSeconds, 4800);

  const hrParsed = parseGoogleHeartRate({
    reconciledDataPoints: [
      {
        heartRate: { beatsPerMinute: 112, sampleTime: { physicalTime: "2026-11-23T13:43:00Z" } },
        dataSource: { device: { type: "WATCH" } },
      },
      {
        heartRate: { beatsPerMinute: 132, sampleTime: { physicalTime: "2026-11-23T13:44:00Z" } },
        dataSource: { device: { type: "WATCH" } },
      },
      {
        heartRate: { beatsPerMinute: 140, sampleTime: { physicalTime: "2026-11-23T13:52:00Z" } },
        dataSource: { device: { type: "WATCH" } },
      },
    ],
    nextPageToken: "pg-2",
  }, "Europe/London", "google-wearables");
  assert.equal(hrParsed.nextPageToken, "pg-2");
  assert.equal(hrParsed.samples.length, 3);
  assert.equal(hrParsed.samples[0].day, "2026-11-23");

  const coverage = analyzeHeartRateCoverage(hrParsed.samples, "2026-11-23T13:42:00Z", "2026-11-23T15:02:00Z");
  assert.equal(coverage.sampleCount, 3);
  assert.equal(coverage.minBpm, 112);
  assert.equal(coverage.maxBpm, 140);
  assert.equal(coverage.gapCount, 1);
  assert.equal(coverage.maxGapSeconds, 480);

  const stepsParsed = parseGoogleStepIntervals({
    dataPoints: [
      {
        steps: {
          count: 420,
          interval: { startTime: "2026-11-23T13:45:00Z", endTime: "2026-11-23T14:00:00Z" },
        },
      },
    ],
  }, "Europe/London", "all-sources");
  assert.equal(stepsParsed.intervals.length, 1);
  assert.equal(stepsParsed.intervals[0].steps, 420);
});

test("Stage 2: syncGoogle paginates HR samples, backfills workout avgHrBpm, records diagnostics, and cleans up on disconnect", async () => {
  process.env.FITNESS_INTEGRATION_KEY = randomBytes(32).toString("hex");
  const originalFetch = globalThis.fetch;
  const userId = "HR-SYNC-1";
  await db.insert(schema.user).values({ id: userId, name: userId, email: "hr@example.test", createdAt: new Date(), updatedAt: new Date() });
  await nutritionData(db, userId).setPreferences({ timezone: "Europe/London", trackingMode: "fitbit", preferredEnergySource: "google" });
  await db.insert(schema.healthIntegration).values({
    userId,
    provider: "google",
    status: "connected",
    credential: seal(
      {
        accessToken: "hr-tok",
        refreshToken: "hr-ref",
        expiresAt: Date.now() + 3600_000,
        scopes: [
          "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
          "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
        ],
      },
      userId,
    ),
  });

  const seenUrls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    seenUrls.push(url);
    if (url.includes("/dataTypes/heart-rate/dataPoints:reconcile")) {
      if (url.includes("pageToken=page-2")) {
        return new Response(
          JSON.stringify({
            dataPoints: [
              { heartRate: { beatsPerMinute: 130, sampleTime: { physicalTime: "2026-11-23T14:10:00Z" } } },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          dataPoints: [
            { heartRate: { beatsPerMinute: 120, sampleTime: { physicalTime: "2026-11-23T13:50:00Z" } } },
          ],
          nextPageToken: "page-2",
        }),
        { status: 200 },
      );
    }
    if (url.includes("/dataTypes/steps/dataPoints:reconcile")) {
      return new Response(
        JSON.stringify({
          dataPoints: [
            { steps: { count: 250, interval: { startTime: "2026-11-23T13:50:00Z", endTime: "2026-11-23T14:05:00Z" } } },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/dataTypes/exercise/dataPoints:reconcile")) {
      return new Response(
        JSON.stringify({
          dataPoints: [
            {
              name: "users/me/dataTypes/exercise/dataPoints/hevy-no-hr",
              exercise: {
                displayName: "Upper A",
                exerciseType: "EXERCISE_TYPE_WEIGHTLIFTING",
                interval: { startTime: "2026-11-23T13:42:00Z", endTime: "2026-11-23T15:02:00Z" },
              },
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.includes("/dataTypes/body-fat/")) {
      return new Response("Forbidden", { status: 403 });
    }
    if (url.includes("dailyRollUp")) {
      return new Response(JSON.stringify({ rollupDataPoints: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ dataPoints: [] }), { status: 200 });
  }) as typeof fetch;

  try {
    const res = await syncGoogle(db, userId, "2026-11-23", "2026-11-23");
    assert.equal(res.syncedHeartRateSamples, 2);
    assert.equal(res.syncedStepIntervals, 1);
    assert.equal(res.diagnostics["heart-rate"].status, "ok");
    assert.equal(res.diagnostics["heart-rate"].count, 2);
    assert.equal(res.diagnostics["recovery:body-fat"].status, "error");
    assert.ok(seenUrls.some((u) => u.includes("body_fat.sample_time")));

    const workouts = await db.select().from(schema.dailyWorkout).where(eq(schema.dailyWorkout.userId, userId));
    assert.equal(workouts.length, 1);
    assert.equal(workouts[0].avgHrBpm, 125); // Backfilled from 120 and 130 BPM samples

    const hrRows = await db.select().from(schema.heartRateSample).where(eq(schema.heartRateSample.userId, userId));
    assert.equal(hrRows.length, 2);

    const stepRows = await db.select().from(schema.stepInterval).where(eq(schema.stepInterval.userId, userId));
    assert.equal(stepRows.length, 1);

    await disconnectGoogle(db, userId);
    assert.equal((await db.select().from(schema.heartRateSample).where(eq(schema.heartRateSample.userId, userId))).length, 0);
    assert.equal((await db.select().from(schema.stepInterval).where(eq(schema.stepInterval.userId, userId))).length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FITNESS_INTEGRATION_KEY;
  }
});

test("concurrent syncGoogle calls coalesce cleanly without triggering a 409 connection-changed error", async () => {
  process.env.FITNESS_INTEGRATION_KEY = randomBytes(32).toString("hex");
  const originalFetch = globalThis.fetch;
  const userId = "CONCURRENT-SYNC-1";
  await db.insert(schema.user).values({ id: userId, name: userId, email: "concurrent@example.test", createdAt: new Date(), updatedAt: new Date() });
  await nutritionData(db, userId).setPreferences({ timezone: "Europe/London", trackingMode: "fitbit", preferredEnergySource: "google" });
  await db.insert(schema.healthIntegration).values({
    userId,
    provider: "google",
    status: "connected",
    accountLabel: "concurrent@example.test",
    credential: seal(
      {
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: Date.now() + 3600_000,
        scopes: [
          "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
          "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
        ],
      },
      userId,
    ),
  });

  globalThis.fetch = (async () => new Response(JSON.stringify({ rollupDataPoints: [], dataPoints: [] }), { status: 200 })) as typeof fetch;

  try {
    const [a, b] = await Promise.all([
      syncGoogle(db, userId, "2026-11-23", "2026-11-23"),
      syncGoogle(db, userId, "2026-11-23", "2026-11-23"),
    ]);
    assert.equal(a.syncedDays, 0);
    assert.equal(b.syncedDays, 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FITNESS_INTEGRATION_KEY;
  }
});

