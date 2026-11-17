"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Plus, Search, Trash2, X } from "lucide-react";
import { portionBasis, scalePortion, type PortionBasis } from "../lib/food-portion";
import { localTime } from "../lib/nutrition-model";
import { useFoodSuggestions, type FoodChoice } from "./food-suggestions";
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
  basis?: PortionBasis;
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
  timezone: string;
  onClose: () => void;
  onSaveMeal: (payload: { mode: "log" | "update"; data: unknown }) => Promise<boolean>;
  onSaveTemplate: (data: unknown) => Promise<boolean>;
}

export function MealComposer({
  defaultDay,
  editingMeal,
  busy,
  timezone,
  onClose,
  onSaveMeal,
  onSaveTemplate,
}: MealComposerProps) {
  const [sourceTab, setSourceTab] = useState<"recent" | "recipes" | "uk" | "manual">(editingMeal ? "manual" : "recent");
  const [day, setDay] = useState(editingMeal?.localDay ?? defaultDay);
  const [time, setTime] = useState(() => {
    if (editingMeal) return editingMeal.localTime;
    const now = new Date();
    return localTime(now, timezone);
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
  const { suggestions, library, searching, failed } = useFoodSuggestions(query);
  const [activeFoodKey, setActiveFoodKey] = useState<string | null>(null);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const requestKey = useRef(crypto.randomUUID());
  const dialog = useRef<HTMLDialogElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const working = busy || submitting;
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
    const modal = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    const y = window.scrollY;
    const previousStyle = { position: document.body.style.position, top: document.body.style.top, width: document.body.style.width };
    document.body.style.position = "fixed";
    document.body.style.top = `-${y}px`;
    document.body.style.width = "100%";
    const viewport = window.visualViewport;
    const resize = () => {
      modal.style.setProperty("--dialog-height", `${viewport?.height ?? window.innerHeight}px`);
      modal.style.setProperty("--dialog-top", `${viewport?.offsetTop ?? 0}px`);
    };
    resize();
    modal.showModal();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
      modal.close();
      Object.assign(document.body.style, previousStyle);
      window.scrollTo({ top: y, behavior: "instant" });
      previous?.focus({ preventScroll: true });
    };
  }, []);

  function chooseFood(choice: FoodChoice) {
    const incoming: DraftItem[] = choice.items.map((item) => {
      const draft: DraftItem = { key: crypto.randomUUID(), name: item.name,
        amount: item.amount == null ? "" : String(item.amount), unit: item.unit,
        calories: toStr(item.calories), proteinG: toStr(item.proteinG), carbsG: toStr(item.carbsG),
        fatG: toStr(item.fatG), fibreG: toStr(item.fibreG), calMin: toStr(item.calMin), calMax: toStr(item.calMax),
        estimationMethod: item.estimationMethod, savedFoodId: item.savedFoodId ?? null };
      return { ...draft, basis: portionBasis(draft) };
    });
    if (activeFoodKey) {
      setItems((prev) => prev.map((item) => item.key === activeFoodKey ? { ...incoming[0], key: item.key } : item));
    } else {
      addDraftItems(incoming, choice.name);
    }
    if (choice.ingredients && !ingredients) setIngredients(choice.ingredients);
    if (choice.cookingMethod && !cookingMethod) setCookingMethod(choice.cookingMethod);
    setActiveFoodKey(null); setQuery(""); setActiveSuggestion(-1);
    (document.activeElement as HTMLElement | null)?.blur();
    // Do not focus a field here: choosing a food must not open the phone keyboard.
  }

  function suggestionKeys(event: KeyboardEvent<HTMLInputElement>, choices: FoodChoice[]) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestion((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + choices.length) % Math.max(choices.length, 1));
    } else if (event.key === "Enter" && choices.length) {
      event.preventDefault(); chooseFood(choices[Math.max(0, activeSuggestion)] ?? choices[0]);
    } else if (event.key === "Escape" && activeFoodKey) {
      event.preventDefault(); event.stopPropagation(); setActiveFoodKey(null);
    }
  }

  function suggestionList(choices: FoodChoice[], id: string) {
    return <div className="food-suggestions" role="listbox" id={id} aria-label="Food suggestions">
      {choices.map((choice, index) => <button type="button" role="option" aria-selected={activeSuggestion === index}
        id={`${id}-${index}`} key={choice.key} className="food-suggestion" disabled={working}
        onClick={() => chooseFood(choice)}>
        <span><strong>{choice.name}</strong><small>{choice.source} · {choice.detail}</small></span>
        <span className="food-suggestion-energy">{choice.items.every((item) => item.calories != null)
          ? `${Math.round(choice.items.reduce((sum, item) => sum + (item.calories ?? 0), 0))} kcal` : "kcal —"}<Plus size={16} aria-hidden="true" /></span>
      </button>)}
    </div>;
  }

  function addDraftItems(incoming: DraftItem[], suggestedMealName?: string) {
    setItems((prev) => {
      const cleaned = prev.filter((i) => i.name.trim() !== "" || i.calories.trim() !== "");
      return [...cleaned, ...incoming.map((item) => ({ ...item, basis: portionBasis(item) }))];
    });
    if (!mealName.trim() && suggestedMealName) setMealName(suggestedMealName);
    setSourceTab("manual");
    setActiveFoodKey(null); setQuery("");
    sheet.current?.scrollTo({ top: 0, behavior: "instant" });
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
    if (submitLock.current) return;
    submitLock.current = true; setSubmitting(true);
    const saved = await onSaveTemplate({
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
    submitLock.current = false; setSubmitting(false);
    if (!saved) { setError("Recipe was not saved. Your entries are still here. Please try again."); return; }
    setShowNewRecipe(false);
    setRecipeName("");
    setSourceTab("recent"); setQuery(recipeName.trim());
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

    if (submitLock.current) return;
    submitLock.current = true; setSubmitting(true);
    const saved = await onSaveMeal({
      mode: editingMeal ? "update" : "log",
      data: { id: editingMeal?.id, idempotencyKey: requestKey.current, day, time, name: resolvedName, category, cookingMethod, ingredients, notes, items: validItems },
    });
    if (!saved) {
      submitLock.current = false; setSubmitting(false);
      setError("Meal was not saved. Your entries are still here. Check the connection and try again.");
      return;
    }
    if (saveAsTemplate) {
      const templateSaved = await onSaveTemplate({
        kind: "template",
        name: resolvedName,
        defaultAmount: 1,
        defaultUnit: "serving",
        itemsJson: validItems,
        ingredients: ingredients.trim(),
        cookingMethod: cookingMethod.trim(),
      });
      if (!templateSaved) {
        submitLock.current = false; setSubmitting(false);
        setError("Your meal is saved, but the template could not be saved. You can close this form safely.");
        return;
      }
    }

    onClose();
  }

  return (
    <dialog ref={dialog} className="modal-backdrop" aria-labelledby="meal-dialog-title"
      onCancel={(event) => { event.preventDefault(); if (!working) onClose(); }}>
      <div ref={sheet} className="modal-sheet" aria-busy={working}>
        <div className="split-row modal-header">
          <h2 id="meal-dialog-title">{editingMeal ? "Edit meal" : "Log a meal"}</h2>
          <button type="button" className="secondary compact" autoFocus disabled={working} onClick={onClose} aria-label="Close composer">
            <X size={18} />
          </button>
        </div>

        <div className="seg-tabs" role="group" aria-label="Food source">
          {(
            [
              ["recent", "Search"],
              ["recipes", "Recipes"],
              ["uk", "Barcode"],
              ["manual", `Meal (${items.filter((i) => i.name.trim()).length || items.length})`],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={sourceTab === key} onClick={() => { setSourceTab(key); setActiveFoodKey(null); setQuery(""); setActiveSuggestion(-1); }}>
              {label}
            </button>
          ))}
        </div>

        {error && <p role="alert" className="form-error">{error}</p>}
        {(sourceTab === "recent" || sourceTab === "recipes") && (
          <label>
            {sourceTab === "recent" ? "Find a food" : "Find a saved recipe"}
            <input type="search" role="combobox" aria-autocomplete="list" aria-expanded={sourceTab === "recent" && suggestions.length > 0}
              aria-controls="food-search-results" aria-activedescendant={activeSuggestion >= 0 ? `food-search-results-${activeSuggestion}` : undefined}
              value={query} onChange={(e) => { setQuery(e.target.value); setActiveSuggestion(-1); }}
              onKeyDown={(event) => suggestionKeys(event, suggestions)} autoComplete="off" autoCorrect="off" spellCheck={false}
              placeholder="Try eggs, oats, dhal…" enterKeyHint="search" />
          </label>
        )}
        {sourceTab === "recent" && <section className="food-search-panel" aria-label="Find food">
          <p className="search-hint">{query ? "Suggestions from your foods and UK staples" : "Your recent foods, saved recipes and everyday staples"}</p>
          {suggestionList(suggestions, "food-search-results")}
          <p className="search-hint" role="status">{failed ? "Saved foods are unavailable. UK staples still work. Try searching again." : searching ? "Checking your saved foods…" : `${suggestions.length} suggestions`}</p>
          {suggestions.length === 0 && <p>No matches yet. You can enter the food and its nutrition below.</p>}
          <button type="button" className="secondary" disabled={working} onClick={() => {
            if (query.trim()) {
              setItems((prev) => { const copy = [...prev]; const blank = copy.findIndex((item) => !item.name.trim());
                if (blank >= 0) copy[blank] = { ...copy[blank], name: query.trim() };
                else copy.push({ ...emptyItem(), name: query.trim() }); return copy; });
            }
            setSourceTab("manual"); setQuery(""); sheet.current?.scrollTo({ top: 0, behavior: "instant" });
          }}>Enter food manually</button>
        </section>}

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
                <button type="button" disabled={working} onClick={() => void submitRecipe()}>Save batch recipe</button>
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
                  aria-label="Food barcode"
                  placeholder="Enter 8–14 digit barcode"
                />
                <button type="button" className="secondary compact" disabled={lookupBusy || working || !/^\d{8,14}$/.test(barcode.trim())} onClick={() => void lookupBarcode()}>
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
                        role="combobox" autoComplete="off" aria-autocomplete="list"
                        aria-expanded={activeFoodKey === item.key && suggestions.length > 0}
                        aria-controls={`food-options-${item.key}`}
                        aria-activedescendant={activeFoodKey === item.key && activeSuggestion >= 0 ? `food-options-${item.key}-${activeSuggestion}` : undefined}
                        onFocus={() => { setActiveFoodKey(item.key); setQuery(item.name); setActiveSuggestion(-1); }}
                        onChange={(e) => {
                          setItems((p) => p.map((x) => (x.key === item.key ? { ...x, name: e.target.value } : x)));
                          setActiveFoodKey(item.key); setQuery(e.target.value); setActiveSuggestion(-1);
                        }}
                        onKeyDown={(event) => suggestionKeys(event, suggestions.filter((choice) => choice.items.length === 1))}
                        placeholder="e.g. Eggs"
                      />
                    </label>
                    {activeFoodKey === item.key && item.name.trim() && <div className="inline-food-suggestions">
                      {suggestionList(suggestions.filter((choice) => choice.items.length === 1), `food-options-${item.key}`)}
                      <button className="secondary compact" type="button" onClick={() => setActiveFoodKey(null)}>Keep my entry</button>
                    </div>}
                    <label>
                      Portion
                      <div style={{ display: "flex", gap: ".35rem" }}>
                        <input
                          aria-label="Portion amount"
                          inputMode="decimal"
                          value={item.amount}
                          onChange={(e) =>
                            setItems((p) => p.map((x) => (x.key === item.key ? { ...x, basis: x.basis ?? portionBasis(x), amount: e.target.value, ...scalePortion(x.basis ?? portionBasis(x), e.target.value) } : x)))
                          }
                          placeholder="g / ml"
                        />
                        <select
                          style={{ width: "6.2rem" }}
                          aria-label="Portion unit"
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
                          setItems((p) => p.map((x) => (x.key === item.key ? { ...x, calories: e.target.value, basis: portionBasis({ ...x, calories: e.target.value }) } : x)))
                        }
                      />
                    </label>
                    <label>
                      Protein (g)
                      <input
                        inputMode="decimal"
                        value={item.proteinG}
                        onChange={(e) =>
                          setItems((p) => p.map((x) => (x.key === item.key ? { ...x, proteinG: e.target.value, basis: portionBasis({ ...x, proteinG: e.target.value }) } : x)))
                        }
                      />
                    </label>
                    <label>
                      Fibre (g) <small>(optional)</small>
                      <input
                        inputMode="decimal"
                        value={item.fibreG}
                        onChange={(e) =>
                          setItems((p) => p.map((x) => (x.key === item.key ? { ...x, fibreG: e.target.value, basis: portionBasis({ ...x, fibreG: e.target.value }) } : x)))
                        }
                      />
                    </label>
                    <label>
                      Carbs (g)
                      <input
                        inputMode="decimal"
                        value={item.carbsG}
                        onChange={(e) =>
                          setItems((p) => p.map((x) => (x.key === item.key ? { ...x, carbsG: e.target.value, basis: portionBasis({ ...x, carbsG: e.target.value }) } : x)))
                        }
                      />
                    </label>
                    <label>
                      Fat (g)
                      <input
                        inputMode="decimal"
                        value={item.fatG}
                        onChange={(e) =>
                          setItems((p) => p.map((x) => (x.key === item.key ? { ...x, fatG: e.target.value, basis: portionBasis({ ...x, fatG: e.target.value }) } : x)))
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
                            setItems((p) => p.map((x) => (x.key === item.key ? { ...x, calMin: e.target.value, basis: portionBasis({ ...x, calMin: e.target.value }) } : x)))
                          }
                        />
                        <input
                          inputMode="decimal"
                          placeholder="Max"
                          value={item.calMax}
                          onChange={(e) =>
                            setItems((p) => p.map((x) => (x.key === item.key ? { ...x, calMax: e.target.value, basis: portionBasis({ ...x, calMax: e.target.value }) } : x)))
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



            <div className="button-row meal-save-actions">
              <button type="button" disabled={working} onClick={() => void handleSubmit(false)}>
                {working ? "Saving…" : editingMeal ? "Save changes" : "Save meal"}
              </button>
              {!editingMeal && (
                <button type="button" className="secondary" disabled={working} onClick={() => void handleSubmit(true)}>
                  Save meal & reusable template
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
