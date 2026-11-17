import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { nutritionData } from "../lib/nutrition-data";
import { localDay, localTime, resolveLocalDateTime } from "../lib/nutrition-model";
import { parseOpenFoodFactsProduct, searchUkStaples } from "../lib/uk-foods";
import * as schema from "../lib/schema";

const pg = new PGlite();
const db = drizzle(pg, { schema });

before(async () => {
  for (const migration of [
    "001-auth.sql",
    "002-tracker.sql",
    "003-preserve-owner-access.sql",
    "004-nutrition-health.sql",
    "005-mcp-oauth.sql",
  ]) {
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
