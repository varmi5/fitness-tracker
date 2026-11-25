"use client";

import { foodEmoji } from "../lib/food-emoji";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { Camera, Plus, Search, Star, Trash2, X } from "lucide-react";

const BarcodeScanner = dynamic(() => import("./barcode-scanner").then((m) => m.BarcodeScanner), {
  ssr: false,
  loading: () => <p className="empty">Loading camera scanner…</p>,
});
import { portionBasis, scalePortion, type PortionBasis } from "../lib/food-portion";
import { localTime } from "../lib/nutrition-model";
import { CustomFoodForm } from "./custom-food-form";
import { calculateFoodPortion, foodToSavedInput, UNIT_LABELS, type FoodDefinition } from "../lib/food-catalogue-model";
import { useFoodSuggestions, definitionChoice, type FoodChoice } from "./food-suggestions";
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
  foodSnapshot?: FoodDefinition | null; portionId?: string | null; portionLabel?: string | null;
  gramWeight?: number | null; millilitreVolume?: number | null;
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
  initialBarcodeOpen?: boolean;
  busy: boolean;
  timezone: string;
  onClose: () => void;
  onSaveMeal: (payload: { mode: "log" | "update"; data: unknown }) => Promise<boolean>;
  onSaveTemplate: (data: unknown) => Promise<boolean>;
}

export function MealComposer({
  defaultDay,
  editingMeal,
  initialBarcodeOpen = false,
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
          foodSnapshot: it.foodSnapshot, portionId: it.portionId, portionLabel: it.portionLabel,
          gramWeight: it.gramWeight, millilitreVolume: it.millilitreVolume,
        }))
      : [emptyItem()],
  );

  const [query, setQuery] = useState("");
  const [creatingFood, setCreatingFood] = useState(false);
  const [activeFoodKey, setActiveFoodKey] = useState<string | null>(null);
  const searchEnabled = !creatingFood && (sourceTab === "recent" || sourceTab === "recipes" || sourceTab === "uk" || activeFoodKey !== null);
  const { suggestions: allSuggestions, library, searching, productSearching, providerMessage, failed, refresh } = useFoodSuggestions(query, searchEnabled);
  const [filter, setFilter] = useState<"all" | "favourites" | "mine" | "drinks">("all");
  const suggestions = allSuggestions.filter((choice) => filter === "all" || filter === "favourites" && choice.isFavourite || filter === "mine" && choice.savedFoodId || filter === "drinks" && choice.food?.foodType === "drink");
  const [editingCustom, setEditingCustom] = useState<FoodLibrary["saved"][number] | undefined>();
  const [selectedFood, setSelectedFood] = useState<FoodChoice | null>(null);
  const [foodBusy, setFoodBusy] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [submitting, setSubmitting] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const submitLock = useRef(false);
  const requestKey = useRef(crypto.randomUUID());
  const dialog = useRef<HTMLDialogElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const modalBody = useRef<HTMLDivElement>(null);
  const syncViewportRef = useRef<() => void>(() => {});
  const working = busy || submitting;
  const [barcode, setBarcode] = useState("");
  const [scannerOpen, setScannerOpen] = useState(initialBarcodeOpen);
  const [barcodeDefinition, setBarcodeDefinition] = useState<FoodDefinition | null>(null);
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
    const root = document.documentElement;
    const prevRootOverflow = root.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    const viewport = window.visualViewport;
    let baseHeight = Math.max(window.innerHeight, viewport?.height ?? window.innerHeight);
    let lastHeight = -1;
    let lastTop = -1;
    let frame = 0;

    const applyViewport = () => {
      frame = 0;
      const h = Math.round(viewport?.height ?? window.innerHeight);
      const t = Math.max(0, Math.round(viewport?.offsetTop ?? 0));
      const w = viewport?.width ?? window.innerWidth;
      if (h > baseHeight) baseHeight = h;
      if (Math.abs(h - lastHeight) >= 2) {
        lastHeight = h;
        modal.style.setProperty("--dialog-height", `${h}px`);
      }
      if (Math.abs(t - lastTop) >= 2) {
        lastTop = t;
        modal.style.setProperty("--dialog-top", `${t}px`);
      }
      const activeTag = document.activeElement?.tagName;
      const inputFocused = activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT";
      const shrunkForKeyboard = w < 680 && baseHeight - h > 110;
      const compactMobileFocus = w < 680 && h < 540 && inputFocused;
      setKeyboardOpen(shrunkForKeyboard || compactMobileFocus);
    };

    const scheduleResize = () => {
      if (!frame) frame = window.requestAnimationFrame(applyViewport);
    };

    syncViewportRef.current = scheduleResize;
    applyViewport();
    modal.showModal();
    sheet.current?.focus({ preventScroll: true });
    viewport?.addEventListener("resize", scheduleResize);
    window.addEventListener("resize", scheduleResize);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      viewport?.removeEventListener("resize", scheduleResize);
      window.removeEventListener("resize", scheduleResize);
      modal.close();
      root.style.overflow = prevRootOverflow;
      document.body.style.overflow = prevBodyOverflow;
      previous?.focus({ preventScroll: true });
    };
  }, []);

  function keepFieldVisible(event: FocusEvent<HTMLDivElement>) {
    syncViewportRef.current();
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.matches("input, textarea, select")) return;
    window.setTimeout(() => {
      if (!modalBody.current || !modalBody.current.contains(target)) return;
      target.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, 120);
  }

  function chooseFood(choice: FoodChoice) {
    if (choice.food?.foodType === "drink" && !editingMeal && items.every((item) => !item.name.trim())) setCategory("drinks");
    setSelectedFood(choice);
    const incoming: DraftItem[] = choice.items.map((item) => {
      const draft: DraftItem = { key: crypto.randomUUID(), name: item.name,
        amount: item.amount == null ? "" : String(item.amount), unit: item.unit,
        calories: toStr(item.calories), proteinG: toStr(item.proteinG), carbsG: toStr(item.carbsG),
        fatG: toStr(item.fatG), fibreG: toStr(item.fibreG), calMin: toStr(item.calMin), calMax: toStr(item.calMax),
        estimationMethod: item.estimationMethod, savedFoodId: item.savedFoodId ?? null,
        foodSnapshot: item.foodSnapshot ?? null, portionId: item.portionId, portionLabel: item.portionLabel,
        gramWeight: item.gramWeight, millilitreVolume: item.millilitreVolume };
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

  function changeFoodPortion(item: DraftItem, id: string, amount: string): DraftItem {
    if (!item.foodSnapshot || !amount.trim() || Number(amount) <= 0 || !Number.isFinite(Number(amount))) return { ...item, amount };
    const calculated = calculateFoodPortion(item.foodSnapshot, id, Number(amount));
    return { ...item, amount, unit: calculated.unit, portionId: id, portionLabel: calculated.portionLabel,
      gramWeight: calculated.gramWeight, millilitreVolume: calculated.millilitreVolume,
      calories: toStr(calculated.calories), proteinG: toStr(calculated.proteinG), carbsG: toStr(calculated.carbsG),
      fatG: toStr(calculated.fatG), fibreG: toStr(calculated.fibreG), estimationMethod: calculated.estimationMethod };
  }
  async function toggleFavourite(choice: FoodChoice) {
    if (foodBusy) return; setFoodBusy(true); setError("");
    try {
      const payload = choice.savedFoodId ? { action: "favourite", id: choice.savedFoodId, isFavourite: !choice.isFavourite } :
        choice.food ? { action: "save", food: foodToSavedInput(choice.food, true) } : null;
      if (!payload) return;
      const response = await fetch("/api/foods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message ?? "Could not save favourite.");
      setSelectedFood({ ...choice, savedFoodId: result.food.id, isFavourite: result.food.isFavourite });
      setItems((old) => old.map((item) => item.foodSnapshot?.id === choice.food?.id ? { ...item, savedFoodId: result.food.id } : item));
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update favourite."); }
    finally { setFoodBusy(false); }
  }
  async function deleteCustomFood(id: string) {
    if (!window.confirm("Delete this saved food? Previously logged meals are kept.")) return;
    setFoodBusy(true);
    try {
      const response = await fetch("/api/foods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id }) });
      if (!response.ok) throw new Error("Could not delete food.");
      setSelectedFood(null); refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not delete food."); }
    finally { setFoodBusy(false); }
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
        <span className="food-suggestion-emoji" aria-hidden="true">{foodEmoji(choice.name, choice.food?.foodType === "drink" ? "drinks" : undefined)}</span>
        <span className="food-suggestion-copy"><strong>{choice.isFavourite && <Star size={13} aria-label="Favourite" />} {choice.name}</strong><small>{choice.source} · {choice.detail}</small></span>
        <span className="food-suggestion-energy">{choice.items.every((item) => item.calories != null)
          ? `${Math.round(choice.items.reduce((sum, item) => sum + (item.calories ?? 0), 0))} kcal` : "kcal —"}<span className="food-suggestion-plus" aria-hidden="true"><Plus size={15} /></span></span>
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
    modalBody.current?.scrollTo({ top: 0, behavior: "instant" });
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

  async function lookupBarcode(overrideCode?: string) {
    const codeToLookup = (overrideCode ?? barcode).trim();
    if (!codeToLookup) return;
    setError("");
    setBarcodeProduct(null);
    setLookupBusy(true);
    try {
      const res = await fetch(`/api/foods?barcode=${encodeURIComponent(codeToLookup)}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message ?? "Barcode lookup failed.");
      const food: FoodDefinition = payload.food; setBarcodeDefinition(food);
      setBarcodeProduct({ barcode: codeToLookup, name: food.name, brand: food.brand, servingSizeLabel: food.portions.find((p) => p.id === "label-serving")?.label ?? null,
        basisAmount: food.basisAmount, basisUnit: food.basisUnit as "g" | "ml", calories: food.calories ?? null, proteinG: food.proteinG ?? null, carbsG: food.carbsG ?? null, fatG: food.fatG ?? null, fibreG: food.fibreG ?? null, source: "Open Food Facts" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Barcode lookup failed.");
    } finally {
      setLookupBusy(false);
    }
  }

  function addBarcodeProduct() {
    if (!barcodeProduct) return;
    if (barcodeDefinition) {
      const quantity = toNum(barcodeGrams) ?? 100;
      chooseFood({ ...definitionChoice(barcodeDefinition), items: [calculateFoodPortion(barcodeDefinition, barcodeDefinition.basisUnit, quantity)] });
      setBarcodeProduct(null); return;
    }
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
        foodSnapshot: i.foodSnapshot ?? null, portionId: i.portionId, portionLabel: i.portionLabel,
        gramWeight: i.gramWeight, millilitreVolume: i.millilitreVolume,
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
    <dialog ref={dialog} className="modal-backdrop meal-screen" aria-labelledby="meal-dialog-title"
      onCancel={(event) => { event.preventDefault(); if (!working) onClose(); }}>
      <div
        ref={sheet}
        tabIndex={-1}
        className="modal-sheet"
        data-keyboard={keyboardOpen ? "open" : "closed"}
        aria-busy={working}
        onBlurCapture={() => syncViewportRef.current()}
      >
        <div className="modal-top">
          <div className="sheet-grabber" aria-hidden="true" />
          <div className="split-row modal-header">
            <h2 id="meal-dialog-title">{creatingFood ? (editingCustom ? "Edit saved food" : "New custom food") : (editingMeal ? "Edit meal" : "Log a meal")}</h2>
            <div className="modal-header-actions">
              {keyboardOpen && (
                <button
                  type="button"
                  className="secondary compact modal-done-btn"
                  onClick={() => (document.activeElement as HTMLElement | null)?.blur()}
                >
                  Done
                </button>
              )}
              {keyboardOpen && !creatingFood && sourceTab === "manual" && (
                <button type="button" className="compact" disabled={working} onClick={() => void handleSubmit(false)}>
                  {working ? "Saving…" : editingMeal ? "Save changes" : "Save meal"}
                </button>
              )}
              <button type="button" className="secondary compact modal-close-btn" disabled={working} onClick={onClose} aria-label="Close composer">
                <X size={18} />
              </button>
            </div>
          </div>

          {!creatingFood && (
            <div className="seg-tabs" role="group" aria-label="Food source">
              {(
                [
                  ["recent", "Search"],
                  ["recipes", "Recipes"],
                  ["uk", "Barcode"],
                  ["manual", `Meal (${items.filter((i) => i.name.trim()).length || items.length})`],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={sourceTab === key}
                  onClick={() => {
                    setSourceTab(key);
                    setActiveFoodKey(null);
                    setQuery("");
                    setActiveSuggestion(-1);
                    modalBody.current?.scrollTo({ top: 0, behavior: "instant" });
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div ref={modalBody} className="modal-body" onFocusCapture={keepFieldVisible}>
          {error && <p role="alert" className="form-error">{error}</p>}
          {creatingFood ? (
            <CustomFoodForm
              editing={editingCustom}
              onCancel={() => { setCreatingFood(false); setEditingCustom(undefined); }}
              onDone={(name) => { setCreatingFood(false); setEditingCustom(undefined); refresh(); setQuery(name); setFilter("mine"); setSourceTab("recent"); }}
            />
          ) : (
            <>
              {(sourceTab === "recent" || sourceTab === "recipes") && (
                <div className="search-dock">
                  <label htmlFor="meal-food-search" className={keyboardOpen ? "sr-only" : "search-field-label"}>
                    {sourceTab === "recent" ? "Find a food" : "Find a saved recipe"}
                  </label>
                  <div className="search-field-row">
                    <Search size={16} className="search-field-icon" aria-hidden="true" />
                    <input
                      id="meal-food-search"
                      type="search"
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={sourceTab === "recent" && suggestions.length > 0}
                      aria-controls="food-search-results"
                      aria-activedescendant={activeSuggestion >= 0 ? `food-search-results-${activeSuggestion}` : undefined}
                      value={query}
                      onChange={(e) => { setQuery(e.target.value); setActiveSuggestion(-1); }}
                      onKeyDown={(event) => suggestionKeys(event, suggestions)}
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck={false}
                      placeholder={sourceTab === "recent" ? "Food or brand, e.g. eggs, Huel, Alpro…" : "Filter saved recipes…"}
                      enterKeyHint="search"
                    />
                    {query && (
                      <button
                        type="button"
                        className="search-clear-btn"
                        aria-label="Clear search"
                        onClick={() => { setQuery(""); setActiveSuggestion(-1); }}
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                  {sourceTab === "recent" && (
                    <div className="food-filter-row" role="group" aria-label="Food filters">
                      {([["all", "All"], ["favourites", "Favourites"], ["mine", "My foods"], ["drinks", "Drinks"]] as const).map(([key, label]) => (
                        <button type="button" key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {sourceTab === "recent" && (
                <section className="food-search-panel" aria-label="Find food">
                  {!keyboardOpen && (
                    <p className="search-hint">
                      Your foods, {library?.catalogueCount?.toLocaleString("en-GB") ?? "2,887"} UK reference foods and branded products
                    </p>
                  )}
                  {suggestionList(suggestions, "food-search-results")}
                  <p className="search-hint search-status" role="status">
                    {failed ? "Your food library is unavailable. Please try again." : searching ? "Searching your foods and the UK catalogue…" : productSearching ? "Searching branded products…" : `${suggestions.length} suggestions`}
                  </p>
                  {providerMessage && <p className="search-hint">{providerMessage}</p>}
                  {!keyboardOpen && query.trim().length >= 3 && (
                    <p className="search-hint">
                      Branded data from <a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts</a>. Check against your packet label.
                    </p>
                  )}
                  {suggestions.length === 0 && !searching && (
                    <p className="search-hint">No matches yet. You can create a custom food or enter nutrition manually.</p>
                  )}
                  <div className="search-fallback-actions">
                    <button type="button" className="secondary" onClick={() => { setEditingCustom(undefined); setCreatingFood(true); }}>
                      Create custom food or drink
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={working}
                      onClick={() => {
                        if (query.trim()) {
                          setItems((prev) => {
                            const copy = [...prev];
                            const blank = copy.findIndex((item) => !item.name.trim());
                            if (blank >= 0) copy[blank] = { ...copy[blank], name: query.trim() };
                            else copy.push({ ...emptyItem(), name: query.trim() });
                            return copy;
                          });
                        }
                        setSourceTab("manual");
                        setQuery("");
                        modalBody.current?.scrollTo({ top: 0, behavior: "instant" });
                      }}
                    >
                      Enter food manually
                    </button>
                  </div>
                </section>
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
                      <button type="button" disabled={working} onClick={() => void submitRecipe()}>Save batch recipe</button>
                    </div>
                  )}

                  {library?.saved.length === 0 && <p>No saved recipes or templates yet.</p>}
                  {library?.saved
                    .filter((food) => !query.trim() || food.name.toLowerCase().includes(query.trim().toLowerCase()))
                    .map((food) => (
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
                      <button
                        type="button"
                        className="secondary compact"
                        disabled={working}
                        aria-pressed={scannerOpen}
                        onClick={() => setScannerOpen((open) => !open)}
                      >
                        <Camera size={15} /> {scannerOpen ? "Hide camera" : "Scan"}
                      </button>
                    </div>
                    {scannerOpen && (
                      <BarcodeScanner
                        onDetected={(code) => {
                          setBarcode(code);
                          setScannerOpen(false);
                          void lookupBarcode(code);
                        }}
                        onClose={() => setScannerOpen(false)}
                      />
                    )}
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
                <div className="manual-meal-form">
                  {selectedFood && (
                    <div className="selected-food-tools">
                      <span>{selectedFood.name}</span>
                      {(selectedFood.food || selectedFood.savedFoodId) && (
                        <button type="button" className="secondary compact" disabled={foodBusy} onClick={() => void toggleFavourite(selectedFood)}>
                          <Star size={16} fill={selectedFood.isFavourite ? "currentColor" : "none"} />
                          {selectedFood.isFavourite ? "Remove favourite" : "Favourite food"}
                        </button>
                      )}
                      {selectedFood.savedFoodId && (
                        <>
                          <button type="button" className="secondary compact" onClick={() => { setEditingCustom(library?.saved.find((food) => food.id === selectedFood.savedFoodId)); setCreatingFood(true); }}>
                            Edit saved food
                          </button>
                          <button type="button" className="danger compact" disabled={foodBusy} onClick={() => void deleteCustomFood(selectedFood.savedFoodId!)}>
                            Delete saved food
                          </button>
                        </>
                      )}
                    </div>
                  )}
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
                      <div className="card food-item-card" key={item.key}>
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
                          <label className="food-name-field">
                            Food name
                            <input
                              value={item.name}
                              role="combobox"
                              autoComplete="off"
                              aria-autocomplete="list"
                              aria-expanded={activeFoodKey === item.key && suggestions.length > 0}
                              aria-controls={`food-options-${item.key}`}
                              aria-activedescendant={activeFoodKey === item.key && activeSuggestion >= 0 ? `food-options-${item.key}-${activeSuggestion}` : undefined}
                              onFocus={() => { setActiveFoodKey(item.key); setQuery(item.name); setActiveSuggestion(-1); }}
                              onChange={(e) => {
                                setItems((p) => p.map((x) => (x.key === item.key ? { ...x, name: e.target.value, foodSnapshot: null, portionId: null } : x)));
                                setActiveFoodKey(item.key);
                                setQuery(e.target.value);
                                setActiveSuggestion(-1);
                              }}
                              onKeyDown={(event) => suggestionKeys(event, suggestions.filter((choice) => choice.items.length === 1))}
                              placeholder="e.g. Eggs"
                            />
                          </label>
                          {activeFoodKey === item.key && item.name.trim() && (
                            <div className="inline-food-suggestions">
                              {suggestionList(suggestions.filter((choice) => choice.items.length === 1), `food-options-${item.key}`)}
                              <button className="secondary compact" type="button" onClick={() => setActiveFoodKey(null)}>Keep my entry</button>
                            </div>
                          )}
                          <label>
                            Portion
                            <div className="portion-pair">
                              <input
                                aria-label="Portion amount"
                                inputMode="decimal"
                                value={item.amount}
                                onChange={(e) =>
                                  setItems((p) => p.map((x) => (x.key === item.key ? (x.foodSnapshot && x.portionId ? changeFoodPortion(x, x.portionId, e.target.value) : { ...x, basis: x.basis ?? portionBasis(x), amount: e.target.value, ...scalePortion(x.basis ?? portionBasis(x), e.target.value) }) : x)))
                                }
                                placeholder="g / ml"
                              />
                              {item.foodSnapshot ? (
                                <select
                                  aria-label="Portion measure"
                                  value={item.portionId ?? item.foodSnapshot.defaultPortionId}
                                  onChange={(event) => {
                                    const id = event.target.value;
                                    setItems((old) => old.map((row) => row.key !== item.key ? row : changeFoodPortion(row, id, String(row.foodSnapshot!.portions.find((p) => p.id === id)!.defaultAmount))));
                                  }}
                                >
                                  {item.foodSnapshot.portions.map((measure) => <option key={measure.id} value={measure.id}>{measure.label}</option>)}
                                </select>
                              ) : (
                                <select
                                  aria-label="Portion unit"
                                  value={item.unit}
                                  onChange={(event) => setItems((old) => old.map((row) => row.key === item.key ? { ...row, unit: event.target.value as FoodUnit, gramWeight: null, millilitreVolume: null } : row))}
                                >
                                  {UNITS.map((unit) => <option key={unit} value={unit}>{UNIT_LABELS[unit]}</option>)}
                                </select>
                              )}
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

                        {item.foodSnapshot && (
                          <p className="search-hint">
                            {item.gramWeight != null ? `${Number(item.gramWeight.toFixed(1))} g` : ""}
                            {item.millilitreVolume != null ? ` · ${Number(item.millilitreVolume.toFixed(1))} ml` : ""}
                            {" · "}
                            {item.estimationMethod === "standard_portion" ? "Estimated portion" : "Nutrition scaled from label/reference"}. You can edit the values.
                          </p>
                        )}
                        <div className="macro-input-grid">
                          <label className="macro-cal-field">
                            <span>Calories <small>(blank = unknown)</small></span>
                            <input
                              inputMode="decimal"
                              value={item.calories}
                              onChange={(e) =>
                                setItems((p) => p.map((x) => (x.key === item.key ? { ...x, foodSnapshot: null, portionId: null, calories: e.target.value, basis: portionBasis({ ...x, calories: e.target.value }) } : x)))
                              }
                            />
                          </label>
                          <label>
                            Protein (g)
                            <input
                              inputMode="decimal"
                              value={item.proteinG}
                              onChange={(e) =>
                                setItems((p) => p.map((x) => (x.key === item.key ? { ...x, foodSnapshot: null, portionId: null, proteinG: e.target.value, basis: portionBasis({ ...x, proteinG: e.target.value }) } : x)))
                              }
                            />
                          </label>
                          <label>
                            <span>Fibre (g) <small>(optional)</small></span>
                            <input
                              inputMode="decimal"
                              value={item.fibreG}
                              onChange={(e) =>
                                setItems((p) => p.map((x) => (x.key === item.key ? { ...x, foodSnapshot: null, portionId: null, fibreG: e.target.value, basis: portionBasis({ ...x, fibreG: e.target.value }) } : x)))
                              }
                            />
                          </label>
                          <label>
                            Carbs (g)
                            <input
                              inputMode="decimal"
                              value={item.carbsG}
                              onChange={(e) =>
                                setItems((p) => p.map((x) => (x.key === item.key ? { ...x, foodSnapshot: null, portionId: null, carbsG: e.target.value, basis: portionBasis({ ...x, carbsG: e.target.value }) } : x)))
                              }
                            />
                          </label>
                          <label>
                            Fat (g)
                            <input
                              inputMode="decimal"
                              value={item.fatG}
                              onChange={(e) =>
                                setItems((p) => p.map((x) => (x.key === item.key ? { ...x, foodSnapshot: null, portionId: null, fatG: e.target.value, basis: portionBasis({ ...x, fatG: e.target.value }) } : x)))
                              }
                            />
                          </label>
                          <label className="macro-range-field">
                            Est. kcal range <small>(min / max)</small>
                            <div style={{ display: "flex", gap: ".35rem" }}>
                              <input
                                inputMode="decimal"
                                placeholder="Min"
                                value={item.calMin}
                                onChange={(e) =>
                                  setItems((p) => p.map((x) => (x.key === item.key ? { ...x, foodSnapshot: null, portionId: null, calMin: e.target.value, basis: portionBasis({ ...x, calMin: e.target.value }) } : x)))
                                }
                              />
                              <input
                                inputMode="decimal"
                                placeholder="Max"
                                value={item.calMax}
                                onChange={(e) =>
                                  setItems((p) => p.map((x) => (x.key === item.key ? { ...x, foodSnapshot: null, portionId: null, calMax: e.target.value, basis: portionBasis({ ...x, calMax: e.target.value }) } : x)))
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
                </div>
              )}
            </>
          )}
        </div>

        {!creatingFood && sourceTab === "manual" && !keyboardOpen && (
          <div className="modal-footer">
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
