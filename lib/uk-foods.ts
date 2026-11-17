import { foodMatchScore } from "./search-match";

export interface UkStapleFood {
  id: string;
  name: string;
  preparation: string;
  defaultAmount: number;
  defaultUnit: "g" | "ml" | "serving";
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fibreG: number | null;
  sourceLabel: "UK CoFID";
}

// Curated everyday UK staples aligned with UK CoFID reference values (per 100g / 100ml or standard UK unit).
// Unknown fibre stays null rather than 0 where CoFID lists trace/not applicable.
export const UK_STAPLES: UkStapleFood[] = [
  { id: "cofid-egg-large-boiled", name: "Chicken eggs, whole, boiled", preparation: "per 100g (approx. 1.7 large UK eggs)", defaultAmount: 100, defaultUnit: "g", calories: 143, proteinG: 12.6, carbsG: 1.1, fatG: 9.7, fibreG: null, sourceLabel: "UK CoFID" },
  { id: "cofid-egg-large-scrambled", name: "Chicken eggs, scrambled (no added fat)", preparation: "per 100g", defaultAmount: 100, defaultUnit: "g", calories: 147, proteinG: 12.5, carbsG: 1.2, fatG: 10.1, fibreG: null, sourceLabel: "UK CoFID" },
  { id: "cofid-chicken-breast-grilled", name: "Chicken breast, skinless, grilled", preparation: "cooked weight, per 100g", defaultAmount: 100, defaultUnit: "g", calories: 151, proteinG: 31.0, carbsG: 0, fatG: 2.9, fibreG: null, sourceLabel: "UK CoFID" },
  { id: "cofid-chicken-thigh-roasted", name: "Chicken thigh, boneless, skinless, roasted", preparation: "cooked weight, per 100g", defaultAmount: 100, defaultUnit: "g", calories: 179, proteinG: 25.8, carbsG: 0, fatG: 8.3, fibreG: null, sourceLabel: "UK CoFID" },
  { id: "cofid-salmon-baked", name: "Salmon fillet, baked", preparation: "cooked weight, per 100g", defaultAmount: 100, defaultUnit: "g", calories: 231, proteinG: 24.1, carbsG: 0, fatG: 14.9, fibreG: null, sourceLabel: "UK CoFID" },
  { id: "cofid-tuna-tinned-brine", name: "Tuna, canned in brine, drained", preparation: "drained weight, per 100g", defaultAmount: 100, defaultUnit: "g", calories: 109, proteinG: 24.9, carbsG: 0, fatG: 1.0, fibreG: null, sourceLabel: "UK CoFID" },
  { id: "cofid-basmati-rice-boiled", name: "Basmati rice, white, boiled", preparation: "cooked weight, per 100g", defaultAmount: 100, defaultUnit: "g", calories: 121, proteinG: 2.8, carbsG: 27.6, fatG: 0.3, fibreG: 0.5, sourceLabel: "UK CoFID" },
  { id: "cofid-basmati-rice-raw", name: "Basmati rice, white, dry", preparation: "uncooked weight, per 100g", defaultAmount: 100, defaultUnit: "g", calories: 356, proteinG: 8.1, carbsG: 80.5, fatG: 0.9, fibreG: 1.5, sourceLabel: "UK CoFID" },
  { id: "cofid-oats-rolled", name: "Porridge oats, dry", preparation: "uncooked weight, per 100g", defaultAmount: 100, defaultUnit: "g", calories: 374, proteinG: 11.2, carbsG: 62.6, fatG: 7.6, fibreG: 9.0, sourceLabel: "UK CoFID" },
  { id: "cofid-sourdough", name: "Sourdough bread", preparation: "per 100g", defaultAmount: 100, defaultUnit: "g", calories: 232, proteinG: 8.3, carbsG: 46.1, fatG: 1.2, fibreG: 2.8, sourceLabel: "UK CoFID" },
  { id: "cofid-wholemeal-bread", name: "Wholemeal bread, sliced", preparation: "per 100g", defaultAmount: 100, defaultUnit: "g", calories: 217, proteinG: 9.4, carbsG: 40.2, fatG: 2.2, fibreG: 7.0, sourceLabel: "UK CoFID" },
  { id: "cofid-milk-semi-skimmed", name: "Milk, semi-skimmed", preparation: "per 100ml", defaultAmount: 100, defaultUnit: "ml", calories: 47, proteinG: 3.5, carbsG: 4.8, fatG: 1.7, fibreG: null, sourceLabel: "UK CoFID" },
  { id: "cofid-greek-yogurt-0", name: "Greek style yogurt, fat free", preparation: "per 100g", defaultAmount: 100, defaultUnit: "g", calories: 56, proteinG: 9.8, carbsG: 3.8, fatG: 0.2, fibreG: null, sourceLabel: "UK CoFID" },
  { id: "cofid-cheddar", name: "Cheddar cheese", preparation: "per 100g", defaultAmount: 100, defaultUnit: "g", calories: 416, proteinG: 25.4, carbsG: 0.1, fatG: 34.9, fibreG: null, sourceLabel: "UK CoFID" },
  { id: "cofid-cottage-cheese", name: "Cottage cheese, plain", preparation: "per 100g", defaultAmount: 100, defaultUnit: "g", calories: 98, proteinG: 12.6, carbsG: 2.4, fatG: 4.3, fibreG: null, sourceLabel: "UK CoFID" },
  { id: "cofid-red-lentils-boiled", name: "Red lentils (dhal base), boiled", preparation: "cooked weight, per 100g", defaultAmount: 100, defaultUnit: "g", calories: 105, proteinG: 7.6, carbsG: 17.5, fatG: 0.4, fibreG: 3.9, sourceLabel: "UK CoFID" },
  { id: "cofid-chickpeas-tinned", name: "Chickpeas, canned, drained", preparation: "drained weight, per 100g", defaultAmount: 100, defaultUnit: "g", calories: 121, proteinG: 7.2, carbsG: 17.2, fatG: 2.3, fibreG: 5.8, sourceLabel: "UK CoFID" },
  { id: "cofid-potatoes-boiled", name: "Potatoes, new/maincrop, boiled", preparation: "cooked weight, per 100g", defaultAmount: 100, defaultUnit: "g", calories: 74, proteinG: 1.8, carbsG: 17.0, fatG: 0.1, fibreG: 1.5, sourceLabel: "UK CoFID" },
  { id: "cofid-broccoli-steamed", name: "Broccoli, green, steamed", preparation: "cooked weight, per 100g", defaultAmount: 100, defaultUnit: "g", calories: 36, proteinG: 3.3, carbsG: 3.1, fatG: 0.7, fibreG: 3.0, sourceLabel: "UK CoFID" },
  { id: "cofid-banana", name: "Banana, flesh only", preparation: "peeled weight, per 100g", defaultAmount: 100, defaultUnit: "g", calories: 81, proteinG: 1.2, carbsG: 19.6, fatG: 0.1, fibreG: 1.4, sourceLabel: "UK CoFID" },
  { id: "cofid-apple", name: "Apple, eating, raw with skin", preparation: "per 100g", defaultAmount: 100, defaultUnit: "g", calories: 51, proteinG: 0.5, carbsG: 11.6, fatG: 0.2, fibreG: 1.8, sourceLabel: "UK CoFID" },
  { id: "cofid-blueberries", name: "Blueberries, raw", preparation: "per 100g", defaultAmount: 100, defaultUnit: "g", calories: 40, proteinG: 0.9, carbsG: 9.1, fatG: 0.2, fibreG: 2.4, sourceLabel: "UK CoFID" },
  { id: "cofid-olive-oil", name: "Olive oil", preparation: "per 100ml (~15ml = 1 tbsp)", defaultAmount: 100, defaultUnit: "ml", calories: 824, proteinG: 0, carbsG: 0, fatG: 91.6, fibreG: null, sourceLabel: "UK CoFID" },
  { id: "cofid-butter", name: "Butter, salted", preparation: "per 100g", defaultAmount: 100, defaultUnit: "g", calories: 745, proteinG: 0.6, carbsG: 0.6, fatG: 82.2, fibreG: null, sourceLabel: "UK CoFID" },
  { id: "cofid-peanut-butter", name: "Peanut butter, smooth, unsalted", preparation: "per 100g", defaultAmount: 100, defaultUnit: "g", calories: 612, proteinG: 26.1, carbsG: 11.6, fatG: 50.4, fibreG: 6.5, sourceLabel: "UK CoFID" },
  { id: "cofid-almonds", name: "Almonds, whole", preparation: "per 100g", defaultAmount: 100, defaultUnit: "g", calories: 612, proteinG: 21.1, carbsG: 6.9, fatG: 55.8, fibreG: 10.4, sourceLabel: "UK CoFID" },
  { id: "cofid-whey-isolate", name: "Whey protein powder (unflavoured/typical)", preparation: "per 100g dry powder", defaultAmount: 100, defaultUnit: "g", calories: 380, proteinG: 80.0, carbsG: 6.0, fatG: 3.5, fibreG: null, sourceLabel: "UK CoFID" },
  { id: "cofid-tofu-firm", name: "Tofu, firm, steamed/plain", preparation: "per 100g", defaultAmount: 100, defaultUnit: "g", calories: 112, proteinG: 12.1, carbsG: 1.5, fatG: 6.5, fibreG: 1.2, sourceLabel: "UK CoFID" },
  { id: "cofid-paneer", name: "Paneer cheese", preparation: "per 100g", defaultAmount: 100, defaultUnit: "g", calories: 318, proteinG: 18.8, carbsG: 2.2, fatG: 26.0, fibreG: null, sourceLabel: "UK CoFID" },
  { id: "cofid-avocado", name: "Avocado, flesh only", preparation: "per 100g", defaultAmount: 100, defaultUnit: "g", calories: 190, proteinG: 1.9, carbsG: 1.9, fatG: 19.5, fibreG: 3.4, sourceLabel: "UK CoFID" },
];

export function searchUkStaples(query: string, limit = 10): UkStapleFood[] {
  const q = query.trim().toLowerCase();
  if (!q) return UK_STAPLES.slice(0, limit);
  return UK_STAPLES.map((item) => ({ item, score: foodMatchScore(`${item.name} ${item.preparation}`, q) }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score).slice(0, limit).map(({ item }) => item);
}

export interface BarcodeProduct {
  barcode: string;
  name: string;
  brand: string;
  servingSizeLabel: string | null;
  basisAmount: number;
  basisUnit: "g" | "ml";
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fibreG: number | null;
  source: "Open Food Facts";
}

function numOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value * 10) / 10;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.round(parsed * 10) / 10;
  }
  return null;
}

export function parseOpenFoodFactsProduct(barcode: string, payload: unknown): BarcodeProduct | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as { status?: number; product?: Record<string, unknown> };
  if (record.status !== 1 || !record.product) return null;
  const p = record.product;
  const n = (p.nutriments && typeof p.nutriments === "object" ? p.nutriments : {}) as Record<string, unknown>;
  const name = typeof p.product_name === "string" && p.product_name.trim()
    ? p.product_name.trim()
    : typeof p.generic_name === "string" && p.generic_name.trim()
      ? p.generic_name.trim()
      : "Packaged food";
  const brand = typeof p.brands === "string" ? p.brands.split(",")[0]?.trim() ?? "" : "";
  const quantity = typeof p.quantity === "string" ? p.quantity.toLowerCase() : "";
  const basisUnit: "g" | "ml" = /\bml\b|\bl\b/.test(quantity) ? "ml" : "g";
  return {
    barcode,
    name: brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name,
    brand,
    servingSizeLabel: typeof p.serving_size === "string" && p.serving_size.trim() ? p.serving_size.trim() : null,
    basisAmount: 100,
    basisUnit,
    calories: numOrNull(n["energy-kcal_100g"] ?? n["energy-kcal"]),
    proteinG: numOrNull(n["proteins_100g"] ?? n["proteins"]),
    carbsG: numOrNull(n["carbohydrates_100g"] ?? n["carbohydrates"]),
    fatG: numOrNull(n["fat_100g"] ?? n["fat"]),
    fibreG: numOrNull(n["fiber_100g"] ?? n["fiber"]),
    source: "Open Food Facts",
  };
}
