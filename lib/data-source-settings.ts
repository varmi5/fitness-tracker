import { z } from "zod";

export const SOURCE_METRICS = {
  workouts: "Workouts",
  sleep: "Sleep",
  heartRate: "Heart rate",
  restingHrBpm: "Resting heart rate",
  hrvRmssdMs: "Heart rate variability",
  respiratoryRate: "Respiratory rate",
  spo2Pct: "Blood oxygen",
  skinTempDeltaC: "Skin temperature",
  vo2Max: "VO₂ max",
  bodyFatPct: "Body fat",
  energy: "Calories burned",
  steps: "Steps",
  weight: "Weight",
} as const;

export const RECOVERY_FIELDS = ["restingHrBpm", "hrvRmssdMs", "respiratoryRate", "spo2Pct", "skinTempDeltaC", "vo2Max", "bodyFatPct"] as const;

const sourceId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);
const rule = z.object({
  priority: z.array(sourceId).max(30),
  hidden: z.array(sourceId).max(30),
});
export const sourceSettingsInput = z.partialRecord(z.enum(Object.keys(SOURCE_METRICS) as [keyof typeof SOURCE_METRICS, ...(keyof typeof SOURCE_METRICS)[]]), rule);
export type SourceSettings = z.infer<typeof sourceSettingsInput>;
export type SourceMetric = keyof typeof SOURCE_METRICS;
export type SourceRule = z.infer<typeof rule>;
export type SourcePreference = SourceRule | string | null | undefined;

export function metricPreference(settings: SourceSettings, metric: SourceMetric, legacy?: string): SourcePreference {
  return settings[metric] ?? legacy;
}
