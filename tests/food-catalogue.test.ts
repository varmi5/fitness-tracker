import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { catalogueById, catalogueCount, searchCatalogue } from "../lib/food-catalogue";
import { calculateFoodPortion, foodToSavedInput } from "../lib/food-catalogue-model";
import { parseBrandedFood, searchBrandedFoods } from "../lib/branded-foods";
import { nutritionData } from "../lib/nutrition-data";
import { mealItemInput } from "../lib/nutrition-model";
import * as schema from "../lib/schema";
const pg = new PGlite(); const db = drizzle(pg, { schema });
before(async () => {
  for (const file of (await readdir("migrations")).filter((name) => name.endsWith(".sql")).sort()) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  for (const id of ["FOOD-A", "FOOD-B"]) await db.insert(schema.user).values({ id, name: id, email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() });
});
after(() => pg.close());
test("full UK catalogue and count portions scale without inventing unknown nutrients", () => {
  assert.equal(catalogueCount, 2887);
  assert.ok(searchCatalogue("chicken").length > 5);
  const egg = catalogueById("cofid:12-940")!;
  const one = calculateFoodPortion(egg, "egg-large", 1);
  const two = calculateFoodPortion(egg, "egg-large", 2);
  assert.equal(one.unit, "item"); assert.equal(one.amount, 1); assert.equal(one.gramWeight, 60);
  assert.equal(one.calories, 85.8); assert.equal(two.calories, 171.6); assert.equal(two.gramWeight, 120);
  assert.equal(one.estimationMethod, "standard_portion");
  assert.equal(mealItemInput.safeParse(two).success, true);
  assert.equal(egg.portions.some((portion) => portion.unit === "ml"), false);
});
test("drinks use explicit volumes, cups and spoon sizes; CoFID density conversions are labelled", () => {
  const milk = catalogueById("cofid:12-313")!;
  const glass = calculateFoodPortion(milk, "ml", 250);
  assert.equal(milk.foodType, "drink"); assert.equal(glass.millilitreVolume, 250);
  assert.ok(glass.gramWeight! >= 250);
  assert.equal(calculateFoodPortion(milk, "cup", 1).millilitreVolume, 250);
});
const rawProduct = { code: "1234567890123", product_name: "Oat drink", brands: ["Alpro"], quantity: "1l", serving_size: "250ml", serving_quantity: 250, serving_quantity_unit: "ml", nutriments: { "energy-kcal_100g": 40, proteins_100g: .2, carbohydrates_100g: 6, fat_100g: 1.5 } };
test("branded drinks recognise compact ml/l units, label servings and whole packs", () => {
  const product = parseBrandedFood(rawProduct)!;
  assert.equal(product.brand, "Alpro"); assert.equal(product.basisUnit, "ml");
  assert.equal(calculateFoodPortion(product, "label-serving", 1).calories, 100);
  assert.equal(calculateFoodPortion(product, "pack", 1).calories, 400);
  assert.equal(product.fibreG, null);
  const perServing = parseBrandedFood({ ...rawProduct, nutriments: { "energy-kcal_serving": 100 } })!;
  assert.equal(perServing.calories, 40);
  assert.equal(parseBrandedFood({ ...rawProduct, nutriments: { "energy-kcal": 100 } }), null);
});
test("custom foods, favourites, portion snapshots and edits stay isolated per user", async () => {
  const a = nutritionData(db, "FOOD-A"), b = nutritionData(db, "FOOD-B");
  const egg = catalogueById("cofid:12-940")!;
  const saved = await a.saveTemplate(foodToSavedInput(egg, true));
  assert.equal((await a.saveTemplate(foodToSavedInput(egg, true))).id, saved.id);
  assert.equal(saved.isFavourite, true);
  await assert.rejects(() => b.favourite(saved.id, false), /not found/i);
  assert.equal((await b.library("eggs")).saved.length, 0);
  const custom = await b.saveTemplate({ name: "My one-egg breakfast", defaultAmount: 1, defaultUnit: "item", calories: 80, isFavourite: true });
  assert.equal(custom.defaultUnit, "item"); assert.equal(custom.calories, 80);
  const item = calculateFoodPortion(egg, "egg-large", 2);
  const logged = await a.log({ day: "2026-11-17", time: "08:00", name: "Two eggs", category: "breakfast", items: [{ ...item, calories: 1, savedFoodId: saved.id }] });
  // Recalculate from the explicit snapshot/measure on the server, not client totals.
  assert.equal(logged.meal.totals.calories, 171.6);
  assert.equal(logged.meal.items[0].portionLabel, "Large egg (~60 g edible)");
  const edited = await a.update({ id: logged.meal.id, items: [calculateFoodPortion(egg, "egg-medium", 1)] });
  assert.equal(edited.meal.totals.calories, 71.5);
  await a.removeTemplate(saved.id);
  assert.equal((await a.daily("2026-11-17")).meals[0].items[0].foodSnapshot?.id, egg.id);
  assert.equal((await b.daily("2026-11-17")).meals.length, 0);
});
test("branded search uses full text/brand query, caches public results and skips invalid rows", async () => {
  const original = globalThis.fetch; let requests = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests++; const url = new URL(String(input)); assert.equal(url.hostname, "search.openfoodfacts.org");
    assert.equal(url.searchParams.get("q"), "Alpro oats");
    return Response.json({ hits: [rawProduct, { code: "invalid" }] });
  }) as typeof fetch;
  try {
    const first = await searchBrandedFoods(db, "FOOD-A", "Alpro oats");
    const second = await searchBrandedFoods(db, "FOOD-B", "Alpro oats");
    assert.equal(first.length, 1); assert.deepEqual(second, first); assert.equal(requests, 1);
    const row = (await db.select().from(schema.foodProviderCache))[0];
    assert.equal(row.key.includes("Alpro"), false);
  } finally { globalThis.fetch = original; }
});
