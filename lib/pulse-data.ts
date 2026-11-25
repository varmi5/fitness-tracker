import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { addDays, isCalorieGoalMet } from "./nutrition-model";
import {
  computeBehaviorImpacts,
  computeBiologicalAge,
  computeEnergyBankAndStress,
  computeFitnessLevel,
  computeHealthMonitor,
  computeHrRecovery,
  computePulseRecovery,
  computeRecoveryForecast,
  computeSleepInsights,
  selectNonOverlappingSleepSessions,
  type SleepNightRecord,
  type BehaviorDayObservation,
  type BehaviorImpactItem,
  type BiologicalAgeResult,
  type BiologicalSex,
  type DaytimeStressResult,
  type EnergyBankResult,
  type FitnessCategory,
  type HealthspanDayInput,
  type HrRecoveryResult,
  type PulseForecastResult,
  type PulseHealthMonitorResult,
  type PulseRecoveryResult,
  type PulseSleepResult,
} from "./pulse-engine";
import * as schema from "./schema";
import { computeTargetStrain, type TargetStrainRecommendation } from "./strain-engine";
import { getTrainingLoadSummary } from "./training-load";

export interface PulseInsightsView {
  day: string;
  recovery: PulseRecoveryResult;
  sleep: PulseSleepResult;
  healthMonitor: PulseHealthMonitorResult;
  forecast: PulseForecastResult;
  strainTarget: TargetStrainRecommendation;
  energyBank: EnergyBankResult;
  stress: DaytimeStressResult;
  fitnessLevel: {
    vo2max: number | null;
    percentile: number | null;
    category: FitnessCategory | null;
  };
  biologicalAge: BiologicalAgeResult;
  workoutHrrById: Record<string, HrRecoveryResult>;
  behaviorImpacts: BehaviorImpactItem[];
}

function ageFromBirthDate(birthDate: string | null, anchorDay: string, fallbackAge: number | null): number | null {
  if (birthDate) {
    const birthMs = new Date(`${birthDate}T00:00:00Z`).getTime();
    const anchorMs = new Date(`${anchorDay}T00:00:00Z`).getTime();
    if (Number.isFinite(birthMs) && Number.isFinite(anchorMs) && anchorMs > birthMs) {
      return (anchorMs - birthMs) / (365.2425 * 86400 * 1000);
    }
  }
  return fallbackAge;
}

export async function getPulseInsightsForUser(
  db: NodePgDatabase<typeof schema>,
  userId: string,
  day: string,
): Promise<PulseInsightsView> {
  const from180 = addDays(day, -179);
  const from45 = addDays(day, -44);

  const [
    recoveryRows,
    sleepRows,
    energyRows,
    strainRows,
    workoutRows,
    hevyRows,
    hrDayRows,
    profileRows,
    trainingPrefRows,
    nutritionPrefRows,
    targetRows,
    mealRows,
    loadSummary, sessionRows, goalRows, dayStatusRows,
  ] = await Promise.all([
    db
      .select()
      .from(schema.dailyRecovery)
      .where(and(eq(schema.dailyRecovery.userId, userId), gte(schema.dailyRecovery.day, from180), lte(schema.dailyRecovery.day, day)))
      .orderBy(asc(schema.dailyRecovery.day)),
    db
      .select()
      .from(schema.dailySleep)
      .where(and(eq(schema.dailySleep.userId, userId), gte(schema.dailySleep.day, from180), lte(schema.dailySleep.day, day)))
      .orderBy(asc(schema.dailySleep.day)),
    db
      .select()
      .from(schema.dailyEnergy)
      .where(and(eq(schema.dailyEnergy.userId, userId), gte(schema.dailyEnergy.day, from180), lte(schema.dailyEnergy.day, day)))
      .orderBy(asc(schema.dailyEnergy.day)),
    db
      .select()
      .from(schema.dailyStrain)
      .where(and(eq(schema.dailyStrain.userId, userId), gte(schema.dailyStrain.day, from45), lte(schema.dailyStrain.day, day)))
      .orderBy(asc(schema.dailyStrain.day)),
    db
      .select()
      .from(schema.dailyWorkout)
      .where(and(eq(schema.dailyWorkout.userId, userId), gte(schema.dailyWorkout.day, from180), lte(schema.dailyWorkout.day, day)))
      .orderBy(asc(schema.dailyWorkout.day)),
    db
      .select()
      .from(schema.hevyWorkout)
      .where(and(eq(schema.hevyWorkout.userId, userId), gte(schema.hevyWorkout.day, from180), lte(schema.hevyWorkout.day, day)))
      .orderBy(asc(schema.hevyWorkout.day)),
    db
      .select({ recordedAt: schema.heartRateSample.recordedAt, bpm: schema.heartRateSample.bpm })
      .from(schema.heartRateSample)
      .where(and(eq(schema.heartRateSample.userId, userId), eq(schema.heartRateSample.day, day)))
      .orderBy(asc(schema.heartRateSample.recordedAt)),
    db.select().from(schema.profile).where(eq(schema.profile.userId, userId)).limit(1),
    db.select().from(schema.trainingPreference).where(eq(schema.trainingPreference.userId, userId)).limit(1),
    db.select().from(schema.nutritionPreference).where(eq(schema.nutritionPreference.userId, userId)).limit(1),
    db
      .select()
      .from(schema.calorieTarget)
      .where(eq(schema.calorieTarget.userId, userId))
      .orderBy(desc(schema.calorieTarget.effectiveFrom)),
    db
      .select({
        day: schema.meal.localDay,
        calories: schema.mealItem.calories,
        proteinG: schema.mealItem.proteinG,
      })
      .from(schema.meal)
      .leftJoin(schema.mealItem, eq(schema.mealItem.mealId, schema.meal.id))
      .where(and(eq(schema.meal.userId, userId), gte(schema.meal.localDay, from45), lte(schema.meal.localDay, day))),
    getTrainingLoadSummary(db, userId, addDays(day, -83), day).catch(() => null),
    db.select().from(schema.sleepSession).where(and(eq(schema.sleepSession.userId, userId), gte(schema.sleepSession.day, from180), lte(schema.sleepSession.day, day))).orderBy(asc(schema.sleepSession.day)),
    db.select().from(schema.sleepGoal).where(and(eq(schema.sleepGoal.userId, userId), lte(schema.sleepGoal.effectiveFrom, day))).orderBy(desc(schema.sleepGoal.effectiveFrom)),
    db.select().from(schema.nutritionDayStatus).where(and(eq(schema.nutritionDayStatus.userId, userId), gte(schema.nutritionDayStatus.day, from45), lte(schema.nutritionDayStatus.day, day))),
  ]);

  const timezone = nutritionPrefRows[0]?.timezone ?? "Europe/London";
  const goalForDay = (d: string) => (goalRows.find((g) => g.effectiveFrom <= d)?.goalMinutes ?? 480) / 60;
  const recByDay = new Map<string, (typeof recoveryRows)[number]>();
  // Prefer the most recently synced record; ties are stable by source.
  for (const r of [...recoveryRows].sort((a, b) => a.syncedAt.getTime() - b.syncedAt.getTime() || a.source.localeCompare(b.source))) recByDay.set(r.day, r);
  const sessionDays = new Set(sessionRows.map((r) => r.day));
  const sleepRecords: SleepNightRecord[] = selectNonOverlappingSleepSessions([
    ...sessionRows.filter((r) => r.processed !== false).map((r) => ({ ...r, coverageComplete: false })),
    ...sleepRows.filter((r) => !sessionDays.has(r.day)).map((r) => ({ ...r, isMainSleep: true, coverageComplete: false })),
  ]);
  const sleepByDay = new Map<string, SleepNightRecord>();
  for (const s of sleepRecords) {
    if (s.isMainSleep === false) continue;
    const previous = sleepByDay.get(s.day);
    if (!previous || s.minutesAsleep > previous.minutesAsleep) sleepByDay.set(s.day, s);
  }

  const energyByDay = new Map<string, (typeof energyRows)[number]>();
  for (const e of energyRows) {
    const prev = energyByDay.get(e.day);
    if (!prev || e.source === "google") energyByDay.set(e.day, e);
  }

  const strainByDay = new Map<string, (typeof strainRows)[number]>();
  for (const st of strainRows) strainByDay.set(st.day, st);

  const recoveryInputForDay = (d: string) => {
    const r = recByDay.get(d), s = sleepByDay.get(d);
    return { source: r?.source, hrvRmssdMs: r?.hrvRmssdMs ?? null, restingHrBpm: r?.restingHrBpm ?? null,
      respiratoryRate: r?.respiratoryRate ?? null, skinTempDeltaC: r?.skinTempDeltaC ?? null,
      sleepHours: s ? s.minutesAsleep / 60 : null };
  };
  const baselineBefore = (d: string) => Array.from({ length: 28 }, (_, i) => recoveryInputForDay(addDays(d, -28 + i)));
  const priorDays = baselineBefore(day);
  const yesterdayStrain = strainByDay.get(addDays(day, -1))?.overallStrain ?? null;
  const todaySleep = sleepByDay.get(day) ?? null;
  const sleep = computeSleepInsights(todaySleep, sleepRecords, day, yesterdayStrain, { timezone, goalForDay });

  const todayRec = recByDay.get(day);
  const recovery = computePulseRecovery(
    {
      source: todayRec?.source,
      hrvRmssdMs: todayRec?.hrvRmssdMs ?? null,
      restingHrBpm: todayRec?.restingHrBpm ?? null,
      respiratoryRate: todayRec?.respiratoryRate ?? null,
      skinTempDeltaC: todayRec?.skinTempDeltaC ?? null,
      sleepHours: todaySleep ? todaySleep.minutesAsleep / 60 : null,
    },
    priorDays,
    sleep.sleepNeedHours,
  );

  const healthMonitor = computeHealthMonitor(
    {
      restingHrBpm: todayRec?.restingHrBpm ?? null,
      hrvRmssdMs: todayRec?.hrvRmssdMs ?? null,
      respiratoryRate: todayRec?.respiratoryRate ?? null,
      spo2Pct: todayRec?.spo2Pct ?? null,
      skinTempDeltaC: todayRec?.skinTempDeltaC ?? null,
    },
    priorDays.map(d => todayRec?.source && d.source !== todayRec.source ? { ...d, hrvRmssdMs: null, restingHrBpm: null, respiratoryRate: null, skinTempDeltaC: null } : d),
  );

  // Recent recovery scores for 14d forecast
  const recentRecoveryScores = Array.from({ length: 14 }, (_, idx) => {
    const d = addDays(day, -14 + idx);
    const r = recByDay.get(d);
    const s = sleepByDay.get(d);
    return computePulseRecovery(
      {
        source: r?.source,
        hrvRmssdMs: r?.hrvRmssdMs ?? null,
        restingHrBpm: r?.restingHrBpm ?? null,
        respiratoryRate: r?.respiratoryRate ?? null,
        skinTempDeltaC: r?.skinTempDeltaC ?? null,
        sleepHours: s && s.minutesAsleep > 0 ? s.minutesAsleep / 60 : null,
      },
      baselineBefore(d),
      goalForDay(d),
    ).score;
  });

  const todayStrainRow = strainByDay.get(day);
  const forecast = computeRecoveryForecast(
    recentRecoveryScores,
    todayStrainRow?.overallStrain ?? null,
    null, // Achieved sleep is not a future sleep plan.
    sleep.sleepNeedHours,
  );

  const acwr = loadSummary?.cardioStatus?.acwr ?? loadSummary?.muscularStatus?.acwr ?? null;
  const priorEffort = Array.from({ length: 14 }, (_, idx) => strainByDay.get(addDays(day, -14 + idx))?.overallStrain ?? null);
  const strainTarget = computeTargetStrain(recovery.score, { acwr, priorEffort });

  const maxHr = trainingPrefRows[0]?.maxHrBpm ?? 190;
  const todayHrSamples = hrDayRows.map((h) => ({ recordedAt: h.recordedAt.toISOString(), bpm: h.bpm }));
  const todayWorkouts = [
    ...workoutRows
      .filter((w) => w.day === day && w.startTime && w.endTime)
      .map((w) => ({
        id: `google:${w.sessionId}`,
        startMs: w.startTime!.getTime(),
        endMs: w.endTime!.getTime(),
      })),
    ...hevyRows
      .filter((h) => h.day === day)
      .map((h) => ({
        id: `hevy:${h.hevyId}`,
        startMs: h.startTime.getTime(),
        endMs: h.endTime.getTime(),
      })),
  ];

  const latestRhr = todayRec?.restingHrBpm ?? priorDays.slice().reverse().find((d) => d.restingHrBpm != null)?.restingHrBpm ?? null;
  const { energyBank, stress } = computeEnergyBankAndStress(
    todayHrSamples,
    latestRhr,
    maxHr,
    recovery.score,
    sleep.score,
    todayWorkouts.map((w) => ({ startMs: w.startMs, endMs: w.endMs })),
    sleepRecords.filter((s) => s.sleepStart && s.sleepEnd).map((s) => ({ startMs: s.sleepStart!.getTime(), endMs: s.sleepEnd!.getTime() })),
  );

  const workoutHrrById: Record<string, HrRecoveryResult> = {};
  for (const w of todayWorkouts) {
    const hrr = computeHrRecovery(todayHrSamples, w.startMs, w.endMs, maxHr);
    if (hrr) workoutHrrById[w.id] = hrr;
  }

  // Profile biometrics for Fitness Level & Biological Age
  const prof = profileRows[0];
  const age = ageFromBirthDate(prof?.birthDate ?? null, day, trainingPrefRows[0]?.age ?? null);
  const sex = (prof?.biologicalSex === "male" || prof?.biologicalSex === "female" ? prof.biologicalSex : null) as BiologicalSex | null;

  const latestVo2 =
    [...recoveryRows].reverse().find((r) => r.vo2Max != null)?.vo2Max ?? null;
  const fitnessLevel = computeFitnessLevel(latestVo2, age, sex);

  // Build 180-day HealthspanDayInput array
  const workoutsByDay = new Map<string, { strengthMin: number; cardioMin: number; vigorousMin: number }>();
  for (const h of hevyRows) {
    const cur = workoutsByDay.get(h.day) ?? { strengthMin: 0, cardioMin: 0, vigorousMin: 0 };
    cur.strengthMin += Math.round((h.durationSeconds ?? 0) / 60);
    workoutsByDay.set(h.day, cur);
  }
  for (const w of workoutRows) {
    const cur = workoutsByDay.get(w.day) ?? { strengthMin: 0, cardioMin: 0, vigorousMin: 0 };
    const mins = Math.round((w.durationSeconds ?? 0) / 60);
    if (/strength|weight|crossfit|calisthenics/i.test(w.exerciseType || w.title)) {
      cur.strengthMin += mins;
    } else if (w.activeZoneMinutes != null && w.activeZoneMinutes > 0) {
      cur.cardioMin += mins; // AZM does not identify elapsed time in individual HR zones.
    } else {
      cur.cardioMin += mins;
    }
    workoutsByDay.set(w.day, cur);
  }

  const allDaysSet = new Set<string>([
    ...recoveryRows.map((r) => r.day),
    ...sleepRows.map((s) => s.day),
    ...energyRows.map((e) => e.day),
    ...workoutsByDay.keys(),
  ]);

  const hasAnyWorkoutHistory = hevyRows.length > 0 || workoutRows.length > 0;
  const healthspanDays: HealthspanDayInput[] = [...allDaysSet]
    .sort()
    .map((d) => {
      const r = recByDay.get(d);
      const s = sleepByDay.get(d);
      const e = energyByDay.get(d);
      const w = workoutsByDay.get(d);
      return {
        day: d,
        sleepHours: s && s.minutesAsleep > 0 ? s.minutesAsleep / 60 : null,
        sri: null,
        zone13Min: w?.cardioMin ?? (e?.activeZoneMinutes != null ? e.activeZoneMinutes : null),
        zone45Min: w?.vigorousMin ?? null,
        strengthMin: hasAnyWorkoutHistory ? (w?.strengthMin ?? 0) : null,
        steps: e?.steps ?? null,
        vo2max: r?.vo2Max ?? null,
        restingHr: r?.restingHrBpm ?? null,
        weightKg: e?.weightKg ?? null,
        bodyFatPct: r?.bodyFatPct ?? null,
      };
    });

  // Exclude an incomplete in-progress current day when completed history exists
  const completedBioDays = healthspanDays.filter((d) => d.day < day);
  const bioInput = completedBioDays.length > 0 ? completedBioDays : healthspanDays;

  const biologicalAge = computeBiologicalAge(
    bioInput,
    { age, sex, heightCm: prof?.heightCm ?? null },
    day,
  );

  // Auto Behavior Impact over trailing 45 days
  const nutritionByDay = new Map<string, { calories: number; proteinG: number; knownCalories: boolean; knownProtein: boolean }>();
  const completeNutritionDays = new Set(dayStatusRows.filter((d) => d.complete).map((d) => d.day));
  for (const m of mealRows) {
    const cur = nutritionByDay.get(m.day) ?? { calories: 0, proteinG: 0, knownCalories: true, knownProtein: true };
    cur.knownCalories &&= m.calories != null;
    cur.knownProtein &&= m.proteinG != null;
    cur.calories += m.calories ?? 0;
    cur.proteinG += m.proteinG ?? 0;
    nutritionByDay.set(m.day, cur);
  }
  const bulkMode = Boolean(nutritionPrefRows[0]?.bulkMode);
  const observations: BehaviorDayObservation[] = Array.from({ length: 44 }, (_, idx) => {
    const d = addDays(day, -44 + idx);
    const nextD = addDays(d, 1);
    const nextRec = recByDay.get(nextD);
    const nextSleep = sleepByDay.get(nextD);
    const nextRecoveryScore = computePulseRecovery(
      {
        source: nextRec?.source,
        hrvRmssdMs: nextRec?.hrvRmssdMs ?? null,
        restingHrBpm: nextRec?.restingHrBpm ?? null,
        respiratoryRate: nextRec?.respiratoryRate ?? null,
        skinTempDeltaC: nextRec?.skinTempDeltaC ?? null,
        sleepHours: nextSleep && nextSleep.minutesAsleep > 0 ? nextSleep.minutesAsleep / 60 : null,
      },
      baselineBefore(nextD),
      goalForDay(nextD),
    ).score;

    const nut = nutritionByDay.get(d);
    const tgtRow = targetRows.find((t) => t.effectiveFrom <= d);
    const kcalTgt = tgtRow?.calories ?? 2000;
    const protTgt = tgtRow?.proteinG ?? 130;
    const w = workoutsByDay.get(d);
    const e = energyByDay.get(d);
    const s = sleepByDay.get(d);

    return {
      day: d,
      nextDayRecovery: nextRecoveryScore,
      proteinGoalHit: nut && nut.knownProtein && completeNutritionDays.has(d) ? nut.proteinG >= protTgt * 0.9 : null,
      calorieTargetMet: nut && nut.knownCalories && completeNutritionDays.has(d) ? isCalorieGoalMet(nut.calories, kcalTgt, bulkMode) === true : null,
      strengthWorkout: w ? w.strengthMin > 0 : null,
      cardioWorkout: w ? w.cardioMin > 0 || w.vigorousMin > 0 : null,
      tenKSteps: e?.steps != null ? e.steps >= 10000 : null,
      goodSleep: s && s.minutesAsleep > 0 ? s.minutesAsleep >= goalForDay(d) * 60 : null,
    };
  });

  const behaviorImpacts = computeBehaviorImpacts(observations);

  return {
    day,
    recovery,
    sleep,
    healthMonitor,
    forecast,
    strainTarget,
    energyBank,
    stress,
    fitnessLevel,
    biologicalAge,
    workoutHrrById,
    behaviorImpacts,
  };
}
