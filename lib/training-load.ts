import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { AuthDatabase } from "./auth";
import { MUSCLE_GROUPS, resolveExerciseMuscles, type MuscleGroup } from "./muscle-map";
import { hevySet, hevyWorkout } from "./schema";
import { setTypeWeight } from "./strain-engine";
import { strainData, type DailyStrainView } from "./strain-data";

export const ACUTE_EWMA_LAMBDA = 2 / (7 + 1); // 0.25
export const CHRONIC_EWMA_LAMBDA = 2 / (42 + 1); // ~0.04651

export interface EwmaSeriesPoint {
  day: string;
  rawLoad: number;
  acute7d: number;
  chronic42d: number;
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
  const out: EwmaSeriesPoint[] = [];

  for (const d of days) {
    // Cold-start handling: initialize EWMA on first day with recorded data (or measured rest)
    if (acute === null || chronic === null) {
      if (d.confidence === "incomplete" && d.rawLoad === 0) {
        continue;
      }
      acute = d.rawLoad;
      chronic = d.rawLoad;
    } else {
      acute = ACUTE_EWMA_LAMBDA * d.rawLoad + (1 - ACUTE_EWMA_LAMBDA) * acute;
      chronic = CHRONIC_EWMA_LAMBDA * d.rawLoad + (1 - CHRONIC_EWMA_LAMBDA) * chronic;
    }
    out.push({
      day: d.day,
      rawLoad: Math.round(d.rawLoad * 100) / 100,
      acute7d: Math.round(acute * 100) / 100,
      chronic42d: Math.round(chronic * 100) / 100,
      confidence: d.confidence,
    });
  }
  return out;
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

  for (const d of days) {
    for (const g of MUSCLE_GROUPS) {
      muscleTotals[g] += d.muscleLoads?.[g] ?? 0;
    }
  }

  // Last 7 days working sets & exercise progression from Hevy sets
  const recent7Start = days[Math.max(0, days.length - 7)]?.day ?? from;
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
      "Cardio Load (raw TRIMP EWMA) and Muscular Load (raw working-set EWMA) are descriptive training-trend metrics, not validated injury predictions.",
  };
}
