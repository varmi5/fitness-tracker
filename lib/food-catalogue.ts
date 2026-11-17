import cofid from "../data/cofid-2021.json";
import { standardMeasures, type FoodDefinition, type FoodMeasure } from "./food-catalogue-model";
import { foodMatchScore } from "./search-match";

const sourceUrl = "https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid";
function named(id: string, label: string, unit: FoodMeasure["unit"], baseAmount: number, estimated = true): FoodMeasure {
  return { id, label, unit, baseAmount, defaultAmount: 1, estimated };
}
export function cofidFood(row: typeof cofid[number]): FoodDefinition {
  const name = row.name.toLowerCase();
  const alcoholic = row.group.startsWith("Q"); // CoFID alcohol is per 100 ml; other foods are per 100 g.
  const drink = alcoholic || (row.group.startsWith("P") || /^milk,|^water,/.test(name)) && !/powder|granules|dry|dried|leaves|beans|condensed/.test(name);
  const basisUnit = alcoholic ? "ml" : "g";
  const portions = standardMeasures(basisUnit);
  let defaultPortionId = basisUnit as string;
  if (drink && basisUnit === "g") {
    // CoFID's measured specific gravity takes precedence. Explicit approximate density otherwise.
    const density = row.density && row.density > .5 && row.density < 2 ? row.density : /^milk,/.test(name) ? 1.03 : 1;
    const approximate = !(row.density && row.density > .5 && row.density < 2);
    portions.push(...standardMeasures("ml").map((p) => ({ ...p, baseAmount: p.baseAmount * density, estimated: approximate, label: p.label + (approximate ? " (estimated)" : "") })));
    defaultPortionId = "cup";
  } else if (alcoholic) defaultPortionId = "ml";
  if (/^eggs, chicken, whole,/.test(name)) {
    portions.unshift(named("egg-large", "Large egg (~60 g edible)", "item", 60), named("egg-medium", "Medium egg (~50 g edible)", "item", 50), named("egg-small", "Small egg (~45 g edible)", "item", 45));
    defaultPortionId = "egg-large";
  } else if (/^bread,/.test(name)) { portions.unshift(named("slice", "Slice (~40 g)", "slice", 40)); defaultPortionId = "slice"; }
  else if (/^bananas?,/.test(name)) { portions.unshift(named("banana", "Medium banana (~120 g peeled)", "item", 120)); defaultPortionId = "banana"; }
  else if (/^apples?, eating/.test(name)) { portions.unshift(named("apple", "Medium apple (~150 g edible)", "item", 150)); defaultPortionId = "apple"; }
  return { id: `cofid:${row.code}`, name: row.name.slice(0, 160), brand: "", foodType: drink ? "drink" : "food", source: "UK CoFID", sourceUrl,
    basisAmount: 100, basisUnit, calories: row.calories, proteinG: row.proteinG, carbsG: row.carbsG, fatG: row.fatG, fibreG: row.fibreG, portions, defaultPortionId };
}
const index = cofid.map((row) => ({ row, search: row.name.toLowerCase() }));
export function searchCatalogue(query: string, limit = 16, type?: "food" | "drink") {
  if (!query.trim()) return [];
  return index.map(({ row, search }) => ({ row, score: foodMatchScore(search, query) }))
    .filter(({ score }) => Number.isFinite(score)).sort((a, b) => a.score - b.score || a.row.name.length - b.row.name.length)
    .map(({ row }) => cofidFood(row)).filter((food) => !type || food.foodType === type).slice(0, limit);
}
export function catalogueById(id: string) { const row = cofid.find((r) => `cofid:${r.code}` === id); return row ? cofidFood(row) : null; }
export const catalogueCount = cofid.length;
