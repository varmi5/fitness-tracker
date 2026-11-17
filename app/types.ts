import type { DailyNutritionView, MealRecord, nutritionData } from "../lib/nutrition-data";
import type { EstimationMethod } from "../lib/nutrition-model";
import type { trackerData } from "../lib/tracker-data";

export type TrackerSnapshot = Awaited<ReturnType<ReturnType<typeof trackerData>["snapshot"]>>;
export type NutritionSettings = Awaited<ReturnType<ReturnType<typeof nutritionData>["settings"]>>;
export type NutritionHistory = Awaited<ReturnType<ReturnType<typeof nutritionData>["history"]>>;
export type FoodLibrary = Awaited<ReturnType<ReturnType<typeof nutritionData>["library"]>>;
export type AuditEntry = Awaited<ReturnType<ReturnType<typeof nutritionData>["recentAudit"]>>[number];

export interface GoogleIntegrationStatus {
  available: boolean;
  connected: boolean;
  status: string | null;
  lastSync: string | null;
  lastError: string | null;
}

export interface InitialAppData {
  tracker: TrackerSnapshot;
  settings: NutritionSettings;
  today: string;
  daily: DailyNutritionView;
  history30: NutritionHistory;
  google: GoogleIntegrationStatus;
  audit: AuditEntry[];
  mcpEnabled: boolean;
}

export type AppTab = "Home" | "Nutrition" | "Measurements" | "Settings";

export const METHOD_LABELS: Record<EstimationMethod, string> = {
  weighed: "Weighed",
  measured: "Measured",
  pack_label: "Pack label",
  recipe: "Recipe",
  photo_estimate: "Photo estimate",
};

export const CATEGORY_LABELS = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snacks: "Snacks",
  drinks: "Drinks",
} as const;

export function fmtKcal(value: number | null | undefined): string {
  return value == null ? "—" : Math.round(value).toLocaleString("en-GB");
}

export function fmtGram(value: number | null | undefined): string {
  return value == null ? "—" : `${Number(value.toFixed(1))} g`;
}

export function fmtRelativeSync(iso: string | null): string {
  if (!iso) return "Never synced";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Recently";
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function mealMethodSummary(meal: MealRecord): EstimationMethod {
  if (meal.items.every((i) => i.estimationMethod === "weighed")) return "weighed";
  if (meal.items.some((i) => i.estimationMethod === "photo_estimate")) return "photo_estimate";
  if (meal.items.some((i) => i.estimationMethod === "recipe")) return "recipe";
  if (meal.items.some((i) => i.estimationMethod === "pack_label")) return "pack_label";
  return "measured";
}
