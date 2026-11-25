import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { addDays } from "./nutrition-model";
import * as schema from "./schema";
import { computePulseRecovery, type PulseRecoveryDayInput } from "./pulse-engine";
import { getPulseInsightsForUser } from "./pulse-data";

export interface RecoverySleepInput {
  minutesAsleep: number;
  deepMinutes: number | null;
  remMinutes: number | null;
  lightMinutes: number | null;
  minutesAwake: number | null;
}

export interface RecoveryVitalsInput {
  restingHrBpm: number | null;
  hrvRmssdMs: number | null;
  spo2Pct: number | null;
  respiratoryRate: number | null;
  skinTempDeltaC: number | null;
}

export interface RecoveryBaselineInput {
  avgRestingHrBpm: number | null;
  avgHrvRmssdMs: number | null;
  avgSleepMinutes: number | null;
  sampleDays: number;
}

export interface RecoveryInsightInput {
  day: string;
  sleep: RecoverySleepInput | null;
  recovery: RecoveryVitalsInput | null;
  baseline?: RecoveryBaselineInput;
  yesterdayStrain?: number | null;
  sevenDayAvgStrain?: number | null;
  priorDays?: PulseRecoveryDayInput[];
  sleepGoalHours?: number;
}

export type RecoveryBand = "optimal" | "moderate" | "strained" | "unavailable";
export type RecoveryCompleteness = "complete" | "partial" | "unavailable";
export type RecoveryConfidence = "high" | "medium" | "low" | "unavailable";

export interface RecoveryInsightView {
  day: string;
  score: number | null;
  band: RecoveryBand;
  completeness: RecoveryCompleteness;
  confidence: RecoveryConfidence;
  signalsPresent: {
    sleep: boolean;
    restingHr: boolean;
    hrv: boolean;
    spo2: boolean;
    respiratoryRate: boolean;
  };
  missingSignals: string[];
  metrics: {
    sleepMinutes: number | null;
    deepMinutes: number | null;
    remMinutes: number | null;
    restingHrBpm: number | null;
    restingHrDeltaBpm: number | null;
    hrvRmssdMs: number | null;
    hrvDeltaMs: number | null;
    spo2Pct: number | null;
    respiratoryRate: number | null;
  };
  yesterdayStrain: number | null;
  sevenDayAvgStrain: number | null;
  summary: string;
  disclaimer: string;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Pure, transparent recovery & readiness computation.
 * Strictly separated from Strain: never modifies Overall, Cardio, or Muscular Strain.
 * Never fabricates missing sleep, RHR, or HRV readings.
 */
export function computeRecoveryInsights(input: RecoveryInsightInput): RecoveryInsightView {
  const sleepMinutes = input.sleep && input.sleep.minutesAsleep > 0 ? input.sleep.minutesAsleep : null;
  const restingHrBpm = input.recovery?.restingHrBpm ?? null;
  const hrvRmssdMs = input.recovery?.hrvRmssdMs ?? null;
  const spo2Pct = input.recovery?.spo2Pct ?? null;
  const respiratoryRate = input.recovery?.respiratoryRate ?? null;

  const signalsPresent = {
    sleep: sleepMinutes != null,
    restingHr: restingHrBpm != null,
    hrv: hrvRmssdMs != null,
    spo2: spo2Pct != null,
    respiratoryRate: respiratoryRate != null,
  };

  const missingSignals: string[] = [];
  if (!signalsPresent.sleep) missingSignals.push("Sleep");
  if (!signalsPresent.restingHr) missingSignals.push("Resting HR");
  if (!signalsPresent.hrv) missingSignals.push("HRV");

  const coreCount =
    Number(signalsPresent.sleep) + Number(signalsPresent.restingHr) + Number(signalsPresent.hrv);

  const completeness: RecoveryCompleteness =
    coreCount === 3 ? "complete" : coreCount > 0 ? "partial" : "unavailable";

  const pulse = computePulseRecovery({ hrvRmssdMs, restingHrBpm, respiratoryRate,
    skinTempDeltaC: input.recovery?.skinTempDeltaC ?? null, sleepHours: sleepMinutes == null ? null : sleepMinutes / 60 },
    input.priorDays ?? [], input.sleepGoalHours ?? 8);
  // Confidence describes input/baseline coverage, never clinical model validation.
  const confidence: RecoveryConfidence = pulse.score == null ? completeness === "unavailable" ? "unavailable" : "low" : "medium";

  const restingHrDeltaBpm =
    restingHrBpm != null && input.baseline?.avgRestingHrBpm != null
      ? round1(restingHrBpm - input.baseline.avgRestingHrBpm)
      : null;

  const hrvDeltaMs =
    hrvRmssdMs != null && input.baseline?.avgHrvRmssdMs != null
      ? round1(hrvRmssdMs - input.baseline.avgHrvRmssdMs)
      : null;

  if (completeness === "unavailable") {
    return {
      day: input.day,
      score: null,
      band: "unavailable",
      completeness: "unavailable",
      confidence: "unavailable",
      signalsPresent,
      missingSignals,
      metrics: {
        sleepMinutes: null,
        deepMinutes: null,
        remMinutes: null,
        restingHrBpm: null,
        restingHrDeltaBpm: null,
        hrvRmssdMs: null,
        hrvDeltaMs: null,
        spo2Pct,
        respiratoryRate,
      },
      yesterdayStrain: input.yesterdayStrain ?? null,
      sevenDayAvgStrain: input.sevenDayAvgStrain ?? null,
      summary:
        "No sleep, resting heart rate, or HRV data is available for this day yet. Sync Google Health (Fitbit Air) to view recovery insights.",
      disclaimer:
        "Recovery insights are a wellness estimate based on available wearable sleep and vitals, not a medical assessment.",
    };
  }

  const score = pulse.score;
  const band: RecoveryBand = pulse.band;

  const summaryParts: string[] = [];
  if (sleepMinutes != null) {
    const h = Math.floor(sleepMinutes / 60);
    const m = sleepMinutes % 60;
    summaryParts.push(`Sleep ${h}h ${m}m`);
  }
  if (restingHrBpm != null) {
    const deltaTxt =
      restingHrDeltaBpm != null
        ? ` (${restingHrDeltaBpm > 0 ? "+" : ""}${restingHrDeltaBpm} vs baseline)`
        : "";
    summaryParts.push(`RHR ${Math.round(restingHrBpm)} bpm${deltaTxt}`);
  }
  if (hrvRmssdMs != null) {
    const deltaTxt =
      hrvDeltaMs != null ? ` (${hrvDeltaMs > 0 ? "+" : ""}${hrvDeltaMs} ms vs baseline)` : "";
    summaryParts.push(`HRV ${Math.round(hrvRmssdMs)} ms${deltaTxt}`);
  }
  if (missingSignals.length > 0) {
    summaryParts.push(`Missing: ${missingSignals.join(", ")}`);
  }
  if (input.yesterdayStrain != null) {
    summaryParts.push(`Prior-day strain ${Math.round(input.yesterdayStrain)}/100`);
  }

  return {
    day: input.day,
    score,
    band,
    completeness,
    confidence,
    signalsPresent,
    missingSignals,
    metrics: {
      sleepMinutes,
      deepMinutes: input.sleep?.deepMinutes ?? null,
      remMinutes: input.sleep?.remMinutes ?? null,
      restingHrBpm,
      restingHrDeltaBpm,
      hrvRmssdMs,
      hrvDeltaMs,
      spo2Pct,
      respiratoryRate,
    },
    yesterdayStrain: input.yesterdayStrain ?? null,
    sevenDayAvgStrain: input.sevenDayAvgStrain ?? null,
    summary: `${pulse.summary} · ${summaryParts.join(" · ")}`,
    disclaimer:
      "Recovery insights are a wellness estimate based on available wearable sleep and vitals, not a medical assessment.",
  };
}

export async function getRecoveryInsightsForUser(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  day: string,
): Promise<RecoveryInsightView> {
  const from21 = addDays(day, -21);
  const yesterday = addDays(day, -1);
  const from7 = addDays(day, -7);

  const [sleepRows, recoveryRows, strainRows] = await Promise.all([
    db
      .select()
      .from(schema.dailySleep)
      .where(
        and(
          eq(schema.dailySleep.userId, userId),
          gte(schema.dailySleep.day, from21),
          lte(schema.dailySleep.day, day),
        ),
      )
      .orderBy(desc(schema.dailySleep.day)),
    db
      .select()
      .from(schema.dailyRecovery)
      .where(
        and(
          eq(schema.dailyRecovery.userId, userId),
          gte(schema.dailyRecovery.day, from21),
          lte(schema.dailyRecovery.day, day),
        ),
      )
      .orderBy(desc(schema.dailyRecovery.day)),
    db
      .select({ day: schema.dailyStrain.day, overallStrain: schema.dailyStrain.overallStrain })
      .from(schema.dailyStrain)
      .where(
        and(
          eq(schema.dailyStrain.userId, userId),
          gte(schema.dailyStrain.day, from7),
          lte(schema.dailyStrain.day, yesterday),
        ),
      ),
  ]);

  const todaySleep = sleepRows.find((r) => r.day === day) ?? null;
  const todayRecovery = recoveryRows.find((r) => r.day === day) ?? null;

  const priorSleeps = sleepRows.filter((r) => r.day < day && r.minutesAsleep > 0);
  const priorRhrs = recoveryRows
    .filter((r) => r.day < day && r.restingHrBpm != null)
    .map((r) => r.restingHrBpm as number);
  const priorHrvs = recoveryRows
    .filter((r) => r.day < day && r.hrvRmssdMs != null)
    .map((r) => r.hrvRmssdMs as number);

  const baseline: RecoveryBaselineInput = {
    avgSleepMinutes: avg(priorSleeps.map((s) => s.minutesAsleep)),
    avgRestingHrBpm: avg(priorRhrs),
    avgHrvRmssdMs: avg(priorHrvs),
    sampleDays: Math.max(priorSleeps.length, priorRhrs.length, priorHrvs.length),
  };

  const yesterdayStrainRow = strainRows.find((s) => s.day === yesterday);
  const sevenDayAvgStrain =
    strainRows.length > 0 ? round1(strainRows.reduce((s, r) => s + r.overallStrain, 0) / strainRows.length) : null;

  const pulse = await getPulseInsightsForUser(db, userId, day);
  const view = computeRecoveryInsights({
    day,
    sleep: pulse.recovery.availability !== "waiting_for_sleep" && todaySleep
      ? {
          minutesAsleep: todaySleep.minutesAsleep,
          deepMinutes: todaySleep.deepMinutes ?? null,
          remMinutes: todaySleep.remMinutes ?? null,
          lightMinutes: todaySleep.lightMinutes ?? null,
          minutesAwake: todaySleep.minutesAwake ?? null,
        }
      : null,
    recovery: todayRecovery
      ? {
          restingHrBpm: todayRecovery.restingHrBpm ?? null,
          hrvRmssdMs: todayRecovery.hrvRmssdMs ?? null,
          spo2Pct: todayRecovery.spo2Pct ?? null,
          respiratoryRate: todayRecovery.respiratoryRate ?? null,
          skinTempDeltaC: todayRecovery.skinTempDeltaC ?? null,
        }
      : null,
    baseline,
    yesterdayStrain: yesterdayStrainRow ? round1(yesterdayStrainRow.overallStrain) : null,
    sevenDayAvgStrain,
  });
  return { ...view, score: pulse.recovery.score, band: pulse.recovery.band,
    confidence: pulse.recovery.score == null ? view.confidence : "medium",
    summary: pulse.recovery.summary,
  };
}
