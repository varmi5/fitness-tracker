import { z } from "zod";
export const macroPlanInput = z.object({ calories: z.number().int().min(500).max(15000), proteinG: z.number().finite().min(0).max(1500),
  carbsG: z.number().finite().min(0).max(3750), fatG: z.number().finite().min(0).max(1600), fibreG: z.number().finite().min(0).max(300) });
export type MacroPlan = z.infer<typeof macroPlanInput>;
export const macroTargetInput = macroPlanInput.extend({ effectiveFrom: z.iso.date() }).refine((plan) => Math.abs(macroEnergy(plan) - plan.calories) <= 1, { message: "Macro calories do not match the calorie target. Use Rebalance before saving." });
export function macroEnergy(plan: Pick<MacroPlan, "proteinG" | "carbsG" | "fatG">) { return Math.round((plan.proteinG * 4 + plan.carbsG * 4 + plan.fatG * 9) * 10) / 10; }
export function rebalanceMacros(raw: MacroPlan): MacroPlan {
  const input = macroPlanInput.parse(raw);
  const remaining = input.calories - input.proteinG * 4;
  if (remaining < 0) throw new Error("The protein target exceeds the calorie budget. Lower protein or raise calories first.");
  const other = input.carbsG * 4 + input.fatG * 9;
  const fatRatio = other > 0 ? input.fatG * 9 / other : .4;
  const fatG = Math.round(remaining * fatRatio / 9 * 10) / 10;
  const carbsG = Math.max(0, Math.round((remaining - fatG * 9) / 4 * 10) / 10);
  return { ...input, fatG, carbsG };
}
export function defaultMacros(calories: number): MacroPlan {
  return rebalanceMacros({ calories, proteinG: Math.round(calories * .3 / 4 * 10) / 10, carbsG: calories * .4 / 4, fatG: calories * .3 / 9, fibreG: 30 });
}
export function resolveMacroTargets(rows: { effectiveFrom: string; calories: number; proteinG?: number | null; carbsG?: number | null; fatG?: number | null; fibreG?: number | null }[], day: string): MacroPlan {
  const row = [...rows].filter((r) => r.effectiveFrom <= day).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const defaults = defaultMacros(row?.calories ?? 1900);
  return row ? { calories: row.calories, proteinG: row.proteinG ?? defaults.proteinG, carbsG: row.carbsG ?? defaults.carbsG, fatG: row.fatG ?? defaults.fatG, fibreG: row.fibreG ?? defaults.fibreG } : defaults;
}
