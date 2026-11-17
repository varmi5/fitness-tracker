"use client";

import { useEffect, useState } from "react";
import { Plus, Search, Trash2, X } from "lucide-react";
import type { MealRecord } from "../lib/nutrition-data";
import {
  CATEGORIES,
  ESTIMATION_METHODS,
  UNITS,
  type EstimationMethod,
  type FoodUnit,
  type MealCategory,
} from "../lib/nutrition-model";
import type { BarcodeProduct } from "../lib/uk-foods";
import { CATEGORY_LABELS, METHOD_LABELS, type FoodLibrary } from "./types";

interface DraftItem {
  key: string;
  name: string;
  amount: string;
  unit: FoodUnit;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
  fibreG: string;
  calMin: string;
  calMax: string;
  estimationMethod: EstimationMethod;
  savedFoodId: string | null;
}

const emptyItem = (): DraftItem => ({
  key: crypto.randomUUID(),
  name: "",
  amount: "",
  unit: "g",
  calories: "",
  proteinG: "",
  carbsG: "",
  fatG: "",
  fibreG: "",
  calMin: "",
  calMax: "",
  estimationMethod: "weighed",
  savedFoodId: null,
});

function toStr(n: number | null | undefined): string {
  return n == null ? "" : String(Number(n.toFixed(1)));
}

function toNum(raw: string): number | null {
  const clean = raw.trim();
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function scale(val: number | null | undefined, ratio: number): string {
  if (val == null) return "";
  return String(Math.round(val * ratio * 10) / 10);
}

interface MealComposerProps {
  defaultDay: string;
  editingMeal: MealRecord | null;
  busy: boolean;
  onClose: () => void;
  onSaveMeal: (payload: { mode: "log" | "update"; data: unknown }) => Promise<void>;
  onSaveTemplate: (data: unknown) => Promise<void>;
}

export function MealComposer({
  defaultDay,
  editingMeal,
  busy,
  onClose,
  onSaveMeal,
  onSaveTemplate,
}: MealComposerProps) {
  const [sourceTab, setSourceTab] = useState<"recent" | "recipes" | "uk" | "manual">(editingMeal ? "manual" : "recent");
  const [day, setDay] = useState(editingMeal?.localDay ?? defaultDay);
  const [time, setTime] = useState(() => {
    if (editingMeal) return editingMeal.localTime;
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  });
  const [mealName, setMealName] = useState(editingMeal?.name ?? "");
  const [category, setCategory] = useState<MealCategory>(editingMeal?.category ?? "lunch");
  const [cookingMethod, setCookingMethod] = useState(editingMeal?.cookingMethod ?? "");
  const [ingredients, setIngredients] = useState(editingMeal?.ingredients ?? "");
  const [notes, setNotes] = useState(editingMeal?.notes ?? "");
  const [items, setItems] = useState<DraftItem[]>(() =>
    editingMeal?.items.length
      ? editingMeal.items.map((it) => ({
          key: it.id,
          name: it.name,
          amount: it.amount == null ? "" : String(it.amount),
          unit: it.unit,
          calories: toStr(it.calories),
          proteinG: toStr(it.proteinG),
          carbsG: toStr(it.carbsG),
          fatG: toStr(it.fatG),
          fibreG: toStr(it.fibreG),
          calMin: toStr(it.calMin),
          calMax: toStr(it.calMax),
          estimationMethod: it.estimationMethod,
          savedFoodId: it.savedFoodId,
        }))
      : [emptyItem()],
  );

  const [query, setQuery] = useState("");
  const [library, setLibrary] = useState<FoodLibrary | null>(null);
  const [barcode, setBarcode] = useState("");
  const [barcodeProduct, setBarcodeProduct] = useState<BarcodeProduct | null>(null);
  const [barcodeGrams, setBarcodeGrams] = useState("100");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [error, setError] = useState("");

  // Batch recipe creator state
  const [showNewRecipe, setShowNewRecipe] = useState(false);
  const [recipeName, setRecipeName] = useState("");
  const [recipeBatchGrams, setRecipeBatchGrams] = useState("600");
  const [recipeDefaultServe, setRecipeDefaultServe] = useState("200");
  const [recipeKcal, setRecipeKcal] = useState("");
  const [recipeP, setRecipeP] = useState("");
  const [recipeC, setRecipeC] = useState("");
  const [recipeF, setRecipeF] = useState("");
  const [recipeFib, setRecipeFib] = useState("");
  const [recipeIng, setRecipeIng] = useState("");

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    fetch(`/api/nutrition?library=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data) setLibrary(data);
      })
      .catch(() => null);
    return () => {
      active = false;
      controller.abort();
    };
  }, [query]);

  function addDraftItems(incoming: DraftItem[], suggestedMealName?: string) {
    setItems((prev) => {
      const cleaned = prev.filter((i) => i.name.trim() !== "" || i.calories.trim() !== "");
      return [...cleaned, ...incoming];
    });
    if (!mealName.trim() && suggestedMealName) setMealName(suggestedMealName);
    setSourceTab("manual");
  }

  function addUkStaple(staple: FoodLibrary["ukStaples"][number], gramsStr = "100") {
    const grams = toNum(gramsStr) ?? staple.defaultAmount;
    const ratio = grams / staple.defaultAmount;
    addDraftItems(
      [
        {
          key: crypto.randomUUID(),
          name: staple.name,
          amount: String(grams),
          unit: staple.defaultUnit,
          calories: scale(staple.calories, ratio),
          proteinG: scale(staple.proteinG, ratio),
          carbsG: scale(staple.carbsG, ratio),
          fatG: scale(staple.fatG, ratio),
          fibreG: scale(staple.fibreG, ratio),
          calMin: "",
          calMax: "",
          estimationMethod: "weighed",
          savedFoodId: null,
        },
      ],
      staple.name.split(",")[0],
    );
  }

  function addSavedFood(food: FoodLibrary["saved"][number], servedGrams?: number) {
    if (food.kind === "template" && Array.isArray(food.itemsJson) && food.itemsJson.length > 0) {
      const parsed = (food.itemsJson as Record<string, unknown>[]).map((raw) => ({
        key: crypto.randomUUID(),
        name: String(raw.name ?? food.name),
        amount: raw.amount != null ? String(raw.amount) : "",
        unit: (raw.unit as FoodUnit) ?? "g",
        calories: toStr(raw.calories as number | null | undefined),
        proteinG: toStr(raw.proteinG as number | null | undefined),
        carbsG: toStr(raw.carbsG as number | null | undefined),
        fatG: toStr(raw.fatG as number | null | undefined),
        fibreG: toStr(raw.fibreG as number | null | undefined),
        calMin: toStr(raw.calMin as number | null | undefined),
        calMax: toStr(raw.calMax as number | null | undefined),
        estimationMethod: ((raw.estimationMethod as EstimationMethod) ?? "recipe"),
        savedFoodId: food.id,
      }));
      addDraftItems(parsed, food.name);
      return;
    }

    const basis = food.batchCookedGrams ?? food.defaultAmount;
    const targetAmt = servedGrams ?? food.defaultAmount;
    const ratio = basis > 0 ? targetAmt / basis : 1;
    addDraftItems(
      [
        {
          key: crypto.randomUUID(),
          name: food.name,
          amount: String(targetAmt),
          unit: food.defaultUnit as FoodUnit,
          calories: scale(food.calories, ratio),
          proteinG: scale(food.proteinG, ratio),
          carbsG: scale(food.carbsG, ratio),
          fatG: scale(food.fatG, ratio),
          fibreG: scale(food.fibreG, ratio),
          calMin: "",
          calMax: "",
          estimationMethod: food.kind === "recipe" ? "recipe" : "weighed",
          savedFoodId: food.id,
        },
      ],
      food.name,
    );
    if (food.ingredients && !ingredients.trim()) setIngredients(food.ingredients);
    if (food.cookingMethod && !cookingMethod.trim()) setCookingMethod(food.cookingMethod);
  }

  async function lookupBarcode() {
    setError("");
    setBarcodeProduct(null);
    setLookupBusy(true);
    try {
      const res = await fetch(`/api/nutrition/barcode?code=${encodeURIComponent(barcode.trim())}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message ?? "Barcode lookup failed.");
      setBarcodeProduct(payload.product);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Barcode lookup failed.");
    } finally {
      setLookupBusy(false);
    }
  }

  function addBarcodeProduct() {
    if (!barcodeProduct) return;
    const amt = toNum(barcodeGrams) ?? 100;
    const ratio = amt / barcodeProduct.basisAmount;
    addDraftItems(
      [
        {
          key: crypto.randomUUID(),
          name: barcodeProduct.name,
          amount: String(amt),
          unit: barcodeProduct.basisUnit,
          calories: scale(barcodeProduct.calories, ratio),
          proteinG: scale(barcodeProduct.proteinG, ratio),
          carbsG: scale(barcodeProduct.carbsG, ratio),
          fatG: scale(barcodeProduct.fatG, ratio),
          fibreG: scale(barcodeProduct.fibreG, ratio),
          calMin: "",
          calMax: "",
          estimationMethod: "pack_label",
          savedFoodId: null,
        },
      ],
      barcodeProduct.name,
    );
    setBarcodeProduct(null);
  }

  async function submitRecipe() {
    setError("");
    const batch = toNum(recipeBatchGrams);
    const serve = toNum(recipeDefaultServe) ?? 100;
    if (!recipeName.trim() || !batch) {
      setError("Enter recipe name and cooked batch weight in grams.");
      return;
    }
    await onSaveTemplate({
      kind: "recipe",
      name: recipeName.trim(),
      defaultAmount: serve,
      defaultUnit: "g",
      batchCookedGrams: batch,
      calories: toNum(recipeKcal),
      proteinG: toNum(recipeP),
      carbsG: toNum(recipeC),
      fatG: toNum(recipeF),
      fibreG: toNum(recipeFib),
      ingredients: recipeIng.trim(),
    });
    setShowNewRecipe(false);
    setRecipeName("");
    const refreshed = await fetch(`/api/nutrition?library=${encodeURIComponent(query)}`).then((r) => r.json());
    setLibrary(refreshed);
  }

  async function handleSubmit(saveAsTemplate = false) {
    setError("");
    const validItems = items
      .filter((i) => i.name.trim() !== "")
      .map((i) => ({
        name: i.name.trim(),
        amount: toNum(i.amount),
        unit: i.unit,
        calories: toNum(i.calories),
        proteinG: toNum(i.proteinG),
        carbsG: toNum(i.carbsG),
        fatG: toNum(i.fatG),
        fibreG: toNum(i.fibreG),
        calMin: toNum(i.calMin),
        calMax: toNum(i.calMax),
        estimationMethod: i.estimationMethod,
        savedFoodId: i.savedFoodId,
      }));

    if (!validItems.length) {
      setError("Add at least one food item.");
      return;
    }
    const resolvedName = mealName.trim() || validItems[0].name;

    if (saveAsTemplate) {
      await onSaveTemplate({
        kind: "template",
        name: resolvedName,
        defaultAmount: 1,
        defaultUnit: "serving",
        itemsJson: validItems,
        ingredients: ingredients.trim(),
        cookingMethod: cookingMethod.trim(),
      });
    }

    await onSaveMeal({
      mode: editingMeal ? "update" : "log",
      data: editingMeal
        ? {
            id: editingMeal.id,
            day,
            time,
            name: resolvedName,
            category,
            cookingMethod,
            ingredients,
            notes,
            items: validItems,
          }
        : {
            day,
            time,
            name: resolvedName,
            category,
            cookingMethod,
            ingredients,
            notes,
            items: validItems,
          },
    });
    onClose();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={editingMeal ? "Edit meal" : "Log meal"}>
      <div className="modal-sheet">
        <div className="split-row">
          <h2>{editingMeal ? `Edit ${editingMeal.name}` : "Add Food & Meal"}</h2>
          <button type="button" className="secondary compact" onClick={onClose} aria-label="Close composer">
            <X size={18} />
          </button>
        </div>

        <div className="seg-tabs" role="tablist" aria-label="Food source">
          {(
            [
              ["recent", "Recent"],
              ["recipes", "Recipes"],
              ["uk", "UK & Scan"],
              ["manual", `Meal (${items.filter((i) => i.name.trim()).length || items.length})`],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={sourceTab === key} onClick={() => setSourceTab(key)}>
              {label}
            </button>
          ))}
        </div>

        {sourceTab !== "manual" && (
          <label>
            Search foods, recipes, or UK staples
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. eggs, dhal, chicken breast, oats…"
            />
          </label>
        )}

        {sourceTab === "recent" && (
          <div style={{ display: "grid", gap: ".45rem" }}>
            {!library ? (
              <p>Loading recent foods…</p>
            ) : library.frequent.length === 0 ? (
              <p>No recent items yet. Switch to UK & Scan or Meal to add your first food.</p>
            ) : (
              library.frequent.map((f) => (
                <div className="list-item" key={f.name}>
                  <div>
                    <strong>{f.name}</strong>
                    <small className="row-note">
                      {f.amount ? `${f.amount}${f.unit} · ` : ""}
                      {f.calories != null ? `${Math.round(f.calories)} kcal` : "kcal unknown"} ·{" "}
                      {f.proteinG != null ? `P ${f.proteinG}g` : "P —"} · logged {f.count}×
                    </small>
                  </div>
                  <button
                    type="button"
                    className="secondary compact"
                    onClick={() =>
                      addDraftItems(
                        [
                          {
                            key: crypto.randomUUID(),
                            name: f.name,
                            amount: f.amount != null ? String(f.amount) : "",
                            unit: f.unit,
                            calories: toStr(f.calories),
                            proteinG: toStr(f.proteinG),
                            carbsG: toStr(f.carbsG),
                            fatG: toStr(f.fatG),
                            fibreG: toStr(f.fibreG),
                            calMin: "",
                            calMax: "",
                            estimationMethod: f.estimationMethod,
                            savedFoodId: null,
                          },
                        ],
                        f.name,
                      )
                    }
                  >
                    <Plus size={15} /> Add
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {sourceTab === "recipes" && (
          <div style={{ display: "grid", gap: ".65rem" }}>
            <div className="split-row">
              <p style={{ fontSize: ".82rem" }}>Saved homemade batch recipes & reusable meal templates</p>
              <button type="button" className="secondary compact" onClick={() => setShowNewRecipe(!showNewRecipe)}>
                {showNewRecipe ? "Cancel" : "+ New batch recipe"}
              </button>
            </div>

            {showNewRecipe && (
              <div className="card" style={{ display: "grid", gap: ".6rem" }}>
                <label>Recipe name<input value={recipeName} onChange={(e) => setRecipeName(e.target.value)} placeholder="e.g. Homemade Red Lentil Dhal" /></label>
                <div className="input-grid">
                  <label>Total cooked weight (g)<input inputMode="decimal" value={recipeBatchGrams} onChange={(e) => setRecipeBatchGrams(e.target.value)} /></label>
                  <label>Default serving (g)<input inputMode="decimal" value={recipeDefaultServe} onChange={(e) => setRecipeDefaultServe(e.target.value)} /></label>
                  <label>Whole batch kcal<input inputMode="decimal" value={recipeKcal} onChange={(e) => setRecipeKcal(e.target.value)} /></label>
                  <label>Batch protein (g)<input inputMode="decimal" value={recipeP} onChange={(e) => setRecipeP(e.target.value)} /></label>
                  <label>Batch carbs (g)<input inputMode="decimal" value={recipeC} onChange={(e) => setRecipeC(e.target.value)} /></label>
                  <label>Batch fat (g)<input inputMode="decimal" value={recipeF} onChange={(e) => setRecipeF(e.target.value)} /></label>
                  <label>Batch fibre (g)<input inputMode="decimal" value={recipeFib} onChange={(e) => setRecipeFib(e.target.value)} /></label>
                </div>
                <label>Ingredients<input value={recipeIng} onChange={(e) => setRecipeIng(e.target.value)} placeholder="Red lentils, onions, tomatoes, 1 tbsp ghee, spices" /></label>
                <button type="button" disabled={busy} onClick={() => void submitRecipe()}>Save batch recipe</button>
              </div>
            )}

            {library?.saved.length === 0 && <p>No saved recipes or templates yet.</p>}
            {library?.saved.map((food) => (
              <div className="list-item" key={food.id}>
                <div>
                  <div style={{ display: "flex", gap: ".4rem", alignItems: "center" }}>
                    <span className="pill">{food.kind}</span>
                    <strong>{food.name}</strong>
                  </div>
                  <small className="row-note">
                    {food.batchCookedGrams
                      ? `Batch ${food.batchCookedGrams}g · default serve ${food.defaultAmount}g`
                      : `${food.defaultAmount} ${food.defaultUnit}`}
                    {food.calories != null && ` · ${Math.round(food.calories)} kcal (${food.batchCookedGrams ? "batch" : "base"})`}
                  </small>
                </div>
                <button type="button" className="secondary compact" onClick={() => addSavedFood(food)}>
                  <Plus size={15} /> Use
                </button>
              </div>
            ))}
          </div>
        )}

        {sourceTab === "uk" && (
          <div style={{ display: "grid", gap: ".75rem" }}>
            <div className="card" style={{ display: "grid", gap: ".55rem" }}>
              <h3>UK Supermarket Barcode (Open Food Facts)</h3>
              <div className="date-nav">
                <input
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  inputMode="numeric"
                  placeholder="Enter 8–14 digit EAN barcode"
                />
                <button type="button" className="secondary compact" disabled={lookupBusy} onClick={() => void lookupBarcode()}>
                  <Search size={15} /> {lookupBusy ? "Looking up…" : "Lookup"}
                </button>
              </div>
              {barcodeProduct && (
                <div style={{ display: "grid", gap: ".5rem", borderTop: "1px solid var(--border)", paddingTop: ".55rem" }}>
                  <strong>{barcodeProduct.name}</strong>
                  <p style={{ fontSize: ".78rem" }}>
                    Per 100{barcodeProduct.basisUnit}: {barcodeProduct.calories ?? "—"} kcal · P {barcodeProduct.proteinG ?? "—"}g ·
                    C {barcodeProduct.carbsG ?? "—"}g · F {barcodeProduct.fatG ?? "—"}g · Fibre {barcodeProduct.fibreG ?? "—"}g
                    {barcodeProduct.servingSizeLabel ? ` · Pack serving: ${barcodeProduct.servingSizeLabel}` : ""}
                  </p>
                  <div className="date-nav">
                    <label style={{ flex: 1 }}>
                      Amount ({barcodeProduct.basisUnit})
                      <input inputMode="decimal" value={barcodeGrams} onChange={(e) => setBarcodeGrams(e.target.value)} />
                    </label>
                    <button type="button" className="compact" onClick={addBarcodeProduct}>
                      Add & review
                    </button>
                  </div>
                </div>
              )}
              <p style={{ fontSize: ".72rem" }}>
                Open Food Facts entries are community-sourced; verify values against the UK packet label before saving.
              </p>
            </div>

            <div>
              <h3 style={{ marginBottom: ".35rem" }}>UK CoFID Staples (per 100g / 100ml)</h3>
              {library?.ukStaples.map((s) => (
                <div className="list-item" key={s.id}>
                  <div>
                    <strong>{s.name}</strong>
                    <small className="row-note">
                      {s.preparation} · {s.calories} kcal · P {s.proteinG}g · C {s.carbsG}g · F {s.fatG}g
                      {s.fibreG != null ? ` · Fib ${s.fibreG}g` : ""}
                    </small>
                  </div>
                  <button type="button" className="secondary compact" onClick={() => addUkStaple(s, "100")}>
                    + 100{s.defaultUnit}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {sourceTab === "manual" && (
          <div style={{ display: "grid", gap: ".8rem" }}>
            <div className="input-grid">
              <label>
                Meal name
                <input value={mealName} onChange={(e) => setMealName(e.target.value)} placeholder="e.g. Scrambled eggs on sourdough" />
              </label>
              <label>
                Category
                <select value={category} onChange={(e) => setCategory(e.target.value as MealCategory)}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </label>
              <label>
                Date
                <input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
              </label>
              <label>
                Time
                <input type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} />
              </label>
            </div>

            <div style={{ display: "grid", gap: ".65rem" }}>
              <div className="split-row">
                <h3>Food items</h3>
                <button type="button" className="secondary compact" onClick={() => setItems((p) => [...p, emptyItem()])}>
                  <Plus size={15} /> Add item
                </button>
              </div>
              {items.map((item, index) => (
                <div className="card" key={item.key} style={{ padding: ".8rem", display: "grid", gap: ".55rem" }}>
                  <div className="split-row">
                    <span className="pill">Item {index + 1}</span>
                    {items.length > 1 && (
                      <button
                        type="button"
                        className="secondary compact"
                        onClick={() => setItems((p) => p.filter((x) => x.key !== item.key))}
                        aria-label={`Remove item ${index + 1}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <div className="input-grid">
                    <label>
                      Food name
                      <input
                        value={item.name}
                        onChange={(e) =>
                          setItems((p) => p.map((x) => (x.key === item.key ? { ...x, name: e.target.value } : x)))
                        }
                        placeholder="e.g. Three large eggs"
                      />
                    </label>
                    <label>
                      Portion
                      <div style={{ display: "flex", gap: ".35rem" }}>
                        <input
                          inputMode="decimal"
                          value={item.amount}
                          onChange={(e) =>
                            setItems((p) => p.map((x) => (x.key === item.key ? { ...x, amount: e.target.value } : x)))
                          }
                          placeholder="g / ml"
                        />
                        <select
                          style={{ width: "6.2rem" }}
                          value={item.unit}
                          onChange={(e) =>
                            setItems((p) =>
                              p.map((x) => (x.key === item.key ? { ...x, unit: e.target.value as FoodUnit } : x)),
                            )
                          }
                        >
                          {UNITS.map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      </div>
                    </label>
                    <label>
                      Method
                      <select
                        value={item.estimationMethod}
                        onChange={(e) =>
                          setItems((p) =>
                            p.map((x) =>
                              x.key === item.key ? { ...x, estimationMethod: e.target.value as EstimationMethod } : x,
                            ),
                          )
                        }
                      >
                        {ESTIMATION_METHODS.map((m) => (
                          <option key={m} value={m}>{METHOD_LABELS[m]}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="input-grid">
                    <label>
                      Calories <small>(blank = unknown)</small>
                      <input
                        inputMode="decimal"
                        value={item.calories}
                        onChange={(e) =>
                          setItems((p) => p.map((x) => (x.key === item.key ? { ...x, calories: e.target.value } : x)))
                        }
                      />
                    </label>
                    <label>
                      Protein (g)
                      <input
                        inputMode="decimal"
                        value={item.proteinG}
                        onChange={(e) =>
                          setItems((p) => p.map((x) => (x.key === item.key ? { ...x, proteinG: e.target.value } : x)))
                        }
                      />
                    </label>
                    <label>
                      Fibre (g) <small>(optional)</small>
                      <input
                        inputMode="decimal"
                        value={item.fibreG}
                        onChange={(e) =>
                          setItems((p) => p.map((x) => (x.key === item.key ? { ...x, fibreG: e.target.value } : x)))
                        }
                      />
                    </label>
                    <label>
                      Carbs (g)
                      <input
                        inputMode="decimal"
                        value={item.carbsG}
                        onChange={(e) =>
                          setItems((p) => p.map((x) => (x.key === item.key ? { ...x, carbsG: e.target.value } : x)))
                        }
                      />
                    </label>
                    <label>
                      Fat (g)
                      <input
                        inputMode="decimal"
                        value={item.fatG}
                        onChange={(e) =>
                          setItems((p) => p.map((x) => (x.key === item.key ? { ...x, fatG: e.target.value } : x)))
                        }
                      />
                    </label>
                    <label>
                      Est. kcal range <small>(min / max)</small>
                      <div style={{ display: "flex", gap: ".35rem" }}>
                        <input
                          inputMode="decimal"
                          placeholder="Min"
                          value={item.calMin}
                          onChange={(e) =>
                            setItems((p) => p.map((x) => (x.key === item.key ? { ...x, calMin: e.target.value } : x)))
                          }
                        />
                        <input
                          inputMode="decimal"
                          placeholder="Max"
                          value={item.calMax}
                          onChange={(e) =>
                            setItems((p) => p.map((x) => (x.key === item.key ? { ...x, calMax: e.target.value } : x)))
                          }
                        />
                      </div>
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <div className="input-grid">
              <label>
                Cooking method <small>Optional</small>
                <input value={cookingMethod} onChange={(e) => setCookingMethod(e.target.value)} placeholder="e.g. Pan-fried in 1 tsp butter" />
              </label>
              <label>
                Ingredients <small>Optional</small>
                <input value={ingredients} onChange={(e) => setIngredients(e.target.value)} placeholder="e.g. Eggs, Cholula hot sauce" />
              </label>
            </div>
            <label>
              Notes <small>Optional</small>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>

            {error && <p role="alert" style={{ color: "var(--danger-fg)" }}>{error}</p>}

            <div className="button-row">
              <button type="button" disabled={busy} onClick={() => void handleSubmit(false)}>
                {editingMeal ? "Save changes" : "Save meal"}
              </button>
              {!editingMeal && (
                <button type="button" className="secondary" disabled={busy} onClick={() => void handleSubmit(true)}>
                  Save meal & reusable template
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
