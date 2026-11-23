import type {
  DailyNutritionView,
  EnergyRecord,
  MealRecord,
  nutritionData,
  RecoveryRecord,
  SleepRecord,
  TrackingMode,
  WorkoutRecord,
} from "../lib/nutrition-data";
import type { EstimationMethod } from "../lib/nutrition-model";
import type { DailyStrainView } from "../lib/strain-data";
import type { RecoveryInsightView } from "../lib/recovery-insights";
import type { StrainSettings } from "../lib/strain-engine";
import type { trackerData } from "../lib/tracker-data";

export type { DailyStrainView, EnergyRecord, RecoveryInsightView, RecoveryRecord, SleepRecord, StrainSettings, TrackingMode, WorkoutRecord };
export type TrackerSnapshot = Awaited<ReturnType<ReturnType<typeof trackerData>["snapshot"]>>;
export type NutritionSettings = Awaited<ReturnType<ReturnType<typeof nutritionData>["settings"]>> & {
  trackingMode: TrackingMode;
  bulkMode?: boolean;
};
export type NutritionHistory = Awaited<ReturnType<ReturnType<typeof nutritionData>["history"]>>;
export type HistoryDay = NutritionHistory["days"][number];
export type FoodLibrary = Awaited<ReturnType<ReturnType<typeof nutritionData>["library"]>>;
export type AuditEntry = Awaited<ReturnType<ReturnType<typeof nutritionData>["recentAudit"]>>[number];

export interface GoogleIntegrationStatus {
  available: boolean;
  connected: boolean;
  accountLabel: string | null;
  status: string | null;
  lastSync: string | null;
  lastError: string | null;
  canReadWeights: boolean;
  canReadSleep: boolean;
  canWriteWeights: boolean;
  canReadNutrition: boolean;
  canWriteNutrition: boolean;
  mealSync?: { pending: number; failed: number; verified?: number; lastVerifiedAt?: string | null; lastError: string | null };
}

export interface HevyIntegrationStatus {
  oauthAvailable: boolean;
  connected: boolean;
  accountLabel: string | null;
  status: string | null;
  lastSync: string | null;
  lastError: string | null;
  workoutCount: number;
}

export interface InitialAppData {
  tracker: TrackerSnapshot;
  settings: NutritionSettings;
  today: string;
  calendarToday: string;
  activeDay: string;
  waitingForSleep?: boolean;
  showSleep: boolean;
  daily: DailyNutritionView;
  history30: NutritionHistory;
  google: GoogleIntegrationStatus;
  hevy: HevyIntegrationStatus;
  strain: DailyStrainView;
  strainSettings: StrainSettings;
  recoveryInsights?: RecoveryInsightView;
  audit: AuditEntry[];
  mcpEnabled: boolean;
  syncToken: string;
}

export type AppTab = "Home" | "Training" | "Nutrition" | "More";
export type MoreSection = "Measurements" | "Settings";
export type ThemeMode = "light" | "dark";

export const METHOD_LABELS: Record<EstimationMethod, string> = {
  weighed: "Weighed",
  measured: "Measured",
  pack_label: "Pack label",
  recipe: "Recipe",
  photo_estimate: "Photo estimate",
  standard_portion: "Portion estimate",
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
