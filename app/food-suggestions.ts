"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FoodUnit, MealItemInput } from "../lib/nutrition-model";
import { foodMatchScore } from "../lib/search-match";
import { UK_STAPLES } from "../lib/uk-foods";
import type { FoodLibrary } from "./types";

export interface FoodChoice {
  key: string;
  name: string;
  detail: string;
  source: "Saved recipe" | "Saved food" | "Meal template" | "Recent" | "UK staple";
  items: MealItemInput[];
  ingredients?: string;
  cookingMethod?: string;
}

export function foodChoices(library: FoodLibrary | null, query: string): FoodChoice[] {
  const saved: FoodChoice[] = (library?.saved ?? []).map((food) => {
    const ratio = food.defaultAmount / (food.batchCookedGrams ?? food.defaultAmount);
    const scaled = (n: number | null) => n == null ? null : Math.round(n * ratio * 10) / 10;
    return {
      key: food.id, name: food.name,
      source: food.kind === "template" ? "Meal template" : food.kind === "recipe" ? "Saved recipe" : "Saved food",
      detail: `${food.defaultAmount} ${food.defaultUnit}`,
      ingredients: food.ingredients, cookingMethod: food.cookingMethod,
      items: food.kind === "template" && Array.isArray(food.itemsJson) && food.itemsJson.length ? food.itemsJson as MealItemInput[] : [{
        name: food.name, amount: food.defaultAmount, unit: food.defaultUnit as FoodUnit,
        calories: scaled(food.calories), proteinG: scaled(food.proteinG), carbsG: scaled(food.carbsG),
        fatG: scaled(food.fatG), fibreG: scaled(food.fibreG),
        estimationMethod: food.kind === "recipe" ? "recipe" : "weighed", savedFoodId: food.id,
      }],
    };
  });
  const recent: FoodChoice[] = (library?.frequent ?? []).map((food) => ({
    key: `recent:${food.name}`, name: food.name, source: "Recent", detail: food.amount == null ? "Portion unrecorded" : `${food.amount} ${food.unit}`,
    items: [{ ...food }],
  }));
  const staples: FoodChoice[] = UK_STAPLES.map((food) => ({
    key: food.id, name: food.name, source: "UK staple", detail: food.preparation,
    items: [{ name: food.name, amount: food.defaultAmount, unit: food.defaultUnit as FoodUnit,
      calories: food.calories, proteinG: food.proteinG, carbsG: food.carbsG, fatG: food.fatG, fibreG: food.fibreG, estimationMethod: "weighed" }],
  }));
  const seen = new Set<string>();
  return [...saved, ...recent, ...staples].map((choice, order) => ({ choice, order, score: foodMatchScore(`${choice.name} ${choice.detail}`, query) }))
    .filter(({ choice, score }) => {
      if (!Number.isFinite(score)) return false;
      const key = `${choice.name.toLowerCase()}:${choice.items[0]?.amount}:${choice.items[0]?.unit}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.score - b.score || a.order - b.order).slice(0, 8).map(({ choice }) => choice);
}

export function useFoodSuggestions(query: string) {
  const [library, setLibrary] = useState<FoodLibrary | null>(null);
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  // Per-composer memory only. No health or food history in persistent browser storage.
  const cache = useRef(new Map<string, FoodLibrary>());
  useEffect(() => {
    const key = query.trim().toLowerCase();
    const cached = cache.current.get(key);
    if (cached) {
      setLibrary(cached); setSearching(false); setFailed(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setSearching(true); setFailed(false);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/nutrition?library=${encodeURIComponent(key)}`, { signal: controller.signal });
        if (!res.ok) throw new Error("Search unavailable");
        const value: FoodLibrary = await res.json();
        if (!active) return;
        if (cache.current.size >= 30) cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(key, value);
        setLibrary(value);
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) setSearching(false);
      }
    }, key ? 160 : 0);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [query]);
  const suggestions = useMemo(() => foodChoices(library, query), [library, query]);
  return { suggestions, library, searching, failed, refresh: () => { cache.current.clear(); setLibrary(null); } };
}
