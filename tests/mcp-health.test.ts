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
  buildGoogleNutritionLogDataPoint,
  buildGoogleWeightDataPoint,
  disconnectGoogle,
  parseGoogleRollup,
  parseGoogleSleep,
  parseSavedHealthImport,
  seal,
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

test("Google Health dailyRollUp parser handles total-calories, active-energy-burned, steps, and weight", () => {
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
  assert.equal(rwTools.length, 13);
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

test("parseGoogleSleep deduplicates stage enums, skips short naps, and assigns overnight sleep to wake date", () => {
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

  // Save manual energy for M1 on 2026-11-22 and google data for both M1 and M2
  await m1Data.saveEnergy({ day: "2026-11-22", source: "manual", totalKcal: 2350, complete: true });
  await m1Data.saveEnergy({ day: "2026-11-22", source: "google", totalKcal: 2420, steps: 9800, complete: true });
  await m2Data.saveEnergy({ day: "2026-11-22", source: "google", totalKcal: 2150, steps: 7100, complete: true });
  await m2Data.importHealthRecords({
    sleepEntries: [{ day: "2026-11-22", source: "google", minutesAsleep: 390 }],
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

  // Disconnecting M1 cleans up M1's Google energy & sleep rows ONLY, leaving M1 manual and all M2 data intact
  await disconnectGoogle(db, "M1");
  const m1DayAfterDisconnect = await m1Data.daily("2026-11-22");
  assert.equal(m1DayAfterDisconnect.sleep, null);
  assert.equal(m1DayAfterDisconnect.energySources.google, undefined);
  assert.equal(m1DayAfterDisconnect.energySources.manual?.totalKcal, 2350);

  const m2DayAfterM1Disconnect = await m2Data.daily("2026-11-22");
  assert.equal(m2DayAfterM1Disconnect.sleep?.minutesAsleep, 390);
  assert.equal(m2DayAfterM1Disconnect.energySources.google?.totalKcal, 2150);

  const m2HealthRow = await db.select().from(schema.healthIntegration).where(eq(schema.healthIntegration.userId, "M2"));
  assert.equal(m2HealthRow.length, 1);
});



