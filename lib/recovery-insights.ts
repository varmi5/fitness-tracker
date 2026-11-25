import { and, desc, eq, gte, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { addDays } from "./nutrition-model";
import * as schema from "./schema";
import { computePulseRecovery, selectNonOverlappingSleepSessions, type PulseRecoveryDayInput } from "./pulse-engine";
import { pickRecoveryRowForDay } from "./source-priority";

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
  const from29 = addDays(day, -29);
  const yesterday = addDays(day, -1);
  const from7 = addDays(day, -7);

  const [sleepRows, sessionRows, recoveryRows, goalRows, strainRows, prefRows] = await Promise.all([
    db
      .select()
      .from(schema.dailySleep)
      .where(
        and(
          eq(schema.dailySleep.userId, userId),
          gte(schema.dailySleep.day, from29),
          lte(schema.dailySleep.day, day),
        ),
      )
      .orderBy(desc(schema.dailySleep.day)),
    db
      .select()
      .from(schema.sleepSession)
      .where(
        and(
          eq(schema.sleepSession.userId, userId),
          gte(schema.sleepSession.day, from29),
          lte(schema.sleepSession.day, day),
        ),
      ),
    db
      .select()
      .from(schema.dailyRecovery)
      .where(
        and(
          eq(schema.dailyRecovery.userId, userId),
          gte(schema.dailyRecovery.day, from29),
          lte(schema.dailyRecovery.day, day),
        ),
      )
      .orderBy(desc(schema.dailyRecovery.day)),
    db
      .select()
      .from(schema.sleepGoal)
      .where(eq(schema.sleepGoal.userId, userId))
      .orderBy(desc(schema.sleepGoal.effectiveFrom)),
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
    db
      .select({ primaryRecoverySource: schema.nutritionPreference.primaryRecoverySource })
      .from(schema.nutritionPreference)
      .where(eq(schema.nutritionPreference.userId, userId))
      .limit(1),
  ]);

  const sessionDays = new Set(sessionRows.map((r) => r.day));
  const sleepRecords = selectNonOverlappingSleepSessions([
    ...sessionRows.filter((r) => r.processed !== false).map((r) => ({ ...r, coverageComplete: false })),
    ...sleepRows.filter((r) => !sessionDays.has(r.day)).map((r) => ({ ...r, isMainSleep: true, coverageComplete: false })),
  ]);
  const sleepByDay = new Map<string, (typeof sleepRecords)[number]>();
  for (const s of sleepRecords) {
    if (s.isMainSleep === false) continue;
    const prev = sleepByDay.get(s.day);
    if (!prev || s.minutesAsleep > prev.minutesAsleep) sleepByDay.set(s.day, s);
  }

  const primaryRecoverySource = prefRows[0]?.primaryRecoverySource ?? "auto";
  const recByDay = pickRecoveryRowForDay(recoveryRows, primaryRecoverySource);

  const todaySleep = sleepByDay.get(day) ?? null;
  const todayRecovery = recByDay.get(day) ?? null;

  const priorDays: PulseRecoveryDayInput[] = Array.from({ length: 28 }, (_, i) => {
    const d = addDays(day, -28 + i);
    const r = recByDay.get(d);
    const s = sleepByDay.get(d);
    return {
      source: r?.source,
      hrvRmssdMs: r?.hrvRmssdMs ?? null,
      restingHrBpm: r?.restingHrBpm ?? null,
      respiratoryRate: r?.respiratoryRate ?? null,
      skinTempDeltaC: r?.skinTempDeltaC ?? null,
      sleepHours: s && s.minutesAsleep > 0 ? s.minutesAsleep / 60 : null,
    };
  });

  const priorSleeps = [...sleepByDay.values()].filter((r) => r.day < day && r.minutesAsleep > 0);
  const priorRhrs = [...recByDay.values()].filter((r) => r.day < day && r.restingHrBpm != null).map((r) => r.restingHrBpm as number);
  const priorHrvs = [...recByDay.values()].filter((r) => r.day < day && r.hrvRmssdMs != null).map((r) => r.hrvRmssdMs as number);

  const baseline: RecoveryBaselineInput = {
    avgSleepMinutes: avg(priorSleeps.map((s) => s.minutesAsleep)),
    avgRestingHrBpm: avg(priorRhrs),
    avgHrvRmssdMs: avg(priorHrvs),
    sampleDays: Math.max(priorSleeps.length, priorRhrs.length, priorHrvs.length),
  };

  const goalRow = goalRows.find((g) => g.effectiveFrom <= day);
  const sleepGoalHours = goalRow ? goalRow.goalMinutes / 60 : 8;
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
    priorDays,
    sleepGoalHours,
    yesterdayStrain: yesterdayStrainRow ? round1(yesterdayStrainRow.overallStrain) : null,
    sevenDayAvgStrain,
  });
}
