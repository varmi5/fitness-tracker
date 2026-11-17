"use client";
import { useState } from "react";
import { standardMeasures, UNIT_LABELS } from "../lib/food-catalogue-model";
import { UNITS, templateInput, foodMeasureInput, type FoodUnit } from "../lib/nutrition-model";
import type { FoodLibrary } from "./types";
export function CustomFoodForm({ editing, onDone, onCancel }: { editing?: FoodLibrary["saved"][number]; onDone: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(editing?.name ?? ""); const [brand, setBrand] = useState(editing?.brand ?? "");
  const [foodType, setFoodType] = useState(editing?.foodType ?? "food");
  const [amount, setAmount] = useState(String(editing?.defaultAmount ?? 100));
  const [unit, setUnit] = useState<FoodUnit>((editing?.defaultUnit as FoodUnit) ?? "g");
  const [nutrition, setNutrition] = useState<Record<string, string>>(() => Object.fromEntries(["calories", "proteinG", "carbsG", "fatG", "fibreG"].map((k) => [k, editing?.[k as "calories"] == null ? "" : String(editing[k as "calories"])])));
  const [measureName, setMeasureName] = useState(""); const [measureSize, setMeasureSize] = useState("");
  const [favourite, setFavourite] = useState(editing?.isFavourite ?? true);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function save() {
    setError("");
    const base = Number(amount);
    if (!base || base <= 0) { setError("Enter the quantity that your nutrition values describe."); return; }
    const portions = editing && editing.defaultUnit === unit ? foodMeasureInput.array().parse(editing.portionsJson) : standardMeasures(unit, base);
    if (measureName.trim()) {
      const size = Number(measureSize);
      if (!size || size <= 0) { setError("Enter the weight or volume of your named portion."); return; }
      portions.unshift({ id: "custom-portion", label: `${measureName.trim()} (${size} ${UNIT_LABELS[unit]})`.slice(0, 100), unit: "serving", baseAmount: size, defaultAmount: 1, estimated: true });
    }
    const raw = { id: editing?.id, kind: "food", name, brand, foodType, defaultAmount: base, defaultUnit: unit,
      ...Object.fromEntries(Object.entries(nutrition).map(([k, v]) => [k, v.trim() === "" ? null : Number(v)])),
      isFavourite: favourite, portionsJson: portions, defaultPortionId: portions[0].id, sourceName: "Custom" };
    const parsed = templateInput.safeParse(raw);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the food details."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/foods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", food: parsed.data }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.message ?? "Could not save food.");
      onDone(name.trim());
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save food. Your entries are still here."); }
    finally { setBusy(false); }
  }
  return <section className="custom-food-form" aria-label={editing ? "Edit custom food" : "Create custom food"}>
    <h3>{editing ? "Edit your food" : "Create your own food or drink"}</h3>
    <p className="search-hint">Enter nutrition from your label or recipe. Blank nutrients stay unknown.</p>
    <div className="input-grid">
      <label>Food or drink name<input value={name} maxLength={160} onChange={(e) => setName(e.target.value)} /></label>
      <label>Brand (optional)<input value={brand} maxLength={120} onChange={(e) => setBrand(e.target.value)} /></label>
      <label>Type<select value={foodType} onChange={(e) => { setFoodType(e.target.value); if (!editing) setUnit(e.target.value === "drink" ? "ml" : "g"); }}><option value="food">Food</option><option value="drink">Drink</option></select></label>
      <label>Nutrition is for<input aria-label="Nutrition basis quantity" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>
      <label>Nutrition unit<select value={unit} onChange={(e) => { const next = e.target.value as FoodUnit; setUnit(next); if (!["g", "ml"].includes(next)) setAmount("1"); }}>{UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}</select></label>
      {[["calories", "Calories (kcal)"], ["proteinG", "Protein (g)"], ["carbsG", "Carbohydrates (g)"], ["fatG", "Fat (g)"], ["fibreG", "Fibre (g)"]].map(([key, label]) => <label key={key}>{label}<input inputMode="decimal" value={nutrition[key]} onChange={(e) => setNutrition((n) => ({ ...n, [key]: e.target.value }))} /></label>)}
    </div>
    {["g", "ml"].includes(unit) && <details><summary>Add a named portion (optional)</summary><div className="input-grid">
      <label>Portion name<input value={measureName} onChange={(e) => setMeasureName(e.target.value)} placeholder="e.g. One egg, one scoop, one glass" /></label>
      <label>One portion equals ({unit})<input inputMode="decimal" value={measureSize} onChange={(e) => setMeasureSize(e.target.value)} /></label>
    </div></details>}
    <label className="check-row"><input type="checkbox" checked={favourite} onChange={(e) => setFavourite(e.target.checked)} /> Add to favourites</label>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="button-row"><button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save custom food"}</button><button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </section>;
}
