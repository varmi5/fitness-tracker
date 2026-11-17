export const nutrientFields = ["calories", "proteinG", "carbsG", "fatG", "fibreG", "calMin", "calMax"] as const;
export type NutrientField = typeof nutrientFields[number];
export interface PortionBasis { amount: number; values: Record<NutrientField, string> }

export function portionBasis(item: Record<NutrientField, string> & { amount: string }): PortionBasis | undefined {
  const amount = Number(item.amount);
  return Number.isFinite(amount) && amount > 0 ? {
    amount, values: Object.fromEntries(nutrientFields.map((field) => [field, item[field]])) as Record<NutrientField, string>,
  } : undefined;
}

export function scalePortion(basis: PortionBasis | undefined, rawAmount: string): Partial<Record<NutrientField, string>> {
  const amount = Number(rawAmount);
  if (!basis || !rawAmount.trim() || !Number.isFinite(amount) || amount <= 0) return {};
  return Object.fromEntries(nutrientFields.map((field) => {
    const raw = basis.values[field];
    return [field, raw.trim() === "" ? "" : String(Math.round(Number(raw) * amount / basis.amount * 10) / 10)];
  }));
}
