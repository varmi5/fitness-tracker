"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FoodUnit, MealItemInput } from "../lib/nutrition-model";
import { foodSnapshotInput } from "../lib/nutrition-model";
import { calculateFoodPortion, standardMeasures, type FoodDefinition } from "../lib/food-catalogue-model";
import { foodMatchScore } from "../lib/search-match";
import type { FoodLibrary } from "./types";
export interface FoodChoice {
  key: string; name: string; detail: string; source: string; items: MealItemInput[];
  food?: FoodDefinition; savedFoodId?: string; isFavourite?: boolean;
  ingredients?: string; cookingMethod?: string;
}
export function definitionChoice(food: FoodDefinition, savedFoodId?: string, isFavourite = false): FoodChoice {
  const portion = food.portions.find((p) => p.id === food.defaultPortionId) ?? food.portions[0];
  const item = calculateFoodPortion(food, portion.id, portion.defaultAmount);
  return { key: savedFoodId ?? food.id, name: item.name, detail: `${portion.defaultAmount} × ${portion.label}`, source: savedFoodId ? "My food" : food.source,
    items: [{ ...item, savedFoodId: savedFoodId ?? null }], food, savedFoodId, isFavourite };
}
export function savedFoodChoice(food: FoodLibrary["saved"][number]): FoodChoice {
  if (food.kind === "template" && Array.isArray(food.itemsJson) && food.itemsJson.length) {
    return { key: food.id, name: food.name, source: "Meal template", detail: "Reusable meal", items: food.itemsJson as MealItemInput[],
      ingredients: food.ingredients, cookingMethod: food.cookingMethod, savedFoodId: food.id, isFavourite: food.isFavourite };
  }
  const portions = Array.isArray(food.portionsJson) && food.portionsJson.length ? food.portionsJson : standardMeasures(food.defaultUnit as FoodUnit, food.defaultAmount);
  const parsed = foodSnapshotInput.parse({ id: food.sourceId ?? food.id, name: food.name, brand: food.brand, source: food.sourceName,
    foodType: food.foodType, sourceUrl: food.sourceUrl, basisAmount: food.batchCookedGrams ?? food.defaultAmount, basisUnit: food.defaultUnit,
    calories: food.calories, proteinG: food.proteinG, carbsG: food.carbsG, fatG: food.fatG, fibreG: food.fibreG,
    portions, defaultPortionId: food.defaultPortionId ?? (portions as {id: string}[])[0].id });
  const choice = definitionChoice(parsed, food.id, food.isFavourite);
  if (food.kind === "recipe") { choice.source = "Saved recipe"; choice.items[0].estimationMethod = "recipe"; }
  return { ...choice, ingredients: food.ingredients, cookingMethod: food.cookingMethod };
}
export function foodChoices(library: FoodLibrary | null, query: string, products: FoodDefinition[] = []): FoodChoice[] {
  const saved = (library?.saved ?? []).map(savedFoodChoice);
  const recent: FoodChoice[] = (library?.frequent ?? []).map((food) => ({ key: `recent:${food.name}`, name: food.name, source: "Recent",
    detail: food.portionLabel ? `${food.amount ?? 1} × ${food.portionLabel}` : food.amount == null ? "Portion unrecorded" : `${food.amount} ${food.unit}`,
    items: [{ ...food }], food: food.foodSnapshot ?? undefined }));
  const all = [...saved, ...recent, ...(library?.catalogue ?? []).map((f) => definitionChoice(f)), ...products.map((f) => definitionChoice(f))];
  const seen = new Set<string>();
  return all.map((choice, order) => ({ choice, order, score: foodMatchScore(`${choice.name} ${choice.detail}`, query) }))
    .filter(({ choice, score }) => {
      if (!Number.isFinite(score)) return false;
      const key = choice.food ? choice.food.id : `${choice.name.toLowerCase()}:${choice.items[0]?.amount}:${choice.items[0]?.unit}`;
      if (seen.has(key)) return false; seen.add(key); return true;
    }).sort((a, b) => Number(Boolean(b.choice.isFavourite)) - Number(Boolean(a.choice.isFavourite)) || a.score - b.score || a.order - b.order)
    .slice(0, 30).map(({ choice }) => choice);
}
export function useFoodSuggestions(query: string) {
  const [library, setLibrary] = useState<FoodLibrary | null>(null);
  const [products, setProducts] = useState<FoodDefinition[]>([]);
  const [searching, setSearching] = useState(false);
  const [productSearching, setProductSearching] = useState(false);
  const [providerMessage, setProviderMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  const cache = useRef(new Map<string, FoodLibrary>());
  const productCache = useRef(new Map<string, FoodDefinition[]>());
  useEffect(() => {
    const key = query.trim().toLowerCase();
    const cached = cache.current.get(key);
    if (cached) { setLibrary(cached); setSearching(false); setFailed(false); return; }
    const controller = new AbortController(); let active = true;
    setSearching(true); setFailed(false);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/nutrition?library=${encodeURIComponent(key)}`, { signal: controller.signal });
        if (!res.ok) throw new Error("Search unavailable");
        const value: FoodLibrary = await res.json(); if (!active) return;
        if (cache.current.size >= 30) cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(key, value); setLibrary(value);
      } catch { if (active) setFailed(true); } finally { if (active) setSearching(false); }
    }, key ? 120 : 0);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [query, revision]);
  useEffect(() => {
    const key = query.trim().toLowerCase(); setProviderMessage(null);
    const cached = productCache.current.get(key);
    if (key.length < 3 || cached) { setProducts(cached ?? []); setProductSearching(false); return; }
    let active = true; const controller = new AbortController(); setProducts([]); setProductSearching(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/foods?q=${encodeURIComponent(key)}&products=1`, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const body = await response.json(); if (!active) return;
        const parsed = foodSnapshotInput.array().parse(body.products);
        if (!body.providerMessage) { if (productCache.current.size >= 30) productCache.current.delete(productCache.current.keys().next().value!); productCache.current.set(key, parsed); }
        setProducts(parsed); setProviderMessage(body.providerMessage);
      } catch { if (active) setProviderMessage("Branded search is unavailable. Your foods and UK catalogue still work."); }
      finally { if (active) setProductSearching(false); }
    }, 650);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [query]);
  const suggestions = useMemo(() => foodChoices(library, query, products), [library, query, products]);
  return { suggestions, library, searching, productSearching, providerMessage, failed,
    refresh: () => { cache.current.clear(); setRevision((r) => r + 1); } };
}
