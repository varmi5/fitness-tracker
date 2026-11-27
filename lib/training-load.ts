import { dedupeHevyWorkouts } from "./hevy";
import { isSourceVisible } from "./source-priority";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { AuthDatabase } from "./auth";
import { MUSCLE_GROUPS, resolveExerciseMuscles, type MuscleGroup } from "./muscle-map";
import { hevySet, hevyWorkout, nutritionPreference } from "./schema";
import { addDays, localDay, resolveLocalDateTime } from "./nutrition-model";
import { buildExerciseStrengthReferences, computeMuscularWorkload, setTypeWeight } from "./strain-engine";
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

export interface MuscleFreshnessEntry {
  muscle: MuscleGroup;
  /** Not derivable from workout logs alone; retained nullable for client compatibility. */
  freshnessPct: number | null;
  status: "unknown" | "calibrating" | "tracked" | "fresh" | "recovering" | "fatigued";
  lastTrainedAt?: string | null;
  hoursSinceTrained?: number | null;
  trainingDays?: number;
  confidence?: "unknown" | "low" | "moderate";
  sessionLoadRatio?: number | null;
  referenceSessionLoad?: number | null;
  modelNote?: string;
  daysSinceTrained: number | null;
  lastTrainedDay: string | null;
  weeklyWorkingSets: number;
  recentLoad: number;
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
  muscleFreshness: MuscleFreshnessEntry[];
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
    if ((d.confidence === "incomplete" || d.confidence === "partial") && d.rawLoad === 0) continue;
    // Cold-start handling: initialize EWMA on first day with recorded data (or measured rest)
    if (acute === null || chronic === null) {
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
  const requiredDays = 28;
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
      guidance: `Building your ${noun} baseline (${Math.min(baselineDays, requiredDays)}/${requiredDays} days). Incomplete days are not treated as rest. This is a descriptive workload comparison, not a recovery or injury prediction.`,
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
      label: "Lower recent load",
      tone: "blue",
      acwr,
      optimalMin: latest.optimalMin,
      optimalMax: latest.optimalMax,
      guidance: `Recent 7-day ${noun} load is below your usual baseline. This can reflect a lighter week, missing imports, or a change in routine; it does not establish detraining.`,
      baselineDays,
      requiredDays,
    };
  }
  if (acwr < 0.95 && chronicDelta > 0) {
    return {
      status: "peaking",
      label: "Reduced recent load",
      tone: "teal",
      acwr,
      optimalMin: latest.optimalMin,
      optimalMax: latest.optimalMax,
      guidance: `Recent ${noun} load is slightly lower while the longer trend has risen. This does not establish peak readiness.`,
      baselineDays,
      requiredDays,
    };
  }
  if (acwr <= 1.05) {
    return {
      status: "maintaining",
      label: "Stable recent load",
      tone: "teal",
      acwr,
      optimalMin: latest.optimalMin,
      optimalMax: latest.optimalMax,
      guidance: `Recent ${noun} load is similar to your recorded baseline. This does not measure conditioning or tissue recovery.`,
      baselineDays,
      requiredDays,
    };
  }
  if (acwr <= 1.3) {
    return {
      status: "productive",
      label: "Higher recent load",
      tone: "teal",
      acwr,
      optimalMin: latest.optimalMin,
      optimalMax: latest.optimalMax,
      guidance: `Recent ${noun} load is higher than your recorded baseline. The ratio alone cannot show whether this is beneficial.`,
      baselineDays,
      requiredDays,
    };
  }
  if (acwr <= 1.5) {
    return {
      status: "fatigued",
      label: "Elevated recent load",
      tone: "amber",
      acwr,
      optimalMin: latest.optimalMin,
      optimalMax: latest.optimalMax,
      guidance: `Short-term ${noun} load is elevated above your baseline. This descriptive ratio does not diagnose fatigue or predict injury.`,
      baselineDays,
      requiredDays,
    };
  }
  return {
    status: "overtraining",
    label: "Very elevated recent load",
    tone: "danger",
    acwr,
    optimalMin: latest.optimalMin,
    optimalMax: latest.optimalMax,
    guidance: `Short-term ${noun} load is significantly above your established baseline. Check recording completeness and how you feel; this ratio does not diagnose overtraining.`,
    baselineDays,
    requiredDays,
  };
}

export function estimateEpley1Rm(weightKg: number | null, reps: number | null): number | null {
  if (weightKg == null || weightKg <= 0 || reps == null || reps <= 0) return null;
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps) || reps > 10) return null;
  if (reps === 1) return Math.round(weightKg * 10) / 10;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

export async function getTrainingLoadSummary(
  db: AuthDatabase,
  userId: string,
  from: string,
  to: string,
): Promise<TrainingLoadSummary> {
  // Warm the long-term comparison with history preceding the visible range.
  const historyFrom = from < addDays(to, -41) ? from : addDays(to, -41);
  const days = await strainData(db, userId).history(historyFrom, to);

  const cardioSeries = computeEwmaSeries(
    days.map((d) => ({ day: d.day, rawLoad: d.cRaw, confidence: d.confidence })),
  );
  const muscularSeries = computeEwmaSeries(
    days.map((d) => ({ day: d.day, rawLoad: d.mRaw, confidence: d.confidence })),
  );

  const muscleTotals = Object.fromEntries(MUSCLE_GROUPS.map((m) => [m, 0])) as Record<MuscleGroup, number>;
  const muscleWorkingSets = Object.fromEntries(MUSCLE_GROUPS.map((m) => [m, 0])) as Record<MuscleGroup, number>;

  // Last 7 days working sets & muscle load (aligned to the exact same 7-day window)
  const recent7Start = addDays(to, -6);
  for (const d of days) {
    if (d.day < recent7Start) continue;
    for (const g of MUSCLE_GROUPS) {
      muscleTotals[g] += d.muscleLoads?.[g] ?? 0;
    }
  }
  const [sourceOptions] = await db.select({ rules: nutritionPreference.sourceSettings }).from(nutritionPreference).where(eq(nutritionPreference.userId, userId));
  const workouts = isSourceVisible(sourceOptions?.rules.workouts, "hevy") ? dedupeHevyWorkouts(await db
    .select()
    .from(hevyWorkout)
    .where(and(eq(hevyWorkout.userId, userId), gte(hevyWorkout.day, historyFrom), lte(hevyWorkout.day, to)))
    .orderBy(asc(hevyWorkout.day), asc(hevyWorkout.startTime))) : [];

  const sets = workouts.length
    ? await db
        .select()
        .from(hevySet)
        .where(and(eq(hevySet.userId, userId), inArray(hevySet.hevyId, workouts.map((w) => w.hevyId))))
        .orderBy(asc(hevySet.exerciseIndex), asc(hevySet.setIndex))
    : [];

  const workoutById = new Map(workouts.map((w) => [w.hevyId, w]));
  sets.sort((a, b) => (workoutById.get(a.hevyId)?.startTime.getTime() ?? 0) - (workoutById.get(b.hevyId)?.startTime.getTime() ?? 0) || a.setIndex - b.setIndex);
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
      sessionBests: Map<string, number>;
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
        sessionBests: new Map(),
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
      entry.sessionBests.set(s.hevyId, Math.max(entry.sessionBests.get(s.hevyId) ?? 0, est1Rm));
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

  const [preferences] = await db.select({ timezone: nutritionPreference.timezone }).from(nutritionPreference)
    .where(eq(nutritionPreference.userId, userId)).limit(1);
  const timezone = preferences?.timezone ?? "Europe/London";
  const now = new Date();
  const referenceAt = to === localDay(now, timezone)
    ? now : new Date(resolveLocalDateTime(addDays(to, 1), "00:00", timezone).getTime() - 1);
  const muscleFreshness = summarizeMuscleHistory(
    workouts.map((workout) => {
      const priorSets = sets.filter((set) => {
        const prior = workoutById.get(set.hevyId);
        return prior && prior.day < workout.day;
      });
      const references = buildExerciseStrengthReferences(priorSets);
      return {
        day: workout.day, endedAt: workout.endTime.toISOString(),
        loads: computeMuscularWorkload(sets.filter((set) => set.hevyId === workout.hevyId)
          .map((set) => ({ ...set, reference1RmKg: references.get(set.exerciseTitle.trim().toLowerCase()) }))).muscleLoads,
      };
    }),
    referenceAt,
    muscleWorkingSets,
    muscleTotals,
  );

  const exerciseProgression: ExerciseProgressionEntry[] = [...progressionMap.entries()]
    .map(([exerciseTitle, e]) => {
      const sessionIds = [...e.sessions].sort((a, b) => (workoutById.get(a)?.startTime.getTime() ?? 0) - (workoutById.get(b)?.startTime.getTime() ?? 0));
      const latestId = sessionIds.at(-1)!;
      const prior = sessionIds.slice(0, -1).map((id) => e.sessionBests.get(id)).filter((value): value is number => value != null);
      const previousBest = prior.length ? Math.max(...prior) : null;
      const latestBest = e.sessionBests.get(latestId) ?? null;
      return {
        exerciseTitle, sessions: e.sessions.size, latestDay: e.latestDay,
        latestWeightKg: e.latestWeightKg, latestReps: e.latestReps,
        bestEstimated1RmKg: e.best1Rm, previousBest1RmKg: previousBest,
        deltaKg: latestBest != null && previousBest != null ? Math.round((latestBest - previousBest) * 10) / 10 : null,
      };
    })
    .sort((a, b) => b.latestDay.localeCompare(a.latestDay) || b.sessions - a.sessions)
    .slice(0, 20);

  const lastCardio = cardioSeries[cardioSeries.length - 1] ?? null;
  const lastMuscular = muscularSeries[muscularSeries.length - 1] ?? null;
  const cardioStatus = lastCardio?.day === to ? classifyLoadStatus(cardioSeries, "cardio") : null;
  const muscularStatus = lastMuscular?.day === to ? classifyLoadStatus(muscularSeries, "muscular") : null;

  return {
    from,
    to,
    cardioSeries: cardioSeries.filter((point) => point.day >= from),
    muscularSeries: muscularSeries.filter((point) => point.day >= from),
    latestCardio: lastCardio?.day === to
      ? { daily: lastCardio.rawLoad, acute7d: lastCardio.acute7d, chronic42d: lastCardio.chronic42d }
      : null,
    latestMuscular: lastMuscular?.day === to
      ? { daily: lastMuscular.rawLoad, acute7d: lastMuscular.acute7d, chronic42d: lastMuscular.chronic42d }
      : null,
    cardioStatus,
    muscularStatus,
    muscleSummaries,
    muscleFreshness,
    exerciseProgression,
    dataQuality: {
      totalDays: days.length,
      completeDays: days.filter((d) => d.confidence === "complete").length,
      partialDays: days.filter((d) => d.confidence === "partial").length,
      incompleteDays: days.filter((d) => d.confidence === "incomplete").length,
      restDays: days.filter((d) => d.confidence === "rest").length,
    },
    disclaimer:
      "App-specific estimated workload, not a validated recovery, fitness or injury score. Acute/chronic comparisons describe recorded load; missing days are not rest. Muscle activation is title-based; workout logs cannot establish a physiological recovery percentage.",
  };
}


/** Observed load history, deliberately not a tissue-repair model. */
export function summarizeMuscleHistory(
  sessions: { day: string; endedAt: string; loads: Partial<Record<MuscleGroup, number>> }[],
  at: Date,
  weeklySets: Partial<Record<MuscleGroup, number>> = {},
  recentLoads: Partial<Record<MuscleGroup, number>> = {},
): MuscleFreshnessEntry[] {
  const atMs = at.getTime();
  return MUSCLE_GROUPS.map((muscle) => {
    const history = sessions.filter((session) => {
      const ms = new Date(session.endedAt).getTime();
      return Number.isFinite(ms) && ms <= atMs && atMs - ms <= 42 * 86_400_000 && (session.loads[muscle] ?? 0) > 0;
    }).sort((a, b) => new Date(a.endedAt).getTime() - new Date(b.endedAt).getTime());
    const trainingDays = new Set(history.map((session) => session.day)).size;
    const last = history.at(-1);
    const hours = last ? (atMs - new Date(last.endedAt).getTime()) / 3_600_000 : null;
    const previousLoads = history.slice(0, -1).map((session) => session.loads[muscle]!).sort((a, b) => a - b);
    const middle = Math.floor(previousLoads.length / 2);
    const reference = trainingDays >= 3 && previousLoads.length >= 2
      ? (previousLoads.length % 2 ? previousLoads[middle] : (previousLoads[middle - 1] + previousLoads[middle]) / 2)
      : null;
    return {
      muscle,
      freshnessPct: null,
      status: !last ? "unknown" : reference == null ? "calibrating" : "tracked",
      lastTrainedAt: last?.endedAt ?? null,
      hoursSinceTrained: hours == null ? null : Math.round(hours * 10) / 10,
      daysSinceTrained: hours == null ? null : Math.floor(hours / 24),
      lastTrainedDay: last?.day ?? null,
      weeklyWorkingSets: Math.round((weeklySets[muscle] ?? 0) * 10) / 10,
      recentLoad: Math.round((recentLoads[muscle] ?? 0) * 100) / 100,
      trainingDays,
      confidence: !last ? "unknown" : reference == null ? "low" : "moderate",
      sessionLoadRatio: reference && last ? Math.round(last.loads[muscle]! / reference * 100) / 100 : null,
      referenceSessionLoad: reference == null ? null : Math.round(reference * 100) / 100,
      modelNote: "Observed, title-mapped effort-weighted set load. Personal comparison uses prior sessions of this muscle (at least three distinct training days in 42 days). It is not a measured recovery percentage; soreness, tissue repair and readiness are unknown.",
    };
  });
}
