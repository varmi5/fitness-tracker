import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import type { z } from "zod";
import type { AuthDatabase } from "./auth";
import { MUSCLE_GROUPS, type MuscleGroup } from "./muscle-map";
import { dayRange } from "./nutrition-model";
import {
  dailyEnergy,
  dailyStrain,
  dailyWorkout,
  heartRateSample,
  hevySet,
  hevyWorkout,
  stepInterval,
  trainingPreference,
} from "./schema";
import {
  computeCompositeStrain,
  computeEdwardsTrimp,
  computeMuscularWorkload,
  computeWalkingContribution,
  DEFAULT_STRAIN_SETTINGS,
  STRAIN_ALGORITHM_VERSION,
  trainingPreferenceInput,
  type StrainSettings,
  type TrimpZoneBreakdown,
  type WalkingSensitivity,
} from "./strain-engine";

export interface StrainActivityBreakdown {
  id: string;
  kind: "strength" | "cardio" | "walking";
  title: string;
  source: string;
  startTime: string | null;
  endTime: string | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  caloriesKcal: number | null;
  avgHrBpm: number | null;
  cRaw: number;
  mRaw: number;
  overallPointsContribution: number;
  status: "complete" | "partial" | "incomplete" | "disabled";
  notes: string[];
  trimpZones?: TrimpZoneBreakdown[];
  hrSeries?: { recordedAt: string; bpm: number }[];
  sets?: {
    exerciseTitle: string;
    setIndex: number;
    setType: string;
    weightKg: number | null;
    reps: number | null;
    rpe: number | null;
    notes: string;
  }[];
  walkingDetail?: {
    totalSteps: number | null;
    excludedWorkoutSteps: number | null;
    eligibleSteps: number | null;
    threshold: number;
    excessSteps: number;
    walkingPoints: number;
    sensitivity: WalkingSensitivity;
    maxPoints: number;
  };
}

export interface DailyStrainView {
  day: string;
  algorithmVersion: string;
  overallStrain: number | null;
  cardioStrain: number | null;
  muscularStrain: number | null;
  cRaw: number;
  mRaw: number;
  walkingPoints: number;
  totalSteps: number | null;
  excludedWorkoutSteps: number | null;
  eligibleSteps: number | null;
  excessSteps: number | null;
  confidence: "complete" | "partial" | "incomplete" | "rest";
  muscleLoads: Record<MuscleGroup, number>;
  activities: StrainActivityBreakdown[];
  settingsSnapshot: StrainSettings;
  computedAt: string;
}

export function overlapStepsForWindows(
  intervals: { startTime: Date; endTime: Date; steps: number }[],
  windows: { startTime: Date; endTime: Date }[],
): number | null {
  if (windows.length === 0) return 0;
  if (intervals.length === 0) return null;

  let excluded = 0;
  for (const iv of intervals) {
    const ivStart = iv.startTime.getTime();
    const ivEnd = iv.endTime.getTime();
    const ivDur = ivEnd - ivStart;
    if (ivDur <= 0 || iv.steps <= 0) continue;

    let maxFrac = 0;
    for (const w of windows) {
      const wStart = w.startTime.getTime();
      const wEnd = w.endTime.getTime();
      const overlap = Math.max(0, Math.min(ivEnd, wEnd) - Math.max(ivStart, wStart));
      if (overlap > 0) {
        maxFrac = Math.min(1, Math.max(maxFrac, overlap / ivDur));
      }
    }
    if (maxFrac > 0) {
      excluded += Math.round(iv.steps * maxFrac);
    }
  }
  return excluded;
}

export function strainData(db: AuthDatabase, userId: string) {
  if (!userId) throw new Error("A session user ID is required.");

  async function getSettings(): Promise<StrainSettings> {
    const [row] = await db
      .select()
      .from(trainingPreference)
      .where(eq(trainingPreference.userId, userId));
    if (!row) return { ...DEFAULT_STRAIN_SETTINGS };
    return {
      maxHrBpm: row.maxHrBpm,
      age: row.age,
      maxHrIsEstimated: row.maxHrIsEstimated,
      walkingEnabled: row.walkingEnabled,
      walkingStepThreshold: row.walkingStepThreshold,
      walkingSensitivity: (row.walkingSensitivity as WalkingSensitivity) || "normal",
      walkingMaxPoints: row.walkingMaxPoints,
    };
  }

  async function updateSettings(raw: z.input<typeof trainingPreferenceInput>): Promise<StrainSettings> {
    const input = trainingPreferenceInput.parse(raw);
    const current = await getSettings();

    let nextMaxHr = input.maxHrBpm ?? current.maxHrBpm;
    let nextAge = input.age !== undefined ? input.age : current.age;
    let nextEstimated = input.maxHrIsEstimated ?? current.maxHrIsEstimated;

    if (input.age !== undefined && input.age != null && input.maxHrBpm === undefined) {
      nextMaxHr = Math.max(120, Math.min(230, 220 - input.age));
      nextEstimated = true;
    } else if (input.maxHrBpm !== undefined && input.maxHrIsEstimated === undefined) {
      nextEstimated = false;
    }

    const next: StrainSettings = {
      maxHrBpm: nextMaxHr,
      age: nextAge,
      maxHrIsEstimated: nextEstimated,
      walkingEnabled: input.walkingEnabled ?? current.walkingEnabled,
      walkingStepThreshold: input.walkingStepThreshold ?? current.walkingStepThreshold,
      walkingSensitivity: input.walkingSensitivity ?? current.walkingSensitivity,
      walkingMaxPoints: input.walkingMaxPoints ?? current.walkingMaxPoints,
    };

    await db
      .insert(trainingPreference)
      .values({
        userId,
        ...next,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: trainingPreference.userId,
        set: { ...next, updatedAt: new Date() },
      });

    return next;
  }

  async function computeDay(day: string, settingsOverride?: StrainSettings): Promise<DailyStrainView> {
    const settings = settingsOverride ?? (await getSettings());

    const [hevyRows, googleWorkoutRows, hrRows, energyRows, stepRows] = await Promise.all([
      db
        .select()
        .from(hevyWorkout)
        .where(and(eq(hevyWorkout.userId, userId), eq(hevyWorkout.day, day)))
        .orderBy(asc(hevyWorkout.startTime)),
      db
        .select()
        .from(dailyWorkout)
        .where(and(eq(dailyWorkout.userId, userId), eq(dailyWorkout.day, day)))
        .orderBy(asc(dailyWorkout.startTime)),
      db
        .select()
        .from(heartRateSample)
        .where(and(eq(heartRateSample.userId, userId), eq(heartRateSample.day, day)))
        .orderBy(asc(heartRateSample.recordedAt)),
      db
        .select()
        .from(dailyEnergy)
        .where(and(eq(dailyEnergy.userId, userId), eq(dailyEnergy.day, day))),
      db
        .select()
        .from(stepInterval)
        .where(and(eq(stepInterval.userId, userId), eq(stepInterval.day, day)))
        .orderBy(asc(stepInterval.startTime)),
    ]);

    const hevyIds = hevyRows.map((h) => h.hevyId);
    const setRows = hevyIds.length
      ? await db
          .select()
          .from(hevySet)
          .where(and(eq(hevySet.userId, userId), inArray(hevySet.hevyId, hevyIds)))
          .orderBy(asc(hevySet.exerciseIndex), asc(hevySet.setIndex))
      : [];

    const setsByHevy = new Map<string, (typeof setRows)[number][]>();
    for (const s of setRows) {
      const list = setsByHevy.get(s.hevyId) ?? [];
      list.push(s);
      setsByHevy.set(s.hevyId, list);
    }

    const hrSeriesAll = hrRows.map((r) => ({ recordedAt: r.recordedAt.toISOString(), bpm: r.bpm }));
    const matchedGoogleIds = new Set(
      hevyRows.map((h) => h.matchedGoogleSessionId).filter((v): v is string => Boolean(v)),
    );
    const googleById = new Map(googleWorkoutRows.map((g) => [g.sessionId, g]));

    const activities: StrainActivityBreakdown[] = [];
    const workoutWindows: { startTime: Date; endTime: Date }[] = [];
    const totalMuscleLoads = Object.fromEntries(MUSCLE_GROUPS.map((m) => [m, 0])) as Record<MuscleGroup, number>;
    let totalCRaw = 0;
    let totalMRaw = 0;
    let hasIncompleteWorkout = false;

    for (const hw of hevyRows) {
      const sets = setsByHevy.get(hw.hevyId) ?? [];
      const matchedG = hw.matchedGoogleSessionId ? googleById.get(hw.matchedGoogleSessionId) : undefined;
      const startMs = hw.startTime.getTime();
      const endMs = hw.endTime.getTime();
      workoutWindows.push({ startTime: hw.startTime, endTime: hw.endTime });

      const windowHr = hrSeriesAll.filter((s) => {
        const t = new Date(s.recordedAt).getTime();
        return t >= startMs - 60_000 && t <= endMs + 60_000;
      });

      const trimp = computeEdwardsTrimp(windowHr, settings.maxHrBpm, {
        fallbackActiveZoneMinutes: matchedG?.activeZoneMinutes ?? null,
      });
      const muscular = computeMuscularWorkload(sets);

      totalCRaw += trimp.cRaw;
      totalMRaw += muscular.mRaw;
      for (const g of MUSCLE_GROUPS) totalMuscleLoads[g] += muscular.muscleLoads[g];

      const notes: string[] = [];
      if (muscular.assumedRpeSetCount > 0) {
        notes.push(`${muscular.assumedRpeSetCount} set(s) used provisional default RPE assumption.`);
      }
      if (trimp.status === "unavailable") {
        notes.push(trimp.note);
        hasIncompleteWorkout = true;
      } else if (trimp.status === "estimated_azm") {
        notes.push(trimp.note);
      }

      const avgHr =
        windowHr.length > 0
          ? Math.round((windowHr.reduce((a, b) => a + b.bpm, 0) / windowHr.length) * 10) / 10
          : hw.avgHrBpm ?? matchedG?.avgHrBpm ?? null;

      activities.push({
        id: `hevy:${hw.hevyId}`,
        kind: "strength",
        title: hw.title,
        source: matchedG ? "Hevy + Google Health" : "Hevy",
        startTime: hw.startTime.toISOString(),
        endTime: hw.endTime.toISOString(),
        durationSeconds: hw.durationSeconds,
        distanceMeters: matchedG?.distanceMeters ?? null,
        caloriesKcal: matchedG?.caloriesKcal ?? null,
        avgHrBpm: avgHr,
        cRaw: trimp.cRaw,
        mRaw: muscular.mRaw,
        overallPointsContribution: 0,
        status: trimp.status === "unavailable" ? "partial" : "complete",
        notes,
        trimpZones: trimp.zones,
        hrSeries: windowHr,
        sets: sets.map((s) => ({
          exerciseTitle: s.exerciseTitle,
          setIndex: s.setIndex,
          setType: s.setType,
          weightKg: s.weightKg,
          reps: s.reps,
          rpe: s.rpe,
          notes: s.notes,
        })),
      });
    }

    for (const gw of googleWorkoutRows) {
      if (matchedGoogleIds.has(gw.sessionId)) continue;
      if (gw.startTime && gw.endTime) {
        workoutWindows.push({ startTime: gw.startTime, endTime: gw.endTime });
      }
      const startMs = gw.startTime?.getTime() ?? 0;
      const endMs = gw.endTime?.getTime() ?? startMs + (gw.durationSeconds ?? 0) * 1000;
      const windowHr =
        gw.startTime != null
          ? hrSeriesAll.filter((s) => {
              const t = new Date(s.recordedAt).getTime();
              return t >= startMs - 60_000 && t <= endMs + 60_000;
            })
          : [];

      const trimp = computeEdwardsTrimp(windowHr, settings.maxHrBpm, {
        fallbackActiveZoneMinutes: gw.activeZoneMinutes,
      });
      totalCRaw += trimp.cRaw;
      if (trimp.status === "unavailable") hasIncompleteWorkout = true;

      const avgHr =
        windowHr.length > 0
          ? Math.round((windowHr.reduce((a, b) => a + b.bpm, 0) / windowHr.length) * 10) / 10
          : gw.avgHrBpm;

      activities.push({
        id: `google:${gw.sessionId}`,
        kind: "cardio",
        title: gw.title,
        source: "Google Health",
        startTime: gw.startTime?.toISOString() ?? null,
        endTime: gw.endTime?.toISOString() ?? null,
        durationSeconds: gw.durationSeconds,
        distanceMeters: gw.distanceMeters,
        caloriesKcal: gw.caloriesKcal,
        avgHrBpm: avgHr,
        cRaw: trimp.cRaw,
        mRaw: 0,
        overallPointsContribution: 0,
        status: trimp.status === "unavailable" ? "incomplete" : trimp.status === "estimated_azm" ? "partial" : "complete",
        notes: [trimp.note],
        trimpZones: trimp.zones,
        hrSeries: windowHr,
      });
    }

    const googleEnergy = energyRows.find((e) => e.source === "google") ?? energyRows[0];
    const totalSteps = googleEnergy?.steps ?? null;
    const verifiedWorkoutSteps = overlapStepsForWindows(stepRows, workoutWindows);
    const walking = computeWalkingContribution(
      {
        totalSteps,
        verifiedWorkoutSteps,
        hasWorkoutOnDay: workoutWindows.length > 0,
      },
      settings,
    );

    const hasAnyActivity = activities.length > 0;
    const hasAnyData = hasAnyActivity || totalSteps != null || hrRows.length > 0;

    const composite = computeCompositeStrain(totalCRaw, totalMRaw, walking.cWalk);

    // Attribute overall points proportionally to each activity + walking
    const totalRawActivityScore = activities.reduce(
      (sum, a) => sum + a.cRaw / 100 + a.mRaw / 12,
      0,
    );
    const activityPointsPool = composite.attribution.cardioPoints + composite.attribution.muscularPoints;
    for (const act of activities) {
      const share =
        totalRawActivityScore > 0 ? (act.cRaw / 100 + act.mRaw / 12) / totalRawActivityScore : 0;
      act.overallPointsContribution = Math.round(activityPointsPool * share * 10) / 10;
    }

    if (totalSteps != null || !settings.walkingEnabled) {
      activities.push({
        id: `walking:${day}`,
        kind: "walking",
        title: "Daily Walking",
        source: googleEnergy?.source === "google" ? "Google Health Steps" : "Manual / Device Steps",
        startTime: null,
        endTime: null,
        durationSeconds: null,
        distanceMeters: googleEnergy?.distanceMeters ?? null,
        caloriesKcal: null,
        avgHrBpm: null,
        cRaw: 0,
        mRaw: 0,
        overallPointsContribution: composite.attribution.walkingPoints,
        status: walking.status === "measured" ? "complete" : walking.status === "disabled" ? "disabled" : "incomplete",
        notes: [walking.note],
        walkingDetail: {
          totalSteps: walking.totalSteps,
          excludedWorkoutSteps: walking.excludedWorkoutSteps,
          eligibleSteps: walking.eligibleSteps,
          threshold: walking.threshold,
          excessSteps: walking.excessSteps,
          walkingPoints: walking.walkingPoints,
          sensitivity: settings.walkingSensitivity,
          maxPoints: settings.walkingMaxPoints,
        },
      });
    }

    let confidence: DailyStrainView["confidence"] = "rest";
    if (!hasAnyData) {
      confidence = "incomplete";
    } else if (!hasAnyActivity && totalSteps != null) {
      confidence = walking.walkingPoints > 0 ? "complete" : "rest";
    } else if (hasIncompleteWorkout || walking.status === "incomplete") {
      confidence = "partial";
    } else {
      confidence = "complete";
    }

    for (const g of MUSCLE_GROUPS) {
      totalMuscleLoads[g] = Math.round(totalMuscleLoads[g] * 100) / 100;
    }

    const view: DailyStrainView = {
      day,
      algorithmVersion: STRAIN_ALGORITHM_VERSION,
      overallStrain: hasAnyData ? composite.overallStrain : null,
      cardioStrain: hasAnyData ? composite.cardioStrain : null,
      muscularStrain: hasAnyData ? composite.muscularStrain : null,
      cRaw: Math.round(totalCRaw * 100) / 100,
      mRaw: Math.round(totalMRaw * 100) / 100,
      walkingPoints: walking.walkingPoints,
      totalSteps: walking.totalSteps,
      excludedWorkoutSteps: walking.excludedWorkoutSteps,
      eligibleSteps: walking.eligibleSteps,
      excessSteps: walking.excessSteps,
      confidence,
      muscleLoads: totalMuscleLoads,
      activities,
      settingsSnapshot: settings,
      computedAt: new Date().toISOString(),
    };

    await db
      .insert(dailyStrain)
      .values({
        userId,
        day,
        algorithmVersion: view.algorithmVersion,
        overallStrain: view.overallStrain,
        cardioStrain: view.cardioStrain,
        muscularStrain: view.muscularStrain,
        cRaw: view.cRaw,
        mRaw: view.mRaw,
        walkingPoints: view.walkingPoints,
        totalSteps: view.totalSteps,
        excludedWorkoutSteps: view.excludedWorkoutSteps,
        eligibleSteps: view.eligibleSteps,
        excessSteps: view.excessSteps,
        confidence: view.confidence,
        muscleLoadsJson: view.muscleLoads,
        activitiesJson: view.activities,
        settingsSnapshotJson: view.settingsSnapshot,
        computedAt: new Date(view.computedAt),
      })
      .onConflictDoUpdate({
        target: [dailyStrain.userId, dailyStrain.day],
        set: {
          algorithmVersion: view.algorithmVersion,
          overallStrain: view.overallStrain,
          cardioStrain: view.cardioStrain,
          muscularStrain: view.muscularStrain,
          cRaw: view.cRaw,
          mRaw: view.mRaw,
          walkingPoints: view.walkingPoints,
          totalSteps: view.totalSteps,
          excludedWorkoutSteps: view.excludedWorkoutSteps,
          eligibleSteps: view.eligibleSteps,
          excessSteps: view.excessSteps,
          confidence: view.confidence,
          muscleLoadsJson: view.muscleLoads,
          activitiesJson: view.activities,
          settingsSnapshotJson: view.settingsSnapshot,
          computedAt: new Date(view.computedAt),
        },
      });

    return view;
  }

  async function recomputeRange(from: string, to: string) {
    const settings = await getSettings();
    const days = dayRange(from, to);
    const results: DailyStrainView[] = [];
    for (const d of days) {
      results.push(await computeDay(d, settings));
    }
    return results;
  }

  async function history(from: string, to: string): Promise<DailyStrainView[]> {
    const rows = await db
      .select()
      .from(dailyStrain)
      .where(and(eq(dailyStrain.userId, userId), gte(dailyStrain.day, from), lte(dailyStrain.day, to)))
      .orderBy(asc(dailyStrain.day));
    const byDay = new Map(rows.map((r) => [r.day, r]));
    const settings = await getSettings();
    const out: DailyStrainView[] = [];
    for (const d of dayRange(from, to)) {
      const existing = byDay.get(d);
      if (existing) {
        out.push({
          day: existing.day,
          algorithmVersion: existing.algorithmVersion,
          overallStrain: existing.overallStrain,
          cardioStrain: existing.cardioStrain,
          muscularStrain: existing.muscularStrain,
          cRaw: existing.cRaw,
          mRaw: existing.mRaw,
          walkingPoints: existing.walkingPoints,
          totalSteps: existing.totalSteps,
          excludedWorkoutSteps: existing.excludedWorkoutSteps,
          eligibleSteps: existing.eligibleSteps,
          excessSteps: existing.excessSteps,
          confidence: existing.confidence as DailyStrainView["confidence"],
          muscleLoads: existing.muscleLoadsJson as Record<MuscleGroup, number>,
          activities: existing.activitiesJson as StrainActivityBreakdown[],
          settingsSnapshot: existing.settingsSnapshotJson as StrainSettings,
          computedAt: existing.computedAt.toISOString(),
        });
      } else {
        out.push(await computeDay(d, settings));
      }
    }
    return out;
  }

  return {
    getSettings,
    updateSettings,
    computeDay,
    recomputeRange,
    history,
  };
}
