import { z } from "zod";

export const CATEGORIES = ["breakfast", "lunch", "dinner", "snacks", "drinks"] as const;
export const UNITS = ["g", "kg", "oz", "ml", "l", "tsp", "tbsp", "cup", "fl_oz", "item", "slice", "piece", "scoop", "serving", "bottle", "can", "pack"] as const;
export const ESTIMATION_METHODS = ["weighed", "measured", "pack_label", "recipe", "photo_estimate", "standard_portion"] as const;
export const ENERGY_SOURCES = ["google", "manual", "apple"] as const;
export const TRACKING_MODES = ["manual", "fitbit"] as const;

export type MealCategory = (typeof CATEGORIES)[number];
export type FoodUnit = (typeof UNITS)[number];
export type EstimationMethod = (typeof ESTIMATION_METHODS)[number];
export type EnergySource = (typeof ENERGY_SOURCES)[number];
export type TrackingMode = (typeof TRACKING_MODES)[number];

export const DEFAULT_CALORIE_TARGET = 1900;
export const DEFAULT_TIMEZONE = "Europe/London";

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localDay(isoOrDate: string | Date, timezone = DEFAULT_TIMEZONE): string {
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function localTime(isoOrDate: string | Date, timezone = DEFAULT_TIMEZONE): string {
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return formatted.startsWith("24:") ? "00:" + formatted.slice(3) : formatted;
}

function timezoneOffsetMinutes(utcGuessMs: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcGuessMs));
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const hour = map.hour === "24" ? "00" : map.hour;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(hour),
    Number(map.minute),
    Number(map.second),
  );
  return (asUtc - utcGuessMs) / 60000;
}

export function resolveLocalDateTime(day: string, time = "12:00", timezone = DEFAULT_TIMEZONE): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const utcNaive = Date.UTC(y, m - 1, d, hh, mm, 0);
  const offset1 = timezoneOffsetMinutes(utcNaive, timezone);
  let candidate = utcNaive - offset1 * 60000;
  const offset2 = timezoneOffsetMinutes(candidate, timezone);
  if (offset2 !== offset1) {
    candidate = utcNaive - offset2 * 60000;
  }
  return new Date(candidate);
}

export function addDays(day: string, offset: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let cur = from; cur <= to; cur = addDays(cur, 1)) {
    out.push(cur);
    if (out.length > 400) break;
  }
  return out;
}

export function resolveActiveHomeDay(input: {
  calendarToday: string;
}): { activeDay: string; waitingForSleep: boolean } {
  return { activeDay: input.calendarToday, waitingForSleep: false };
}

export function isDayComplete(day: string, activeDay: string): boolean {
  return day < activeDay;
}

export function resolveTrackingPreferences(
  input: { trackingMode?: TrackingMode; preferredEnergySource?: EnergySource },
  existing?: { trackingMode?: TrackingMode; preferredEnergySource?: EnergySource },
): { trackingMode: TrackingMode; preferredEnergySource: EnergySource } {
  if (input.trackingMode !== undefined) {
    return {
      trackingMode: input.trackingMode,
      preferredEnergySource: input.trackingMode === "fitbit" ? "google" : "manual",
    };
  }
  if (input.preferredEnergySource !== undefined) {
    if (input.preferredEnergySource === "google") {
      return { trackingMode: "fitbit", preferredEnergySource: "google" };
    }
    return { trackingMode: "manual", preferredEnergySource: input.preferredEnergySource };
  }
  const mode = existing?.trackingMode ?? (existing?.preferredEnergySource === "google" ? "fitbit" : "manual");
  return {
    trackingMode: mode,
    preferredEnergySource: mode === "fitbit" ? "google" : (existing?.preferredEnergySource === "apple" ? "apple" : "manual"),
  };
}

const optionalNonNegative = z.number().finite().min(0).max(50000).nullable().optional();

export const foodQualityMetaInput = z.object({
  cofidGroup: z.string().max(16).optional(),
  sugarsG: optionalNonNegative,
  saturatedFatG: optionalNonNegative,
  sodiumMg: optionalNonNegative,
  nutriScoreGrade: z.enum(["a", "b", "c", "d", "e"]).nullable().optional(),
  nutriScoreScore: z.number().finite().min(-30).max(55).nullable().optional(),
  novaGroup: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable().optional(),
  categoriesTags: z.array(z.string().max(80)).max(24).optional(),
  ingredientsText: z.string().max(500).optional(),
}).optional();

export type FoodQualityMeta = NonNullable<z.infer<typeof foodQualityMetaInput>>;

export const foodMeasureInput = z.object({
  id: z.string().min(1).max(64), label: z.string().trim().min(1).max(100), unit: z.enum(UNITS),
  baseAmount: z.number().finite().positive().max(100000), defaultAmount: z.number().finite().positive().max(20000).default(1),
  estimated: z.boolean().default(false),
});
export const foodSnapshotInput = z.object({
  id: z.string().max(160), name: z.string().trim().min(1).max(160), brand: z.string().max(120).default(""),
  foodType: z.enum(["food", "drink"]).default("food"), source: z.string().max(80),
  sourceUrl: z.url().max(600).nullable().optional(),
  basisAmount: z.number().positive().max(50000), basisUnit: z.enum(UNITS),
  calories: optionalNonNegative, proteinG: optionalNonNegative, carbsG: optionalNonNegative, fatG: optionalNonNegative, fibreG: optionalNonNegative,
  portions: z.array(foodMeasureInput).min(1).max(30), defaultPortionId: z.string().max(64),
  qualityMeta: foodQualityMetaInput,
});

export const mealItemInput = z.object({
  id: z.string().max(64).optional(),
  name: z.string().trim().min(1).max(160),
  amount: z.number().finite().positive().max(20000).nullable().optional(),
  unit: z.enum(UNITS).default("g"),
  calories: optionalNonNegative,
  proteinG: optionalNonNegative,
  carbsG: optionalNonNegative,
  fatG: optionalNonNegative,
  fibreG: optionalNonNegative,
  calMin: optionalNonNegative,
  calMax: optionalNonNegative,
  estimationMethod: z.enum(ESTIMATION_METHODS).default("photo_estimate"),
  savedFoodId: z.string().max(64).nullable().optional(),
  portionLabel: z.string().max(100).nullable().optional(), portionId: z.string().max(64).nullable().optional(),
  gramWeight: z.number().finite().positive().max(100000).nullable().optional(),
  millilitreVolume: z.number().finite().positive().max(100000).nullable().optional(),
  foodSnapshot: foodSnapshotInput.nullable().optional(),
}).refine(
  (item) => item.calMin == null || item.calMax == null || item.calMax >= item.calMin,
  { message: "Maximum calorie estimate must be greater than or equal to minimum estimate." },
);

export type MealItemInput = z.infer<typeof mealItemInput>;

export const logMealInput = z.object({
  consumedAt: z.iso.datetime({ offset: true }).optional(),
  day: z.iso.date().optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  name: z.string().trim().min(1).max(160),
  category: z.enum(CATEGORIES),
  cookingMethod: z.string().trim().max(240).optional().default(""),
  ingredients: z.string().trim().max(2000).optional().default(""),
  notes: z.string().trim().max(1000).optional().default(""),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
  items: z.array(mealItemInput).min(1).max(50),
});

export type LogMealInput = z.infer<typeof logMealInput>;

export const updateMealInput = z.object({
  id: z.uuid(),
  consumedAt: z.iso.datetime({ offset: true }).optional(),
  day: z.iso.date().optional(),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  category: z.enum(CATEGORIES).optional(),
  cookingMethod: z.string().trim().max(240).optional(),
  ingredients: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(1000).optional(),
  items: z.array(mealItemInput).min(1).max(50).optional(),
  appendItems: z.array(mealItemInput).min(1).max(25).optional(),
  idempotencyKey: z.string().trim().min(1).max(128).optional(),
});

export type UpdateMealInput = z.infer<typeof updateMealInput>;

export const historyInput = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
}).refine((r) => r.from <= r.to, { message: "Start date must be on or before end date." })
  .refine((r) => addDays(r.from, 366) >= r.to, { message: "Date range cannot exceed 366 days." });

export const energyInput = z.object({
  day: z.iso.date(),
  source: z.enum(ENERGY_SOURCES).default("manual"),
  totalKcal: z.number().finite().min(0).max(20000).nullable().optional(),
  activeKcal: z.number().finite().min(0).max(15000).nullable().optional(),
  steps: z.number().int().min(0).max(250000).nullable().optional(),
  activeZoneMinutes: z.number().int().min(0).max(5000).nullable().optional(),
  distanceMeters: z.number().finite().min(0).max(500000).nullable().optional(),
  floors: z.number().int().min(0).max(50000).nullable().optional(),
  weightKg: z.number().finite().positive().max(500).nullable().optional(),
  complete: z.boolean().default(true),
});

export const sleepStageInput = z.object({
  stage: z.enum(["AWAKE", "LIGHT", "DEEP", "REM"]),
  minutes: z.number().int().min(0).max(1440),
});

export const sleepInput = z.object({
  day: z.iso.date(),
  source: z.enum(ENERGY_SOURCES).default("google"),
  sessionId: z.string().max(160).nullable().optional(),
  sleepStart: z.iso.datetime({ offset: true }).nullable().optional(),
  sleepEnd: z.iso.datetime({ offset: true }).nullable().optional(),
  minutesAsleep: z.number().int().min(0).max(1440),
  minutesAwake: z.number().int().min(0).max(1440).nullable().optional(),
  deepMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  remMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  lightMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  stagesJson: z.array(sleepStageInput).max(12).optional().default([]),
});

export function computeSleepEfficiencyPct(
  minutesAsleep: number | null | undefined,
  minutesAwake: number | null | undefined,
): number | null {
  if (
    minutesAsleep == null ||
    minutesAwake == null ||
    !Number.isFinite(minutesAsleep) ||
    !Number.isFinite(minutesAwake) ||
    minutesAsleep < 0 ||
    minutesAwake < 0
  ) {
    return null;
  }
  const total = minutesAsleep + minutesAwake;
  if (total <= 0) return null;
  return Math.round((minutesAsleep / total) * 100);
}

export interface SleepRecord {
  day: string;
  source: EnergySource;
  sessionId: string | null;
  sleepStart: string | null;
  sleepEnd: string | null;
  minutesAsleep: number;
  minutesAwake: number | null;
  deepMinutes: number | null;
  remMinutes: number | null;
  lightMinutes: number | null;
  sleepEfficiencyPct: number | null;
  stages: { stage: "AWAKE" | "LIGHT" | "DEEP" | "REM"; minutes: number }[];
  syncedAt: string;
}

export const recoveryInput = z.object({
  day: z.iso.date(),
  source: z.enum(ENERGY_SOURCES).default("google"),
  restingHrBpm: z.number().finite().positive().max(300).nullable().optional(),
  hrvRmssdMs: z.number().finite().min(0).max(1000).nullable().optional(),
  spo2Pct: z.number().finite().min(0).max(100).nullable().optional(),
  respiratoryRate: z.number().finite().positive().max(120).nullable().optional(),
  skinTempDeltaC: z.number().finite().min(-20).max(20).nullable().optional(),
  vo2Max: z.number().finite().positive().max(150).nullable().optional(),
  bodyFatPct: z.number().finite().positive().max(100).nullable().optional(),
});

export interface RecoveryRecord {
  day: string;
  source: EnergySource;
  restingHrBpm: number | null;
  hrvRmssdMs: number | null;
  spo2Pct: number | null;
  respiratoryRate: number | null;
  skinTempDeltaC: number | null;
  vo2Max: number | null;
  bodyFatPct: number | null;
  syncedAt: string;
}

export const workoutInput = z.object({
  day: z.iso.date(),
  source: z.enum(ENERGY_SOURCES).default("google"),
  sessionId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  exerciseType: z.string().trim().max(120).optional().default(""),
  startTime: z.iso.datetime({ offset: true }).nullable().optional(),
  endTime: z.iso.datetime({ offset: true }).nullable().optional(),
  durationSeconds: z.number().int().min(0).max(604800).nullable().optional(),
  caloriesKcal: z.number().finite().min(0).max(25000).nullable().optional(),
  distanceMeters: z.number().finite().min(0).max(500000).nullable().optional(),
  avgHrBpm: z.number().finite().positive().max(300).nullable().optional(),
  activeZoneMinutes: z.number().int().min(0).max(5000).nullable().optional(),
});

export interface WorkoutRecord {
  day: string;
  source: EnergySource;
  sessionId: string;
  title: string;
  exerciseType: string;
  startTime: string | null;
  endTime: string | null;
  durationSeconds: number | null;
  caloriesKcal: number | null;
  distanceMeters: number | null;
  avgHrBpm: number | null;
  activeZoneMinutes: number | null;
  syncedAt: string;
}

export const targetInput = z.object({
  effectiveFrom: z.iso.date(),
  calories: z.number().int().min(500).max(15000),
});

export const preferencesInput = z.object({
  timezone: z.string().trim().min(1).max(80).refine(isValidTimezone, { message: "Invalid timezone." }),
  trackingMode: z.enum(TRACKING_MODES).optional(),
  preferredEnergySource: z.enum(ENERGY_SOURCES).optional(),
  googleTwoWaySync: z.boolean().optional().default(false),
  sleepRolloverEnabled: z.boolean().optional(),
  bulkMode: z.boolean().optional(),
});

export function isCalorieGoalMet(
  intake: number | null | undefined,
  target: number,
  bulkMode = false,
): boolean | null {
  if (intake == null || !Number.isFinite(intake) || target <= 0) return null;
  return bulkMode ? intake >= target : intake <= target;
}

export const templateInput = z.object({
  id: z.string().max(64).optional(),
  kind: z.enum(["food", "recipe", "template"]).default("food"),
  name: z.string().trim().min(1).max(160),
  brand: z.string().trim().max(120).optional().default(""),
  barcode: z.string().trim().max(64).nullable().optional(),
  defaultAmount: z.number().finite().positive().max(20000).default(100),
  defaultUnit: z.enum(UNITS).default("g"),
  batchCookedGrams: z.number().finite().positive().max(50000).nullable().optional(),
  calories: optionalNonNegative,
  proteinG: optionalNonNegative,
  carbsG: optionalNonNegative,
  fatG: optionalNonNegative,
  fibreG: optionalNonNegative,
  ingredients: z.string().trim().max(2000).optional().default(""),
  cookingMethod: z.string().trim().max(240).optional().default(""),
  itemsJson: z.array(mealItemInput).max(50).nullable().optional(),
  isFavourite: z.boolean().optional(), foodType: z.enum(["food", "drink"]).default("food"),
  portionsJson: z.array(foodMeasureInput).max(30).default([]), defaultPortionId: z.string().max(64).nullable().optional(),
  sourceName: z.string().max(80).default("Custom"), sourceId: z.string().max(160).nullable().optional(),
  sourceUrl: z.url().max(600).nullable().optional(),
});

export interface NutrientSummary {
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fibreG: number | null;
  calMin: number | null;
  calMax: number | null;
  hasUnknownValues: boolean;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function sumNullable(values: (number | null | undefined)[]): number | null {
  let sum = 0;
  let seen = false;
  for (const val of values) {
    if (val != null && Number.isFinite(val)) {
      sum += val;
      seen = true;
    }
  }
  return seen ? round1(sum) : null;
}

export function summarizeItems(
  items: {
    calories?: number | null;
    proteinG?: number | null;
    carbsG?: number | null;
    fatG?: number | null;
    fibreG?: number | null;
    calMin?: number | null;
    calMax?: number | null;
  }[],
): NutrientSummary {
  const calories = sumNullable(items.map((i) => i.calories));
  const proteinG = sumNullable(items.map((i) => i.proteinG));
  const carbsG = sumNullable(items.map((i) => i.carbsG));
  const fatG = sumNullable(items.map((i) => i.fatG));
  const fibreG = sumNullable(items.map((i) => i.fibreG));

  const hasRange = items.some((i) => i.calMin != null || i.calMax != null);
  const calMin = hasRange
    ? sumNullable(items.map((i) => i.calMin ?? i.calories))
    : null;
  const calMax = hasRange
    ? sumNullable(items.map((i) => i.calMax ?? i.calories))
    : null;

  const hasUnknownValues = items.some(
    (i) => i.calories == null || i.proteinG == null || i.carbsG == null || i.fatG == null || i.fibreG == null,
  );

  return { calories, proteinG, carbsG, fatG, fibreG, calMin, calMax, hasUnknownValues };
}

export function resolveTargetForDay(
  targets: { effectiveFrom: string; calories: number }[],
  day: string,
): number {
  const sorted = [...targets]
    .filter((t) => t.effectiveFrom <= day)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  return sorted[0]?.calories ?? DEFAULT_CALORIE_TARGET;
}
