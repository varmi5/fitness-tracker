import { createHash } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { z } from "zod";
import type { AuthDatabase } from "./auth";
import { foodProviderCache, foodProviderRate } from "./schema";
import { foodSnapshotInput } from "./nutrition-model";
import { standardMeasures, type FoodDefinition } from "./food-catalogue-model";

const agent = "FitnessTrackr/1.1 (https://fitness.hadamardsecurities.com)";
const fields = "code,product_name,product_name_en,generic_name,brands,quantity,serving_size,serving_quantity,serving_quantity_unit,nutriments,nutrition_data_per,categories_tags,nutriscore_score,nutriscore_grade,nova_group,ingredients_text_en,ingredients_text";
const inflight = new Map<string, Promise<FoodDefinition[]>>();
export class FoodProviderError extends Error { constructor(message: string, public status = 502) { super(message); } }
const value = (v: unknown) => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN; return Number.isFinite(n) && n >= 0 && n <= 50000 ? n : null; };

export function parseBrandedFood(raw: unknown): FoodDefinition | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const code = String(p.code ?? "");
  if (!/^\d{8,14}$/.test(code)) return null;
  const name = [p.product_name_en, p.product_name, p.generic_name].find((v) => typeof v === "string" && v.trim()) as string | undefined;
  if (!name) return null;
  const n = p.nutriments && typeof p.nutriments === "object" ? p.nutriments as Record<string, unknown> : {};
  const brand = (Array.isArray(p.brands) ? p.brands.join(", ") : typeof p.brands === "string" ? p.brands : "").slice(0, 120);
  const quantity = typeof p.quantity === "string" ? p.quantity.toLowerCase() : "";
  const serving = typeof p.serving_size === "string" ? p.serving_size : "";
  const servingText = /([\d.]+)\s*(ml|g)\b/i.exec(serving);
  const servingQuantity = value(p.serving_quantity) ?? (servingText ? value(servingText[1]) : null);
  const servingUnit = String(p.serving_quantity_unit ?? servingText?.[2] ?? "").toLowerCase();
  const liquid = servingUnit === "ml" || /\d\s*(?:ml|cl|l)\b/i.test(quantity) || p.nutrition_data_per === "100ml";
  const unit = liquid ? "ml" : "g";
  const nutrient = (key: string) => {
    const direct = value(n[`${key}_100g`]);
    if (direct != null) return Math.round(direct * 10) / 10;
    const perServing = value(n[`${key}_serving`]);
    if (perServing != null && servingQuantity && servingUnit === unit) return Math.round(perServing / servingQuantity * 1000) / 10;
    return null;
  };
  const calories = nutrient("energy-kcal") ?? (nutrient("energy-kj") == null ? null : Math.round(nutrient("energy-kj")! / 4.184 * 10) / 10);
  if (calories == null && ["proteins", "carbohydrates", "fat"].every((key) => nutrient(key) == null)) return null;
  const portions = standardMeasures(unit);
  let defaultPortionId: string = unit;
  if (servingQuantity && servingQuantity > 0 && servingUnit === unit) {
    portions.unshift({ id: "label-serving", label: (serving || `Label serving (${servingQuantity} ${unit})`).slice(0, 100), unit: "serving", baseAmount: servingQuantity, defaultAmount: 1, estimated: false });
    defaultPortionId = "label-serving";
  }
  const pack = /^\s*(\d+(?:[.,]\d+)?)\s*(kg|g|ml|cl|l)\b/i.exec(quantity);
  if (pack) {
    const packUnit = pack[2].toLowerCase();
    const packBasis = ["kg", "g"].includes(packUnit) ? "g" : "ml";
    if (packBasis === unit) {
      const size = Number(pack[1].replace(",", ".")) * (packUnit === "kg" || packUnit === "l" ? 1000 : packUnit === "cl" ? 10 : 1);
      if (size > 0 && size <= 50000) portions.push({ id: "pack", label: `Whole pack (${size} ${unit})`, unit: "pack", baseAmount: size, defaultAmount: 1, estimated: false });
    }
  }
  const sodiumG = nutrient("sodium") ?? (nutrient("salt") == null ? null : nutrient("salt")! / 2.5);
  const gradeRaw = typeof p.nutriscore_grade === "string" ? p.nutriscore_grade.toLowerCase() : "";
  const nutriScoreGrade = ["a", "b", "c", "d", "e"].includes(gradeRaw) ? (gradeRaw as "a" | "b" | "c" | "d" | "e") : null;
  const nutriRaw = typeof p.nutriscore_score === "number" ? p.nutriscore_score : typeof p.nutriscore_score === "string" && p.nutriscore_score.trim() ? Number(p.nutriscore_score) : NaN;
  const nutriScoreScore = Number.isFinite(nutriRaw) && nutriRaw >= -30 && nutriRaw <= 55 ? Math.round(nutriRaw) : null;
  const novaRaw = Number(p.nova_group ?? n["nova-group_100g"] ?? n["nova-group"]);
  const novaGroup = novaRaw === 1 || novaRaw === 2 || novaRaw === 3 || novaRaw === 4 ? (novaRaw as 1 | 2 | 3 | 4) : null;
  const categoriesTags = Array.isArray(p.categories_tags) ? p.categories_tags.filter((t): t is string => typeof t === "string").slice(0, 12).map((t) => t.slice(0, 80)) : undefined;
  const ingRaw = [p.ingredients_text_en, p.ingredients_text].find((v) => typeof v === "string" && v.trim()) as string | undefined;
  return foodSnapshotInput.parse({ id: `off:${code}`, name: name.trim().slice(0, 160), brand, source: "Open Food Facts",
    sourceUrl: `https://world.openfoodfacts.org/product/${code}`, foodType: liquid ? "drink" : "food", basisAmount: 100, basisUnit: unit,
    calories, proteinG: nutrient("proteins"), carbsG: nutrient("carbohydrates"), fatG: nutrient("fat"), fibreG: nutrient("fiber"), portions, defaultPortionId,
    qualityMeta: {
      sugarsG: nutrient("sugars"),
      saturatedFatG: nutrient("saturated-fat"),
      sodiumMg: sodiumG != null && sodiumG * 1000 <= 50000 ? Math.round(sodiumG * 1000) : null,
      nutriScoreGrade,
      nutriScoreScore,
      novaGroup,
      ...(categoriesTags?.length ? { categoriesTags } : {}),
      ...(ingRaw ? { ingredientsText: ingRaw.trim().slice(0, 500) } : {}),
    } });
}

async function quota(db: AuthDatabase, key: string, maximum: number) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"food-provider:" + key}))`);
    const [row] = await tx.select().from(foodProviderRate).where(eq(foodProviderRate.key, key));
    const now = new Date();
    const fresh = !row || row.windowStart.getTime() < now.getTime() - 60000;
    if (!fresh && row.attempts >= maximum) return false;
    await tx.insert(foodProviderRate).values({ key, windowStart: now, attempts: 1 }).onConflictDoUpdate({ target: foodProviderRate.key,
      set: fresh ? { windowStart: now, attempts: 1 } : { attempts: sql`${foodProviderRate.attempts} + 1` } });
    return true;
  });
}
async function cached(db: AuthDatabase, key: string) {
  const [row] = await db.select().from(foodProviderCache).where(and(eq(foodProviderCache.key, key), gt(foodProviderCache.expiresAt, new Date())));
  return row ? z.array(foodSnapshotInput).parse(row.payload) : null;
}
async function store(db: AuthDatabase, key: string, foods: FoodDefinition[]) {
  await db.insert(foodProviderCache).values({ key, payload: foods, expiresAt: new Date(Date.now() + (foods.length ? 86400000 : 600000)) })
    .onConflictDoUpdate({ target: foodProviderCache.key, set: { payload: foods, expiresAt: new Date(Date.now() + (foods.length ? 86400000 : 600000)) } });
  await db.delete(foodProviderCache).where(lt(foodProviderCache.expiresAt, new Date()));
}
export async function searchBrandedFoods(db: AuthDatabase, userId: string, raw: string) {
  const query = raw.normalize("NFKC").replace(/[^\p{L}\p{N} .'-]/gu, " ").trim().replace(/\s+/g, " ").slice(0, 100);
  if (query.length < 3) return [];
  const key = "off:search:" + createHash("sha256").update(query.toLowerCase()).digest("hex");
  const existing = await cached(db, key);
  if (existing) return existing;
  if (!await quota(db, `search-user:${userId}`, 30)) throw new FoodProviderError("Product search is paused briefly. Your foods and UK catalogue still work.", 429);
  if (inflight.has(key)) return inflight.get(key)!;
  const request = (async () => {
    if (!await quota(db, "search-global", 60)) throw new FoodProviderError("Product search is busy. Try again shortly.", 429);
    // Dedicated Search-a-licious full-text API, not the rate-limited legacy product-search endpoint.
    const url = new URL("https://search.openfoodfacts.org/search");
    url.search = new URLSearchParams({ q: query, page_size: "20", fields, langs: "en" }).toString();
    const response = await fetch(url, { headers: { "User-Agent": agent }, signal: AbortSignal.timeout(7000), cache: "no-store" });
    if (!response.ok) throw new FoodProviderError("Branded food search is unavailable. Your saved foods still work.");
    const body = z.object({ hits: z.array(z.unknown()).max(100) }).parse(await response.json());
    const foods = body.hits.map((item) => { try { return parseBrandedFood(item); } catch { return null; } }).filter((item): item is FoodDefinition => item != null);
    await store(db, key, foods);
    return foods;
  })();
  inflight.set(key, request);
  try { return await request; } finally { inflight.delete(key); }
}
export async function barcodeFood(db: AuthDatabase, userId: string, code: string) {
  const key = `off:barcode:${code}`;
  const existing = await cached(db, key);
  if (existing) return existing[0] ?? null;
  if (!await quota(db, `barcode-user:${userId}`, 12) || !await quota(db, "barcode-global", 12)) throw new FoodProviderError("Barcode lookup limit reached. Try again in a minute.", 429);
  const response = await fetch(`https://world.openfoodfacts.org/api/v3.6/product/${code}.json?fields=${fields}`, { headers: { "User-Agent": agent }, signal: AbortSignal.timeout(7000), cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new FoodProviderError("Barcode lookup is unavailable.");
  const result = await response.json();
  const food = parseBrandedFood({ ...result.product, code });
  await store(db, key, food ? [food] : []);
  return food;
}
