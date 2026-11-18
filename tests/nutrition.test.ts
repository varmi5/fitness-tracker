import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { nutritionData } from "../lib/nutrition-data";
import {
  addDays,
  computeSleepEfficiencyPct,
  isDayComplete,
  localDay,
  localTime,
  resolveActiveHomeDay,
  resolveLocalDateTime,
  resolveTrackingPreferences,
} from "../lib/nutrition-model";
import { classifyFoodQuality, scoreDayNutrition, scoreMealNutrition } from "../lib/nutrition-score";
import { parseOpenFoodFactsProduct, searchUkStaples } from "../lib/uk-foods";
import * as schema from "../lib/schema";

const pg = new PGlite();
const db = drizzle(pg, { schema });

before(async () => {
  const migrations = (await readdir("migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const migration of migrations) {
    await pg.exec(await readFile(`migrations/${migration}`, "utf8"));
  }
  await db.insert(schema.user).values(
    ["U1", "U2"].map((id) => ({
      id,
      name: id,
      email: `${id}@example.test`,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
});

after(async () => pg.close());

test("synthetic 17 November 2026 fixture yields 665 kcal, 1235 remaining, 69g P, 7g C, 40g F, null fibre", async () => {
  const u1 = nutritionData(db, "U1");

  await u1.log({
    day: "2026-11-17",
    time: "08:30",
    name: "Three large eggs & Cholula",
    category: "breakfast",
    cookingMethod: "Soft-scrambled",
    ingredients: "Three large eggs, Cholula hot sauce",
    idempotencyKey: "fixture-breakfast-1",
    items: [
      {
        name: "Three large eggs",
        amount: 180,
        unit: "g",
        calories: 257,
        proteinG: 22.7,
        carbsG: 2.0,
        fatG: 17.5,
        fibreG: null,
        estimationMethod: "weighed",
      },
      {
        name: "Cholula hot sauce",
        amount: 15,
        unit: "ml",
        calories: 3,
        proteinG: 0.1,
        carbsG: 0.5,
        fatG: 0,
        fibreG: null,
        estimationMethod: "measured",
      },
    ],
  });

  // Retrying with same idempotencyKey must NOT duplicate the meal.
  const retry = await u1.log({
    day: "2026-11-17",
    time: "08:30",
    name: "Three large eggs & Cholula",
    category: "breakfast",
    idempotencyKey: "fixture-breakfast-1",
    items: [
      { name: "Three large eggs", amount: 180, unit: "g", calories: 257, estimationMethod: "weighed" },
    ],
  });
  assert.equal(retry.deduplicated, true);

  await u1.log({
    day: "2026-11-17",
    time: "13:15",
    name: "Grilled chicken",
    category: "lunch",
    idempotencyKey: "fixture-lunch-1",
    items: [
      {
        name: "Chicken breast, grilled",
        amount: 150,
        unit: "g",
        calories: 405,
        proteinG: 46.2,
        carbsG: 4.5,
        fatG: 22.5,
        fibreG: null,
        estimationMethod: "weighed",
      },
    ],
  });

  const day = await u1.daily("2026-11-17");
  assert.equal(day.meals.length, 2);
  assert.equal(day.target, 1900);
  assert.equal(day.totals.calories, 665);
  assert.equal(day.remaining, 1235);
  assert.equal(day.totals.proteinG, 69);
  assert.equal(day.totals.carbsG, 7);
  assert.equal(day.totals.fatG, 40);
  assert.equal(day.totals.fibreG, null);
  assert.equal(day.totals.hasUnknownValues, true);
});

test("Europe/London handles spring forward and autumn back DST transitions accurately", () => {
  // 2026-03-29: clocks go forward at 01:00 UTC -> 02:00 BST (UTC+1)
  const springAfternoon = resolveLocalDateTime("2026-03-29", "14:30", "Europe/London");
  assert.equal(localDay(springAfternoon, "Europe/London"), "2026-03-29");
  assert.equal(localTime(springAfternoon, "Europe/London"), "14:30");
  assert.equal(springAfternoon.toISOString(), "2026-03-29T13:30:00.000Z");

  // 2026-10-25: clocks go back at 02:00 BST -> 01:00 GMT (UTC+0)
  const autumnEvening = resolveLocalDateTime("2026-10-25", "20:15", "Europe/London");
  assert.equal(localDay(autumnEvening, "Europe/London"), "2026-10-25");
  assert.equal(localTime(autumnEvening, "Europe/London"), "20:15");
  assert.equal(autumnEvening.toISOString(), "2026-10-25T20:15:00.000Z");
});

test("historical calorie targets, appendItems, duplicate, move date, and provisional day accounting", async () => {
  const u1 = nutritionData(db, "U1");

  await u1.setTarget({ effectiveFrom: "2026-11-18", calories: 2100 });
  assert.equal((await u1.daily("2026-11-17")).target, 1900);
  assert.equal((await u1.daily("2026-11-18")).target, 2100);

  // Append an item to an existing meal ("add another spoon of dhal") with idempotency
  const baseMeal = await u1.log({
    day: "2026-11-18",
    time: "19:00",
    name: "Dinner Dhal",
    category: "dinner",
    items: [
      {
        name: "Red lentil dhal",
        amount: 250,
        unit: "g",
        calories: 280,
        proteinG: 16,
        carbsG: 42,
        fatG: 4,
        fibreG: 8,
        estimationMethod: "recipe",
      },
    ],
  });

  const appended = await u1.update({
    id: baseMeal.meal.id,
    idempotencyKey: "append-spoon-1",
    appendItems: [
      {
        name: "Extra spoon of dhal",
        amount: 50,
        unit: "g",
        calories: 56,
        proteinG: 3.2,
        carbsG: 8.4,
        fatG: 0.8,
        fibreG: 1.6,
        estimationMethod: "recipe",
      },
    ],
  });
  assert.equal(appended.meal.items.length, 2);
  assert.equal(appended.meal.totals.calories, 336);

  // Duplicate to 2026-11-19 and move to 2026-11-20
  const dup = await u1.duplicate(baseMeal.meal.id, "2026-11-19");
  assert.equal(dup.meal.localDay, "2026-11-19");
  assert.equal(dup.meal.items.length, 2);

  await u1.update({ id: dup.meal.id, day: "2026-11-20" });
  assert.equal((await u1.daily("2026-11-19")).meals.length, 0);
  assert.equal((await u1.daily("2026-11-20")).meals.length, 1);

  // Energy balance & provisional exclusion:
  // On calendarToday 2026-11-18, 2026-11-17 is auto-completed (day < activeDay) with manual TDEE 2365 -> deficit 2365 - 665 = 1700.
  // 2026-11-18 (active day, diaryComplete: false) and 2026-11-19 (unlogged, null intake) remain provisional.
  await u1.saveEnergy({ day: "2026-11-17", source: "manual", totalKcal: 2365, activeKcal: 450, steps: 9100, complete: true });
  await u1.saveEnergy({ day: "2026-11-18", source: "manual", totalKcal: 2400, activeKcal: 500, steps: 9500, complete: true });
  await u1.saveEnergy({ day: "2026-11-19", source: "manual", totalKcal: 2400, complete: true });

  const hist = await u1.history("2026-11-17", "2026-11-19", { calendarToday: "2026-11-18" });
  assert.equal(hist.totalDays, 3);
  assert.equal(hist.completeNutritionDays, 1);
  assert.equal(hist.comparableDays, 1);
  assert.equal(hist.cumulativeDeficit, 1700);
  assert.equal(hist.averages.calories, 665);
  assert.equal(hist.days[0].diaryComplete, true);
  assert.equal(hist.days[1].diaryComplete, false);
  assert.equal(hist.days[2].diaryComplete, false);
  assert.equal(hist.days[2].totals.calories, null); // Unlogged day stays null, never 0.
});

test("strict user isolation across meals, templates, energy, and UK library helpers", async () => {
  const u1 = nutritionData(db, "U1");
  const u2 = nutritionData(db, "U2");

  const tpl = await u1.saveTemplate({
    kind: "recipe",
    name: "U1 Secret Curry",
    defaultAmount: 200,
    defaultUnit: "g",
    batchCookedGrams: 800,
    calories: 900,
  });

  // U2 cannot overwrite U1's template or delete U1's meals or see U1's history
  await assert.rejects(
    () => u2.saveTemplate({ id: tpl.id, kind: "recipe", name: "Hijack", defaultAmount: 100, defaultUnit: "g" }),
    /not found/i,
  );
  const u1Day = await u1.daily("2026-11-17");
  await assert.rejects(() => u2.remove(u1Day.meals[0].id, true), /not found/i);
  assert.equal((await u2.daily("2026-11-17")).meals.length, 0);
  assert.equal((await u2.library("Secret")).saved.length, 0);

  // UK CoFID + Open Food Facts helpers
  assert.ok(searchUkStaples("lentils").length >= 1);
  const parsedOff = parseOpenFoodFactsProduct("5000112637922", {
    status: 1,
    product: {
      product_name: "Scottish Porridge Oats",
      brands: "Mornflake",
      quantity: "1 kg",
      serving_size: "40g",
      nutriments: {
        "energy-kcal_100g": 370,
        proteins_100g: 11,
        carbohydrates_100g: 60,
        fat_100g: 8,
      },
    },
  });
  assert.equal(parsedOff?.name, "Mornflake Scottish Porridge Oats");
  assert.equal(parsedOff?.calories, 370);
  assert.equal(parsedOff?.fibreG, null);
});

test("Nutrition quality score classifies whole foods vs NOVA-4 UPFs and keeps missing fibre honest", () => {
  const whole = classifyFoodQuality({
    name: "Wild salmon fillet with steamed broccoli & brown rice",
    calories: 520,
    proteinG: 42,
    carbsG: 46,
    fatG: 18,
    fibreG: 7.2,
    gramWeight: 380,
    estimationMethod: "weighed",
  });
  assert.equal(whole.nova, 1);
  assert.ok(whole.itemScore >= 75);

  const upf = classifyFoodQuality({
    name: "Cola & glazed doughnut",
    calories: 540,
    proteinG: 4,
    carbsG: 76,
    fatG: 22,
    fibreG: 1.1,
    foodSnapshot: {
      brand: "SweetCo",
      foodType: "food",
      source: "Open Food Facts",
      qualityMeta: {
        nutriScoreGrade: "e",
        novaGroup: 4,
        sugarsG: 34,
        saturatedFatG: 11,
      },
    },
  });
  assert.equal(upf.nova, 4);
  assert.ok(upf.itemScore < 45);
  assert.ok(upf.signals.upfCalories > 0);

  const mealScore = scoreMealNutrition(
    {
      name: "Omelette",
      items: [
        { name: "Eggs", calories: 260, proteinG: 22, carbsG: 2, fatG: 18, fibreG: null, gramWeight: 180 },
        { name: "Spinach", calories: 25, proteinG: 3, carbsG: 2, fatG: 0.4, fibreG: 2.6, gramWeight: 100 },
      ],
      totals: { calories: 285, proteinG: 25, carbsG: 4, fatG: 18.4, fibreG: 2.6, calMin: null, calMax: null, hasUnknownValues: true },
    },
    { calories: 2000, proteinG: 150, carbsG: 190, fatG: 65, fibreG: 30 },
  );
  assert.ok(mealScore.score != null && mealScore.score >= 70);
  assert.equal(mealScore.unknownFibreCount, 1);
  assert.equal(mealScore.fibreG, 2.6);

  const emptyDay = scoreDayNutrition(
    [],
    { calories: null, proteinG: null, carbsG: null, fatG: null, fibreG: null, calMin: null, calMax: null, hasUnknownValues: false },
    2000,
    { calories: 2000, proteinG: 150, carbsG: 190, fatG: 65, fibreG: 30 },
  );
  assert.equal(emptyDay.coverage, "empty");
  assert.equal(emptyDay.score, null);
  assert.equal(emptyDay.fibreG, null);

  // Missing fibre across all items stays null (never 0) and is omitted from composite instead of penalized
  const noFibreDay = scoreDayNutrition(
    [
      {
        name: "Plain omelette",
        items: [{ name: "Eggs", calories: 320, proteinG: 26, carbsG: 2, fatG: 22, fibreG: null, gramWeight: 220 }],
      },
    ],
    { calories: 320, proteinG: 26, carbsG: 2, fatG: 22, fibreG: null, calMin: null, calMax: null, hasUnknownValues: true },
    2000,
    { calories: 2000, proteinG: 150, carbsG: 190, fatG: 65, fibreG: 30 },
  );
  assert.equal(noFibreDay.fibreG, null);
  assert.equal(noFibreDay.fibreSubscore, null);
  assert.equal(noFibreDay.unknownFibreCount, 1);
  assert.ok(noFibreDay.score != null && noFibreDay.score >= 60);
});

test("resolveActiveHomeDay rolls over cleanly at midnight and trackingMode strictly gates Fitbit metrics", async () => {
  // Pure model logic: clean 12:00 AM rollover, no pre-sleep holding, day < activeDay auto-complete
  assert.deepEqual(
    resolveActiveHomeDay({ calendarToday: "2026-11-25" }),
    { activeDay: "2026-11-25", waitingForSleep: false },
  );
  assert.equal(isDayComplete("2026-11-24", "2026-11-25"), true);
  assert.equal(isDayComplete("2026-11-25", "2026-11-25"), false);
  assert.equal(isDayComplete("2026-11-26", "2026-11-25"), false);

  // Preference synchronization
  assert.deepEqual(resolveTrackingPreferences({ trackingMode: "fitbit" }), {
    trackingMode: "fitbit",
    preferredEnergySource: "google",
  });
  assert.deepEqual(resolveTrackingPreferences({ trackingMode: "manual" }), {
    trackingMode: "manual",
    preferredEnergySource: "manual",
  });
  assert.deepEqual(resolveTrackingPreferences({ trackingMode: "fitbit", preferredEnergySource: "manual" }), {
    trackingMode: "fitbit",
    preferredEnergySource: "google",
  });
  assert.deepEqual(resolveTrackingPreferences({ preferredEnergySource: "google" }), {
    trackingMode: "fitbit",
    preferredEnergySource: "google",
  });
  assert.deepEqual(resolveTrackingPreferences({ preferredEnergySource: "apple" }), {
    trackingMode: "manual",
    preferredEnergySource: "apple",
  });

  // Sleep efficiency edge cases (missing minutesAwake stays null)
  assert.equal(computeSleepEfficiencyPct(410, 30), 93);
  assert.equal(computeSleepEfficiencyPct(420, 0), 100);
  assert.equal(computeSleepEfficiencyPct(390, null), null);
  assert.equal(computeSleepEfficiencyPct(0, 0), null);
  assert.equal(computeSleepEfficiencyPct(0, 45), 0);
  assert.equal(computeSleepEfficiencyPct(-10, 20), null);

  // DB-backed rollover & manual vs fitbit mode gating
  await db.insert(schema.user).values({
    id: "U3",
    name: "U3",
    email: "u3@example.test",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const u3 = nutritionData(db, "U3");
  const today = "2026-11-25";
  const yesterday = addDays(today, -1);

  // Default for a new user is manual mode (even if Google integration row exists without preference!)
  assert.equal((await u3.settings()).trackingMode, "manual");
  assert.equal((await u3.settings()).preferredEnergySource, "manual");

  await db.insert(schema.healthIntegration).values({
    userId: "U3",
    provider: "google",
    credential: "synthetic-sealed",
    accountLabel: "u3-fitbit@gmail.com",
    status: "connected",
  });

  // Still manual when preference row is missing!
  assert.equal((await u3.settings()).trackingMode, "manual");

  await u3.log({
    day: yesterday,
    time: "23:45",
    name: "Late yoghurt",
    category: "snacks",
    items: [{ name: "Greek yoghurt", amount: 150, unit: "g", calories: 140, proteinG: 15, carbsG: 6, fatG: 5, estimationMethod: "weighed" }],
  });

  // Seed Google energy, sleep (no morning sleep yet on `today`), recovery (including negative skin temp delta), and workout on `yesterday` and `today`
  await u3.saveEnergy({
    day: yesterday,
    source: "manual",
    totalKcal: 2100,
    steps: 6500,
    complete: true,
  });
  await u3.importHealthRecords({
    energyEntries: [
      {
        day: yesterday,
        source: "google",
        totalKcal: 2450,
        activeKcal: 580,
        steps: 10200,
        activeZoneMinutes: 42,
        distanceMeters: 7850.5,
        floors: 14,
        complete: true,
      },
      {
        day: today,
        source: "google",
        totalKcal: 1850,
        activeKcal: 310,
        steps: 5400,
        activeZoneMinutes: 25,
        distanceMeters: 4100,
        floors: 8,
        complete: true,
      },
    ],
    sleepEntries: [
      {
        day: yesterday,
        source: "google",
        sleepStart: "2026-11-24T00:10:00.000Z",
        sleepEnd: "2026-11-24T07:20:00.000Z",
        minutesAsleep: 410,
        minutesAwake: 30,
        deepMinutes: 85,
        remMinutes: 105,
        lightMinutes: 220,
        stagesJson: [
          { stage: "DEEP", minutes: 85 },
          { stage: "REM", minutes: 105 },
          { stage: "LIGHT", minutes: 220 },
          { stage: "AWAKE", minutes: 30 },
        ],
      },
    ],
    recoveryEntries: [
      {
        day: yesterday,
        source: "google",
        restingHrBpm: 56,
        hrvRmssdMs: 48.5,
        spo2Pct: 97.2,
        respiratoryRate: 14.8,
        skinTempDeltaC: -0.35,
        vo2Max: 47.4,
        bodyFatPct: 16.8,
      },
    ],
    workoutEntries: [
      {
        day: yesterday,
        source: "google",
        sessionId: "run-1",
        title: "Morning Run",
        exerciseType: "RUNNING",
        startTime: "2026-11-24T07:45:00.000Z",
        endTime: "2026-11-24T08:20:00.000Z",
        durationSeconds: 2100,
        caloriesKcal: 340,
        distanceMeters: 5200,
        avgHrBpm: 152,
        activeZoneMinutes: 31,
      },
    ],
  });

  // In manual mode (even with Google connected and Google rows in DB):
  // - activeDay is calendarToday (no pre-sleep holding)
  // - showSleep is false, sleep/recovery/workouts are hidden, energy never returns google
  await u3.setPreferences({ timezone: "Europe/London", trackingMode: "manual" });
  const manualHome = await u3.homeSnapshot(today, { canReadSleep: true });
  assert.equal(manualHome.activeDay, today);
  assert.equal(manualHome.waitingForSleep, false);
  assert.equal(manualHome.showSleep, false);
  assert.equal(manualHome.settings.trackingMode, "manual");
  assert.equal(manualHome.daily.trackingMode, "manual");
  assert.equal(manualHome.daily.energy, null); // Today has only google energy, never returned in manual mode
  assert.equal(manualHome.daily.energySources.google, undefined);
  assert.equal(manualHome.daily.sleep, null);
  assert.equal(manualHome.daily.recovery, null);
  assert.deepEqual(manualHome.daily.workouts, []);

  const manualYesterday = await u3.daily(yesterday, { calendarToday: today });
  assert.equal(manualYesterday.diaryComplete, true); // day < activeDay
  assert.equal(manualYesterday.energy?.source, "manual");
  assert.equal(manualYesterday.energy?.totalKcal, 2100);
  assert.equal(manualYesterday.energySources.google, undefined);
  assert.equal(manualYesterday.energySources.manual?.totalKcal, 2100);
  assert.equal(manualYesterday.sleep, null);
  assert.equal(manualYesterday.recovery, null);
  assert.deepEqual(manualYesterday.workouts, []);

  const manualHist = await u3.history(yesterday, today, { calendarToday: today });
  assert.equal(manualHist.trackingMode, "manual");
  assert.equal(manualHist.days[0].diaryComplete, true);
  assert.equal(manualHist.days[0].energy?.source, "manual");
  assert.equal(manualHist.days[0].sleep, null);
  assert.equal(manualHist.days[0].recovery, null);
  assert.deepEqual(manualHist.days[0].workouts, []);
  assert.equal(manualHist.days[1].diaryComplete, false);
  assert.equal(manualHist.days[1].energy, null);

  // Midnight local timezone rollover check (America/New_York UTC-5 in Nov)
  await u3.setPreferences({ timezone: "America/New_York", trackingMode: "fitbit" });
  const beforeNyMidnight = await u3.homeState({ now: new Date("2026-11-25T04:59:30.000Z") });
  assert.equal(beforeNyMidnight.calendarToday, "2026-11-24");
  assert.equal(beforeNyMidnight.activeDay, "2026-11-24");
  assert.equal(beforeNyMidnight.waitingForSleep, false);
  assert.equal(beforeNyMidnight.showSleep, true);

  const afterNyMidnight = await u3.homeState({ now: new Date("2026-11-25T05:00:30.000Z") });
  assert.equal(afterNyMidnight.calendarToday, "2026-11-25");
  assert.equal(afterNyMidnight.activeDay, "2026-11-25");
  assert.equal(afterNyMidnight.waitingForSleep, false);

  // In fitbit mode: no pre-sleep holding even when today's sleep is absent, and Fitbit metrics are surfaced
  const tokFitbitBefore = await u3.syncToken();
  const fitbitHome = await u3.homeSnapshot(today, { canReadSleep: true });
  assert.equal(fitbitHome.activeDay, today);
  assert.equal(fitbitHome.waitingForSleep, false);
  assert.equal(fitbitHome.showSleep, true);
  assert.equal(fitbitHome.settings.trackingMode, "fitbit");
  assert.equal(fitbitHome.settings.preferredEnergySource, "google");
  assert.equal(fitbitHome.daily.energy?.source, "google");
  assert.equal(fitbitHome.daily.energy?.activeZoneMinutes, 25);
  assert.equal(fitbitHome.daily.energy?.distanceMeters, 4100);
  assert.equal(fitbitHome.daily.energy?.floors, 8);

  const fitbitYesterday = await u3.daily(yesterday, { calendarToday: today });
  assert.equal(fitbitYesterday.diaryComplete, true);
  assert.equal(fitbitYesterday.energy?.source, "google");
  assert.equal(fitbitYesterday.energy?.activeZoneMinutes, 42);
  assert.equal(fitbitYesterday.energy?.distanceMeters, 7850.5);
  assert.equal(fitbitYesterday.energy?.floors, 14);
  assert.equal(fitbitYesterday.sleep?.sleepEfficiencyPct, 93);
  assert.equal(fitbitYesterday.recovery?.restingHrBpm, 56);
  assert.equal(fitbitYesterday.recovery?.skinTempDeltaC, -0.35);
  assert.equal(fitbitYesterday.recovery?.vo2Max, 47.4);
  assert.equal(fitbitYesterday.workouts.length, 1);
  assert.equal(fitbitYesterday.workouts[0].title, "Morning Run");
  assert.equal(fitbitYesterday.workouts[0].activeZoneMinutes, 31);

  // syncToken changes when recovery, workouts, or trackingMode change
  await u3.saveRecovery({ day: today, source: "google", restingHrBpm: 55, skinTempDeltaC: 0.15 });
  const tokAfterRecovery = await u3.syncToken();
  assert.notEqual(tokAfterRecovery, tokFitbitBefore);

  await u3.saveWorkouts([{ day: today, source: "google", sessionId: "walk-1", title: "Evening Walk", durationSeconds: 1800 }]);
  const tokAfterWorkout = await u3.syncToken();
  assert.notEqual(tokAfterWorkout, tokAfterRecovery);

  await u3.setPreferences({ timezone: "America/New_York", trackingMode: "manual" });
  const tokAfterModeToggle = await u3.syncToken();
  assert.notEqual(tokAfterModeToggle, tokAfterWorkout);

  // exportAll includes dailyRecovery, dailyWorkout, expanded dailyEnergy, and synchronized preferences
  const exported = await u3.export();
  assert.equal(exported.preferences.trackingMode, "manual");
  assert.equal(exported.preferences.preferredEnergySource, "manual");
  assert.equal(exported.dailyRecovery.length, 2);
  assert.equal(exported.dailyWorkout.length, 2);
  assert.ok(exported.dailyEnergy.some((e) => e.activeZoneMinutes === 42 && e.floors === 14));

  // Even if DB holds legacy/desynced preferred_energy_source alongside tracking_mode, export() normalizes it
  await pg.query(`UPDATE nutrition_preference SET preferred_energy_source = 'google' WHERE user_id = 'U3'`);
  const exportedAfterManualDesync = await u3.export();
  assert.equal(exportedAfterManualDesync.preferences.trackingMode, "manual");
  assert.equal(exportedAfterManualDesync.preferences.preferredEnergySource, "manual");

  await pg.query(`UPDATE nutrition_preference SET tracking_mode = 'fitbit', preferred_energy_source = 'manual' WHERE user_id = 'U3'`);
  const exportedAfterFitbitDesync = await u3.export();
  assert.equal(exportedAfterFitbitDesync.preferences.trackingMode, "fitbit");
  assert.equal(exportedAfterFitbitDesync.preferences.preferredEnergySource, "google");
});

test("migration 012 backfills tracking_mode safely and is idempotent", async () => {
  const freshPg = new PGlite();
  try {
    const migrations = (await readdir("migrations")).filter((f) => f.endsWith(".sql")).sort();
    const pre012 = migrations.filter((m) => m < "012-");
    const m012 = migrations.find((m) => m.startsWith("012-"));
    const post012 = migrations.filter((m) => m >= "013-");
    assert.ok(m012, "migration 012 should exist");

    for (const m of pre012) {
      await freshPg.exec(await readFile(`migrations/${m}`, "utf8"));
    }

    await freshPg.exec(`
      INSERT INTO "user" (id, name, email, created_at, updated_at) VALUES
        ('B1', 'B1', 'b1@example.test', now(), now()),
        ('B2', 'B2', 'b2@example.test', now(), now()),
        ('B3', 'B3', 'b3@example.test', now(), now()),
        ('B4', 'B4', 'b4@example.test', now(), now()),
        ('B5', 'B5', 'b5@example.test', now(), now()),
        ('B6', 'B6', 'b6@example.test', now(), now()),
        ('B7', 'B7', 'b7@example.test', now(), now());
      -- Cohort A: Google integration + no nutrition_preference row -> fitbit
      INSERT INTO health_integration (user_id, provider, credential) VALUES ('B1', 'google', 'tok-a');
      -- Cohort B: Google integration + explicit manual preference -> stays manual
      INSERT INTO health_integration (user_id, provider, credential) VALUES ('B2', 'google', 'tok-b');
      INSERT INTO nutrition_preference (user_id, timezone, preferred_energy_source) VALUES
        ('B2', 'Europe/London', 'manual'),
        ('B3', 'Europe/London', 'google'),
        ('B4', 'Europe/London', 'google'),
        ('B5', 'Europe/London', 'google'),
        ('B6', 'Europe/London', 'manual');
      -- Cohort C: No integration, preferred_energy_source = google + google daily_energy / daily_sleep -> fitbit
      INSERT INTO daily_energy (user_id, day, source, total_kcal) VALUES ('B3', '2026-11-17', 'google', 2200);
      INSERT INTO daily_sleep (user_id, day, source, minutes_asleep) VALUES ('B4', '2026-11-17', 'google', 420);
      -- Cohort D (B5): No integration, legacy preferred_energy_source = google + no google rows -> manual + synced preferred_energy_source = manual
      -- Cohort E (B6): Explicit manual, no integration -> manual
      -- Cohort F (B7): No preference row, no integration -> manual
    `);

    const sql012 = await readFile(`migrations/${m012}`, "utf8");
    await freshPg.exec(sql012);
    // Re-run 012 to verify idempotency
    await freshPg.exec(sql012);
    for (const m of post012) {
      await freshPg.exec(await readFile(`migrations/${m}`, "utf8"));
    }

    const freshDb = drizzle(freshPg, { schema });
    const b1 = nutritionData(freshDb, "B1");
    const b2 = nutritionData(freshDb, "B2");
    const b3 = nutritionData(freshDb, "B3");
    const b4 = nutritionData(freshDb, "B4");
    const b5 = nutritionData(freshDb, "B5");
    const b6 = nutritionData(freshDb, "B6");
    const b7 = nutritionData(freshDb, "B7");

    assert.equal((await b1.settings()).trackingMode, "fitbit");
    assert.equal((await b1.settings()).preferredEnergySource, "google");
    assert.equal((await b2.settings()).trackingMode, "manual");
    assert.equal((await b2.settings()).preferredEnergySource, "manual");
    assert.equal((await b3.settings()).trackingMode, "fitbit");
    assert.equal((await b4.settings()).trackingMode, "fitbit");
    assert.equal((await b5.settings()).trackingMode, "manual");
    assert.equal((await b5.settings()).preferredEnergySource, "manual");
    assert.equal((await b6.settings()).trackingMode, "manual");
    assert.equal((await b7.settings()).trackingMode, "manual");

    // Verify DB columns for Cohort D (B5) and Cohort B (B2) have zero desync
    const rawRows = await freshPg.query<{ user_id: string; tracking_mode: string; preferred_energy_source: string }>(
      `SELECT user_id, tracking_mode, preferred_energy_source FROM nutrition_preference ORDER BY user_id`,
    );
    const byId = Object.fromEntries(rawRows.rows.map((r) => [r.user_id, r]));
    assert.deepEqual(
      { tracking_mode: byId.B1.tracking_mode, preferred_energy_source: byId.B1.preferred_energy_source },
      { tracking_mode: "fitbit", preferred_energy_source: "google" },
    );
    assert.deepEqual(
      { tracking_mode: byId.B2.tracking_mode, preferred_energy_source: byId.B2.preferred_energy_source },
      { tracking_mode: "manual", preferred_energy_source: "manual" },
    );
    assert.deepEqual(
      { tracking_mode: byId.B5.tracking_mode, preferred_energy_source: byId.B5.preferred_energy_source },
      { tracking_mode: "manual", preferred_energy_source: "manual" },
    );

    // Toggle Cohort A (B1) to manual, re-run 012 directly, and confirm B1 remains manual
    await b1.setPreferences({ timezone: "Europe/London", trackingMode: "manual" });
    await freshPg.exec(sql012);
    assert.equal((await b1.settings()).trackingMode, "manual");
    assert.equal((await b1.settings()).preferredEnergySource, "manual");
    const b1Export = await b1.export();
    assert.equal(b1Export.preferences.trackingMode, "manual");
    assert.equal(b1Export.preferences.preferredEnergySource, "manual");
  } finally {
    await freshPg.close();
  }
});

test("log() defaults omitted day/time to exact current local clock while honoring explicit overrides", async () => {
  const u2 = nutritionData(db, "U2");
  const nowBefore = new Date();
  const autoMeal = await u2.log({
    name: "Midnight tea & toast",
    category: "snacks",
    items: [{ name: "Toast", amount: 60, unit: "g", calories: 160, proteinG: 5, carbsG: 30, fatG: 2, fibreG: 2 }],
  });
  const nowAfter = new Date();
  const expectedDayBefore = localDay(nowBefore, "Europe/London");
  const expectedDayAfter = localDay(nowAfter, "Europe/London");
  assert.ok(autoMeal.meal.localDay === expectedDayBefore || autoMeal.meal.localDay === expectedDayAfter);

  const overrideMeal = await u2.log({
    day: "2026-11-24",
    time: "00:35",
    name: "Explicit post-midnight snack",
    category: "snacks",
    items: [{ name: "Banana", amount: 110, unit: "g", calories: 98, proteinG: 1.2, carbsG: 25, fatG: 0.3, fibreG: 2.8 }],
  });
  assert.equal(overrideMeal.meal.localDay, "2026-11-24");
  assert.equal(overrideMeal.meal.localTime, "00:35");
});

test("isCalorieGoalMet and bulkMode preference invert under/over target evaluation cleanly", async () => {
  const { isCalorieGoalMet } = await import("../lib/nutrition-model");
  assert.equal(isCalorieGoalMet(null, 2000, false), null);
  assert.equal(isCalorieGoalMet(null, 2000, true), null);

  // Cut / Deficit mode (bulkMode = false): under/at target = true (green), over target = false (red)
  assert.equal(isCalorieGoalMet(1750, 2000, false), true);
  assert.equal(isCalorieGoalMet(2000, 2000, false), true);
  assert.equal(isCalorieGoalMet(2150, 2000, false), false);

  // Bulk mode (bulkMode = true): under target = false (red), at/over target = true (green)
  assert.equal(isCalorieGoalMet(1750, 2000, true), false);
  assert.equal(isCalorieGoalMet(2000, 2000, true), true);
  assert.equal(isCalorieGoalMet(2350, 2000, true), true);

  const u2 = nutritionData(db, "U2");
  assert.equal((await u2.settings()).bulkMode, false);
  const tokBefore = await u2.syncToken();
  const updated = await u2.setPreferences({ timezone: "Europe/London", bulkMode: true });
  assert.equal(updated.bulkMode, true);
  const tokAfter = await u2.syncToken();
  assert.notEqual(tokAfter, tokBefore);
  await u2.setPreferences({ timezone: "Europe/London", bulkMode: false });
  assert.equal((await u2.settings()).bulkMode, false);
});


