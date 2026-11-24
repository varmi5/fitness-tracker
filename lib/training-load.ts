import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { AuthDatabase } from "./auth";
import { MUSCLE_GROUPS, resolveExerciseMuscles, type MuscleGroup } from "./muscle-map";
import { hevySet, hevyWorkout } from "./schema";
import { setTypeWeight } from "./strain-engine";
import { strainData, type DailyStrainView } from "./strain-data";

export const ACUTE_EWMA_LAMBDA = 2 / (7 + 1); // 0.25
export const CHRONIC_EWMA_LAMBDA = 2 / (42 + 1); // ~0.04651

export type LoadStatusCode =
  | "calibrating"
  | "detraining"
  | "peaking"
  | "maintaining"
  | "productive"
  | "fatigued"
  | "overtraining";

export interface LoadStatusAssessment {
  status: LoadStatusCode;
  label: string;
  tone: "neutral" | "blue" | "teal" | "amber" | "danger";
  acwr: number | null;
  optimalMin: number;
  optimalMax: number;
  guidance: string;
  baselineDays: number;
  requiredDays: number;
}

export interface EwmaSeriesPoint {
  day: string;
  rawLoad: number;
  acute7d: number;
  chronic42d: number;
  optimalMin: number;
  optimalMax: number;
  confidence: DailyStrainView["confidence"];
}

export interface ExerciseProgressionEntry {
  exerciseTitle: string;
  sessions: number;
  latestDay: string;
  latestWeightKg: number | null;
  latestReps: number | null;
  bestEstimated1RmKg: number | null;
  previousBest1RmKg: number | null;
  deltaKg: number | null;
}

export interface MuscleLoadSummary {
  muscle: MuscleGroup;
  totalLoad: number;
  weeklyWorkingSets: number;
}

export interface TrainingLoadSummary {
  from: string;
  to: string;
  cardioSeries: EwmaSeriesPoint[];
  muscularSeries: EwmaSeriesPoint[];
  latestCardio: { daily: number; acute7d: number; chronic42d: number } | null;
  latestMuscular: { daily: number; acute7d: number; chronic42d: number } | null;
  cardioStatus: LoadStatusAssessment | null;
  muscularStatus: LoadStatusAssessment | null;
  muscleSummaries: MuscleLoadSummary[];
  exerciseProgression: ExerciseProgressionEntry[];
  dataQuality: {
    totalDays: number;
    completeDays: number;
    partialDays: number;
    incompleteDays: number;
    restDays: number;
  };
  disclaimer: string;
}

export function computeEwmaSeries(
  days: { day: string; rawLoad: number; confidence: DailyStrainView["confidence"] }[],
): EwmaSeriesPoint[] {
  let acute: number | null = null;
  let chronic: number | null = null;
  let trackedDays = 0;
  const out: EwmaSeriesPoint[] = [];

  for (const d of days) {
    // Cold-start handling: initialize EWMA on first day with recorded data (or measured rest)
    if (acute === null || chronic === null) {
      if (d.confidence === "incomplete" && d.rawLoad === 0) {
        continue;
      }
      trackedDays = 1;
      acute = d.rawLoad;
      chronic = d.rawLoad;
    } else {
      trackedDays += 1;
      // Warm-up bounded EWMA: keeps 7d acute (0.25) strictly more responsive than chronic
      // while avoiding an artificially tiny chronic denominator during the first 14–42 days.
      const lambdaChronic = 2 / (Math.max(14, Math.min(trackedDays, 42)) + 1);
      acute = ACUTE_EWMA_LAMBDA * d.rawLoad + (1 - ACUTE_EWMA_LAMBDA) * acute;
      chronic = lambdaChronic * d.rawLoad + (1 - lambdaChronic) * chronic;
    }
    const rAcute = Math.round(acute * 100) / 100;
    const rChronic = Math.round(chronic * 100) / 100;
    out.push({
      day: d.day,
      rawLoad: Math.round(d.rawLoad * 100) / 100,
      acute7d: rAcute,
      chronic42d: rChronic,
      optimalMin: Math.round(rChronic * 0.85 * 100) / 100,
      optimalMax: Math.round(rChronic * 1.3 * 100) / 100,
      confidence: d.confidence,
    });
  }
  return out;
}

export function classifyLoadStatus(
  series: EwmaSeriesPoint[],
  domain: "cardio" | "muscular",
): LoadStatusAssessment | null {
  if (series.length === 0) return null;
  const latest = series[series.length - 1];
  const requiredDays = 7;
  const baselineDays = series.filter((p) => p.confidence !== "incomplete" || p.rawLoad > 0).length;
  const activeWorkDays = series.filter((p) => p.rawLoad > 0).length;
  const minChronicFloor = domain === "cardio" ? 5 : 1.0;
  const noun = domain === "cardio" ? "cardio" : "muscular";

  if (baselineDays < requiredDays || activeWorkDays < 2 || latest.chronic42d < minChronicFloor) {
    return {
      status: "calibrating",
      label: "Calibrating",
      tone: "neutral",
      acwr: null,
      optimalMin: latest.optimalMin,
      optimalMax: latest.optimalMax,
      guidance: `Building your ${noun} baseline (${Math.min(baselineDays, requiredDays)}/${requiredDays} days). Keep logging workouts to unlock Detraining / Optimal / Overtraining status.`,
      baselineDays,
      requiredDays,
    };
  }

  const acwr = Math.round((latest.acute7d / latest.chronic42d) * 100) / 100;
  const prev7 = series[Math.max(0, series.length - 8)];
  const chronicDelta = latest.chronic42d - (prev7?.chronic42d ?? latest.chronic42d);

  if (acwr < 0.8) {
    return {
      status: "detraining",
      label: "Detraining",
      tone: "blue",
      acwr,
      optimalMin: latest.optimalMin,
      optimalMax: latest.optimalMax,
      guidance: `Recent 7d ${noun} load is below your usual range (${acwr}× baseline). Gradually return to your normal routine unless this is an intentional deload.`,
      baselineDays,
      requiredDays,
    };
  }
  if (acwr < 0.95 && chronicDelta > 0) {
    return {
      status: "peaking",
      label: "Peaking",
      tone: "teal",
      acwr,
      optimalMin: latest.optimalMin,
      optimalMax: latest.optimalMax,
      guidance: `Strong chronic ${noun} base with a controlled taper (${acwr}×). Good freshness window for PRs or peak performance.`,
      baselineDays,
      requiredDays,
    };
  }
  if (acwr <= 1.05) {
    return {
      status: "maintaining",
      label: "Maintaining",
      tone: "teal",
      acwr,
      optimalMin: latest.optimalMin,
      optimalMax: latest.optimalMax,
      guidance: `Your ${noun} load is holding steady (${acwr}× baseline), supporting current conditioning without excess fatigue.`,
      baselineDays,
      requiredDays,
    };
  }
  if (acwr <= 1.3) {
    return {
      status: "productive",
      label: "Productive",
      tone: "teal",
      acwr,
      optimalMin: latest.optimalMin,
      optimalMax: latest.optimalMax,
      guidance: `Optimal overload zone (${acwr}× baseline) — building ${noun} fitness faster than fatigue accumulates.`,
      baselineDays,
      requiredDays,
    };
  }
  if (acwr <= 1.5) {
    return {
      status: "fatigued",
      label: "Fatigued",
      tone: "amber",
      acwr,
      optimalMin: latest.optimalMin,
      optimalMax: latest.optimalMax,
      guidance: `Short-term ${noun} load is elevated (${acwr}× baseline). Watch sleep and recovery closely before adding more volume.`,
      baselineDays,
      requiredDays,
    };
  }
  return {
    status: "overtraining",
    label: "Overtraining",
    tone: "danger",
    acwr,
    optimalMin: latest.optimalMin,
    optimalMax: latest.optimalMax,
    guidance: `Short-term ${noun} load is significantly above your established baseline (${acwr}×). Reduce volume or intensity and prioritize recovery.`,
    baselineDays,
    requiredDays,
  };
}

export function estimateEpley1Rm(weightKg: number | null, reps: number | null): number | null {
  if (weightKg == null || weightKg <= 0 || reps == null || reps <= 0) return null;
  if (reps === 1) return Math.round(weightKg * 10) / 10;
  return Math.round(weightKg * (1 + Math.min(reps, 20) / 30) * 10) / 10;
}

export async function getTrainingLoadSummary(
  db: AuthDatabase,
  userId: string,
  from: string,
  to: string,
): Promise<TrainingLoadSummary> {
  const days = await strainData(db, userId).history(from, to);

  const cardioSeries = computeEwmaSeries(
    days.map((d) => ({ day: d.day, rawLoad: d.cRaw, confidence: d.confidence })),
  );
  const muscularSeries = computeEwmaSeries(
    days.map((d) => ({ day: d.day, rawLoad: d.mRaw, confidence: d.confidence })),
  );

  const muscleTotals = Object.fromEntries(MUSCLE_GROUPS.map((m) => [m, 0])) as Record<MuscleGroup, number>;
  const muscleWorkingSets = Object.fromEntries(MUSCLE_GROUPS.map((m) => [m, 0])) as Record<MuscleGroup, number>;

  // Last 7 days working sets & muscle load (aligned to the exact same 7-day window)
  const recent7Start = days[Math.max(0, days.length - 7)]?.day ?? from;
  for (const d of days) {
    if (d.day < recent7Start) continue;
    for (const g of MUSCLE_GROUPS) {
      muscleTotals[g] += d.muscleLoads?.[g] ?? 0;
    }
  }
  const workouts = await db
    .select()
    .from(hevyWorkout)
    .where(and(eq(hevyWorkout.userId, userId), gte(hevyWorkout.day, from), lte(hevyWorkout.day, to)))
    .orderBy(asc(hevyWorkout.day), asc(hevyWorkout.startTime));

  const sets = workouts.length
    ? await db
        .select()
        .from(hevySet)
        .where(eq(hevySet.userId, userId))
        .orderBy(asc(hevySet.exerciseIndex), asc(hevySet.setIndex))
    : [];

  const workoutDayById = new Map(workouts.map((w) => [w.hevyId, w.day]));
  const progressionMap = new Map<
    string,
    {
      sessions: Set<string>;
      latestDay: string;
      latestWeightKg: number | null;
      latestReps: number | null;
      best1Rm: number | null;
      prevBest1Rm: number | null;
    }
  >();

  for (const s of sets) {
    const wDay = workoutDayById.get(s.hevyId);
    if (!wDay) continue;
    if (setTypeWeight(s.setType) <= 0) continue;

    const mapping = resolveExerciseMuscles(s.exerciseTitle);
    if (wDay >= recent7Start) {
      for (const g of mapping.primary) {
        muscleWorkingSets[g] += 1;
      }
      for (const g of mapping.secondary) {
        muscleWorkingSets[g] += 0.5;
      }
    }

    const est1Rm = estimateEpley1Rm(s.weightKg, s.reps);
    let entry = progressionMap.get(s.exerciseTitle);
    if (!entry) {
      entry = {
        sessions: new Set(),
        latestDay: wDay,
        latestWeightKg: s.weightKg,
        latestReps: s.reps,
        best1Rm: est1Rm,
        prevBest1Rm: null,
      };
      progressionMap.set(s.exerciseTitle, entry);
    }
    entry.sessions.add(s.hevyId);
    if (wDay >= entry.latestDay) {
      entry.latestDay = wDay;
      if (s.weightKg != null) entry.latestWeightKg = s.weightKg;
      if (s.reps != null) entry.latestReps = s.reps;
    }
    if (est1Rm != null) {
      if (entry.best1Rm == null || est1Rm > entry.best1Rm) {
        if (entry.best1Rm != null) entry.prevBest1Rm = entry.best1Rm;
        entry.best1Rm = est1Rm;
      }
    }
  }

  const muscleSummaries: MuscleLoadSummary[] = MUSCLE_GROUPS.map((muscle) => ({
    muscle,
    totalLoad: Math.round(muscleTotals[muscle] * 100) / 100,
    weeklyWorkingSets: Math.round(muscleWorkingSets[muscle] * 10) / 10,
  }));

  const exerciseProgression: ExerciseProgressionEntry[] = [...progressionMap.entries()]
    .map(([exerciseTitle, e]) => ({
      exerciseTitle,
      sessions: e.sessions.size,
      latestDay: e.latestDay,
      latestWeightKg: e.latestWeightKg,
      latestReps: e.latestReps,
      bestEstimated1RmKg: e.best1Rm,
      previousBest1RmKg: e.prevBest1Rm,
      deltaKg: e.best1Rm != null && e.prevBest1Rm != null ? Math.round((e.best1Rm - e.prevBest1Rm) * 10) / 10 : null,
    }))
    .sort((a, b) => b.latestDay.localeCompare(a.latestDay) || b.sessions - a.sessions)
    .slice(0, 20);

  const lastCardio = cardioSeries[cardioSeries.length - 1] ?? null;
  const lastMuscular = muscularSeries[muscularSeries.length - 1] ?? null;
  const cardioStatus = classifyLoadStatus(cardioSeries, "cardio");
  const muscularStatus = classifyLoadStatus(muscularSeries, "muscular");

  return {
    from,
    to,
    cardioSeries,
    muscularSeries,
    latestCardio: lastCardio
      ? { daily: lastCardio.rawLoad, acute7d: lastCardio.acute7d, chronic42d: lastCardio.chronic42d }
      : null,
    latestMuscular: lastMuscular
      ? { daily: lastMuscular.rawLoad, acute7d: lastMuscular.acute7d, chronic42d: lastMuscular.chronic42d }
      : null,
    cardioStatus,
    muscularStatus,
    muscleSummaries,
    exerciseProgression,
    dataQuality: {
      totalDays: days.length,
      completeDays: days.filter((d) => d.confidence === "complete").length,
      partialDays: days.filter((d) => d.confidence === "partial").length,
      incompleteDays: days.filter((d) => d.confidence === "incomplete").length,
      restDays: days.filter((d) => d.confidence === "rest").length,
    },
    disclaimer:
      "Cardio Status and Muscular Status compare 7d Acute vs 42d Chronic EWMA (Detraining, Maintaining, Productive, Peaking, Fatigued, Overtraining). Descriptive training-trend guidance, not a medical diagnosis.",
  };
}
