import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { addDays } from "./nutrition-model";
import * as schema from "./schema";

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

  const hasBaseline = (input.baseline?.sampleDays ?? 0) >= 3;
  const confidence: RecoveryConfidence =
    completeness === "unavailable"
      ? "unavailable"
      : completeness === "complete" && hasBaseline
        ? "high"
        : completeness === "complete" || (coreCount === 2 && hasBaseline)
          ? "medium"
          : "low";

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

  // Weighted component scores (0–100 each) only for signals actually present.
  const weightedParts: Array<{ score: number; weight: number }> = [];

  if (sleepMinutes != null) {
    // 8h (480m) target; 5h (300m) -> ~45, 7h (420m) -> ~85, 8h -> 98
    const baseSleep = clamp((sleepMinutes / 480) * 95, 20, 100);
    const stageBonus =
      input.sleep?.deepMinutes != null && input.sleep?.remMinutes != null
        ? clamp(((input.sleep.deepMinutes + input.sleep.remMinutes) / Math.max(1, sleepMinutes) - 0.32) * 35, -6, 6)
        : 0;
    weightedParts.push({ score: clamp(baseSleep + stageBonus, 15, 100), weight: 0.4 });
  }

  if (hrvRmssdMs != null) {
    let hrvScore: number;
    if (input.baseline?.avgHrvRmssdMs != null && input.baseline.avgHrvRmssdMs > 0) {
      const ratio = hrvRmssdMs / input.baseline.avgHrvRmssdMs;
      hrvScore = clamp(72 + (ratio - 1) * 75, 20, 100);
    } else {
      // Provisional population range when personal baseline is not yet established
      hrvScore = clamp(45 + (hrvRmssdMs - 25) * 0.85, 25, 95);
    }
    weightedParts.push({ score: hrvScore, weight: 0.35 });
  }

  if (restingHrBpm != null) {
    let rhrScore: number;
    if (input.baseline?.avgRestingHrBpm != null && input.baseline.avgRestingHrBpm > 0) {
      const delta = restingHrBpm - input.baseline.avgRestingHrBpm;
      // Lower or at baseline is favourable; +5 bpm elevated reduces score
      rhrScore = clamp(78 - delta * 5.5, 20, 100);
    } else {
      rhrScore = clamp(95 - (restingHrBpm - 48) * 1.1, 30, 95);
    }
    weightedParts.push({ score: rhrScore, weight: 0.25 });
  }

  const totalWeight = weightedParts.reduce((s, p) => s + p.weight, 0);
  let rawScore = weightedParts.reduce((s, p) => s + p.score * p.weight, 0) / Math.max(0.01, totalWeight);

  // Modest adjustment for very high yesterday strain (> 75) if readiness signals are borderline
  if (input.yesterdayStrain != null && input.yesterdayStrain >= 75) {
    rawScore -= clamp((input.yesterdayStrain - 75) * 0.2, 0, 5);
  }

  const score = Math.round(clamp(rawScore, 1, 100));
  const band: RecoveryBand = score >= 75 ? "optimal" : score >= 50 ? "moderate" : "strained";

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
    summary: summaryParts.join(" · "),
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

  return computeRecoveryInsights({
    day,
    sleep: todaySleep
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
}
