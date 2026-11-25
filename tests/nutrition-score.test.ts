import assert from "node:assert/strict";
import test from "node:test";
import { classifyFoodQuality, scoreDayNutrition, scoreMealNutrition } from "../lib/nutrition-score";
import type { ScoreableItem, ScoreableMeal } from "../lib/nutrition-score";
import type { NutrientSummary } from "../lib/nutrition-model";

const targets = { calories: 2200, proteinG: 150, carbsG: 250, fatG: 70, fibreG: 30 };
const unknownTotals: NutrientSummary = { calories: null, proteinG: null, carbsG: null, fatG: null, fibreG: null, calMin: null, calMax: null, hasUnknownValues: true };
const broccoli: ScoreableItem = { name: "Broccoli", calories: 100, proteinG: 8, carbsG: 12, fatG: 1, fibreG: 6, gramWeight: 250 };
const meal = (items: ScoreableItem[]): ScoreableMeal => ({ name: "Test", items });

test("quality weighting uses known calories only and never substitutes grams or a minimum weight", () => {
  const baseline = scoreMealNutrition(meal([broccoli]));
  const unknown = { name: "Chocolate", calories: null, gramWeight: 10000, fibreG: 0, proteinG: 0 };
  const partial = scoreMealNutrition(meal([broccoli, unknown]));
  assert.equal(partial.novaAvg, baseline.novaAvg);
  assert.equal(partial.unknownCalorieCount, 1);
  assert.equal(partial.coverage, "partial");
  const missing = scoreMealNutrition(meal([unknown]));
  assert.equal(missing.score, null);
  assert.equal(missing.novaAvg, null);
  assert.equal(scoreMealNutrition(meal([{ ...unknown, calories: 0 }])).score, null);
});

test("unweighed portions, drinks and recipes never manufacture ingredient grams", () => {
  for (const item of [
    { ...broccoli, gramWeight: undefined },
    { ...broccoli, gramWeight: undefined, millilitreVolume: 1000 },
    { ...broccoli, ingredients: "broccoli, oil, chicken", estimationMethod: "recipe" as const },
  ]) assert.equal(classifyFoodQuality(item).signals.vegGrams, 0);
  assert.equal(classifyFoodQuality(broccoli).signals.vegGrams, 250);
});

test("partial nutrients never become complete totals or receive partial-sum boosts", () => {
  const items = [broccoli, { name: "Unknown side", calories: 200, proteinG: null, fibreG: null }];
  const result = scoreMealNutrition({ ...meal(items), totals: { ...unknownTotals, proteinG: 150, fibreG: 30 } });
  assert.equal(result.fibreG, null);
  assert.equal(result.unknownFibreCount, 1);
  const daily = scoreDayNutrition([meal(items)], { ...unknownTotals, calories: 300, proteinG: 150, fibreG: 30 }, 2200, targets);
  assert.equal(daily.fibreG, null);
  assert.equal(daily.fibreSubscore, null);
  assert.equal(daily.proteinSubscore, null);
  assert.equal(daily.carbToFibreRatio, null);
  assert.equal(daily.coverage, "partial");
  assert.equal(daily.contributors.some((c) => c.key === "fibre" || c.key === "protein"), false);
});

test("unknown fibre cannot be assumed low fibre for an inferred sugar penalty", () => {
  const unknown = classifyFoodQuality({ name: "Orange juice", calories: 100, carbsG: 20, fibreG: null });
  const known = classifyFoodQuality({ name: "Orange juice", calories: 100, carbsG: 20, fibreG: 0 });
  assert.equal(unknown.signals.sugarRiskCalories, 0);
  assert.equal(known.signals.sugarRiskCalories, 100);
});

test("daily classified kcal shares have a consistent denominator and no unknown calorie score", () => {
  const a = scoreDayNutrition([meal([broccoli, { name: "Cola", calories: 100, fibreG: 0, proteinG: 0, carbsG: 25, fatG: 0 }])], { ...unknownTotals, calories: 10000 }, 2200, targets);
  assert.equal(a.ultraProcessedPct, 50);
  assert.equal(a.wholeFoodPct, 50);
  const unknown = scoreDayNutrition([meal([{ name: "Broccoli", gramWeight: 100, proteinG: 5, fibreG: 3 }])], unknownTotals, 2200, targets);
  assert.equal(unknown.score, null);
  assert.equal(unknown.qualitySubscore, null);
  assert.equal(unknown.ultraProcessedPct, null);
  assert.equal(unknown.balanceSubscore, null);
});

test("heuristic classifications and missing metadata are explicit even with complete macros", () => {
  const result = scoreDayNutrition([meal([broccoli])], unknownTotals, 2200, targets);
  assert.equal(result.algorithmVersion, "nutrition-quality-v2-heuristic");
  assert.equal(result.missingMetadataCount, 1);
  assert.equal(result.coverage, "partial");
  assert.equal(classifyFoodQuality(broccoli).classificationSource, "heuristic");
  const metadata = { ...broccoli, foodSnapshot: { qualityMeta: { novaGroup: 1 as const } } };
  assert.equal(classifyFoodQuality(metadata).classificationSource, "metadata");
  assert.equal(scoreDayNutrition([meal([metadata])], unknownTotals, 2200, targets).coverage, "early");
});
