import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { nutritionData } from "../lib/nutrition-data";
import { addDays, localDay, localTime, resolveActiveHomeDay, resolveLocalDateTime } from "../lib/nutrition-model";
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
  // Mark 2026-11-17 complete with manual TDEE 2365 -> deficit 2365 - 665 = 1700.
  // Leave 2026-11-18 incomplete (diaryComplete: false) and 2026-11-19 unlogged (null intake).
  await u1.saveEnergy({ day: "2026-11-17", source: "manual", totalKcal: 2365, activeKcal: 450, steps: 9100, complete: true });
  await u1.saveEnergy({ day: "2026-11-18", source: "manual", totalKcal: 2400, activeKcal: 500, steps: 9500, complete: true });
  await u1.saveEnergy({ day: "2026-11-19", source: "manual", totalKcal: 2400, complete: true });
  await u1.markDay("2026-11-17", true);

  const hist = await u1.history("2026-11-17", "2026-11-19");
  assert.equal(hist.totalDays, 3);
  assert.equal(hist.completeNutritionDays, 1);
  assert.equal(hist.comparableDays, 1);
  assert.equal(hist.cumulativeDeficit, 1700);
  assert.equal(hist.averages.calories, 665);
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

test("resolveActiveHomeDay and homeSnapshot gate rollover strictly on Fitbit sleep when enabled", async () => {
  // Pure model logic
  assert.deepEqual(
    resolveActiveHomeDay({
      calendarToday: "2026-11-25",
      hasFitbitSleep: false,
      sleepRolloverEnabled: true,
      sleepDates: new Set(),
    }),
    { activeDay: "2026-11-25", waitingForSleep: false },
  );
  assert.deepEqual(
    resolveActiveHomeDay({
      calendarToday: "2026-11-25",
      hasFitbitSleep: true,
      sleepRolloverEnabled: true,
      sleepDates: new Set(["2026-11-24"]),
    }),
    { activeDay: "2026-11-24", waitingForSleep: true },
  );
  assert.deepEqual(
    resolveActiveHomeDay({
      calendarToday: "2026-11-25",
      hasFitbitSleep: true,
      sleepRolloverEnabled: true,
      sleepDates: new Set(["2026-11-24", "2026-11-25"]),
    }),
    { activeDay: "2026-11-25", waitingForSleep: false },
  );
  assert.deepEqual(
    resolveActiveHomeDay({
      calendarToday: "2026-11-25",
      hasFitbitSleep: true,
      sleepRolloverEnabled: false,
      sleepDates: new Set(["2026-11-24"]),
    }),
    { activeDay: "2026-11-25", waitingForSleep: false },
  );

  // DB-backed homeSnapshot integration
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

  await u3.log({
    day: yesterday,
    time: "23:45",
    name: "Late yoghurt",
    category: "snacks",
    items: [{ name: "Greek yoghurt", amount: 150, unit: "g", calories: 140, proteinG: 15, carbsG: 6, fatG: 5, estimationMethod: "weighed" }],
  });

  // Without Fitbit sleep capability -> lands directly on calendarToday and hides sleep
  const nonFitbit = await u3.homeSnapshot(today, { canReadSleep: false });
  assert.equal(nonFitbit.activeDay, today);
  assert.equal(nonFitbit.waitingForSleep, false);
  assert.equal(nonFitbit.showSleep, false);

  // With Fitbit sleep capability before sleep is recorded -> holds on yesterday
  const waiting = await u3.homeSnapshot(today, { canReadSleep: true });
  assert.equal(waiting.activeDay, yesterday);
  assert.equal(waiting.waitingForSleep, true);
  assert.equal(waiting.showSleep, true);
  assert.equal(waiting.daily.meals.length, 1);

  // Once wake-day sleep arrives -> advances to calendarToday and attaches sleepStages
  await u3.importHealthRecords({
    sleepEntries: [
      {
        day: today,
        source: "google",
        sleepStart: "2026-11-25T00:15:00.000Z",
        sleepEnd: "2026-11-25T07:35:00.000Z",
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
  });
  const woken = await u3.homeSnapshot(today, { canReadSleep: true });
  assert.equal(woken.activeDay, today);
  assert.equal(woken.waitingForSleep, false);
  assert.equal(woken.daily.sleep?.minutesAsleep, 410);
  assert.equal(woken.daily.sleep?.deepMinutes, 85);
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

