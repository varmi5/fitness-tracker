"use client";
import { useEffect, useState } from "react";
import { macroEnergy, macroTargetInput, rebalanceMacros, type MacroPlan } from "../lib/macro-targets";
export function MacroTargetEditor({ initial, today, busy, onSave }: { initial: MacroPlan; today: string; busy: boolean; onSave: (action: object, message: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(Object.entries(initial).map(([key, val]) => [key, String(val)])));
  const [effectiveFrom, setEffectiveFrom] = useState(today); const [error, setError] = useState("");
  useEffect(() => {
    setDraft(Object.fromEntries(Object.entries(initial).map(([key, val]) => [key, String(val)])));
  }, [initial.calories, initial.proteinG, initial.carbsG, initial.fatG, initial.fibreG]);
  const plan = Object.fromEntries(Object.entries(draft).map(([key, val]) => [key, Number(val)])) as MacroPlan;
  const energy = macroEnergy(plan);
  const labels = [["calories", "Daily calories (kcal)"], ["proteinG", "Protein target (g)"], ["carbsG", "Carbohydrate target (g)"], ["fatG", "Fat target (g)"], ["fibreG", "Fibre target (g)"]];
  function rebalance() { try { const result = rebalanceMacros(plan); setDraft(Object.fromEntries(Object.entries(result).map(([key, val]) => [key, String(val)]))); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Check the targets."); } }
  return <form onSubmit={async (event) => { event.preventDefault(); const parsed = macroTargetInput.safeParse({ ...plan, effectiveFrom }); if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check your targets."); return; } if (await onSave({ action: "macro-targets", data: parsed.data }, "Nutrition targets saved.")) setError(""); }}>
    <h3>Your daily nutrition targets</h3><p className="search-hint">Targets are private to your account. Changes apply from the date you choose.</p>
    <div className="input-grid">{labels.map(([key, label]) => <label key={key}>{label}<input inputMode="decimal" required value={draft[key]} onChange={(e) => setDraft((old) => ({ ...old, [key]: e.target.value }))} /></label>)}
      <label>Effective from<input type="date" required value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} /></label>
    </div>
    <p className="search-hint">Macro energy: {Number.isFinite(energy) ? energy : "—"} kcal / {draft.calories} kcal. Protein and carbs use 4 kcal/g; fat uses 9. Fibre has a separate target.</p>
    <div className="button-row"><button type="button" className="secondary" onClick={rebalance}>Rebalance carbs &amp; fat</button><button type="submit" disabled={busy}>Save nutrition targets</button></div>
    <p className="search-hint">Rebalance keeps your chosen protein target and adjusts carbs and fat to fit your calorie budget.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}
