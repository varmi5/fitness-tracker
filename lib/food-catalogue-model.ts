import type { z } from "zod";
import { foodSnapshotInput, type FoodUnit, type MealItemInput } from "./nutrition-model";

export type FoodDefinition = z.infer<typeof foodSnapshotInput>;
export type FoodMeasure = FoodDefinition["portions"][number];
export const UNIT_LABELS: Record<FoodUnit, string> = {
  g: "g", kg: "kg", oz: "oz", ml: "ml", l: "litres", tsp: "teaspoons (5 ml)", tbsp: "tablespoons (15 ml)",
  cup: "metric cups (250 ml)", fl_oz: "UK fl oz", item: "items", slice: "slices", piece: "pieces", scoop: "scoops",
  serving: "servings", bottle: "bottles", can: "cans", pack: "packs",
};
export function standardMeasures(unit: FoodUnit, amount = 100): FoodMeasure[] {
  const make = (id: FoodUnit, label: string, factor: number, quantity: number): FoodMeasure => ({ id, label, unit: id, baseAmount: factor, defaultAmount: quantity, estimated: false });
  if (unit === "g") return [make("g", "Grams", 1, amount), make("kg", "Kilograms", 1000, .1), make("oz", "Ounces", 28.349523125, 1)];
  if (unit === "ml") return [make("ml", "Millilitres", 1, amount), make("l", "Litres", 1000, .25), make("tsp", "Teaspoon (5 ml)", 5, 1), make("tbsp", "Tablespoon (15 ml)", 15, 1), make("cup", "Metric cup (250 ml)", 250, 1), make("fl_oz", "UK fluid ounce (28.4 ml)", 28.4130625, 1)];
  return [make(unit, UNIT_LABELS[unit], 1, amount)];
}
export function calculateFoodPortion(food: FoodDefinition, portionId: string, quantity: number): MealItemInput {
  const measure = food.portions.find((p) => p.id === portionId);
  if (!measure || !Number.isFinite(quantity) || quantity <= 0 || quantity > 20000) throw new Error("Choose a valid food portion and positive quantity.");
  const base = quantity * measure.baseAmount;
  const ratio = base / food.basisAmount;
  const scale = (v: number | null | undefined) => v == null ? null : Math.round(v * ratio * 10) / 10;
  const grams = food.basisUnit === "g" ? base : food.portions.find((p) => p.unit === "g" && p.id === "g")?.baseAmount;
  const ml = food.basisUnit === "ml" ? base : food.portions.find((p) => p.unit === "ml" && p.id === "ml")?.baseAmount;
  return {
    name: food.brand && !food.name.toLowerCase().includes(food.brand.toLowerCase()) ? `${food.brand} ${food.name}`.slice(0, 160) : food.name,
    amount: quantity, unit: measure.unit, calories: scale(food.calories), proteinG: scale(food.proteinG), carbsG: scale(food.carbsG),
    fatG: scale(food.fatG), fibreG: scale(food.fibreG),
    estimationMethod: food.source === "Saved recipe" ? "recipe" : measure.estimated ? "standard_portion" : food.source === "Open Food Facts" ? "pack_label" : measure.unit === "g" || measure.unit === "kg" || measure.unit === "oz" ? "weighed" : "measured",
    portionId, portionLabel: measure.label,
    gramWeight: food.basisUnit === "g" ? grams : grams ? base / grams : null,
    millilitreVolume: food.basisUnit === "ml" ? ml : ml ? base / ml : null,
    foodSnapshot: food,
  };
}

export function foodToSavedInput(food: FoodDefinition, favourite: boolean) {
  return { kind: "food" as const, name: food.name, brand: food.brand, defaultAmount: food.basisAmount, defaultUnit: food.basisUnit,
    foodType: food.foodType, calories: food.calories, proteinG: food.proteinG, carbsG: food.carbsG, fatG: food.fatG, fibreG: food.fibreG,
    portionsJson: food.portions, defaultPortionId: food.defaultPortionId, sourceName: food.source, sourceId: food.id, sourceUrl: food.sourceUrl,
    isFavourite: favourite };
}
