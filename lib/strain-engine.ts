import { z } from "zod";
import { distributeMuscleLoad, MUSCLE_GROUPS, resolveExerciseMuscles, type MuscleGroup, type MuscleMapping } from "./muscle-map";

export const STRAIN_ALGORITHM_VERSION = "strain-v2.1";
export const CARDIO_REFERENCE_C_RAW = 220;
export const MUSCULAR_REFERENCE_M_RAW = 18;
export const STRENGTH_CARDIO_FACTOR = 0.30;
export const COMPOSITE_EXPONENT = 1.3;
export const PROVISIONAL_MISSING_RPE_WEIGHT = 0.85;

export const WALKING_SENSITIVITIES = ["low", "normal", "high"] as const;
export type WalkingSensitivity = (typeof WALKING_SENSITIVITIES)[number];

export const WALKING_SENSITIVITY_DIVISOR: Record<WalkingSensitivity, number> = {
  low: 7500,
  normal: 5000,
  high: 3500,
};

export interface StrainSettings {
  maxHrBpm: number;
  age: number | null;
  maxHrIsEstimated: boolean;
  walkingEnabled: boolean;
  walkingStepThreshold: number;
  walkingSensitivity: WalkingSensitivity;
  walkingMaxPoints: number;
}

export const DEFAULT_STRAIN_SETTINGS: StrainSettings = {
  maxHrBpm: 190,
  age: null,
  maxHrIsEstimated: true,
  walkingEnabled: true,
  walkingStepThreshold: 10500,
  walkingSensitivity: "normal",
  walkingMaxPoints: 5,
};

export const trainingPreferenceInput = z.object({
  maxHrBpm: z.number().int().min(120).max(230).optional(),
  age: z.number().int().min(13).max(100).nullable().optional(),
  maxHrIsEstimated: z.boolean().optional(),
  walkingEnabled: z.boolean().optional(),
  walkingStepThreshold: z.number().int().min(0).max(25000).optional(),
  walkingSensitivity: z.enum(WALKING_SENSITIVITIES).optional(),
  walkingMaxPoints: z.number().finite().min(0).max(15).optional(),
});

export interface HrSampleInput {
  recordedAt: string;
  bpm: number;
}

export interface TrimpZoneBreakdown {
  zone: 1 | 2 | 3 | 4 | 5;
  label: string;
  minBpm: number;
  maxBpm: number;
  weight: number;
  minutes: number;
  trimp: number;
}

export interface TrimpResult {
  cRaw: number;
  zones: TrimpZoneBreakdown[];
  sampleCount: number;
  coveredMinutes: number;
  status: "measured" | "estimated_azm" | "unavailable";
  note: string;
}

export function computeEdwardsTrimp(
  samples: HrSampleInput[],
  maxHrBpm: number,
  options: { maxGapSeconds?: number; fallbackActiveZoneMinutes?: number | null } = {},
): TrimpResult {
  const maxHr = Math.max(120, Math.min(230, maxHrBpm || 190));
  const maxGapSec = options.maxGapSeconds ?? 180;
  const zoneDefs: { zone: 1 | 2 | 3 | 4 | 5; label: string; minPct: number; maxPct: number; weight: number }[] = [
    { zone: 1, label: "Zone 1 (50–59%)", minPct: 0.5, maxPct: 0.6, weight: 1 },
    { zone: 2, label: "Zone 2 (60–69%)", minPct: 0.6, maxPct: 0.7, weight: 2 },
    { zone: 3, label: "Zone 3 (70–79%)", minPct: 0.7, maxPct: 0.8, weight: 3 },
    { zone: 4, label: "Zone 4 (80–89%)", minPct: 0.8, maxPct: 0.9, weight: 4 },
    { zone: 5, label: "Zone 5 (90%+)", minPct: 0.9, maxPct: 2.0, weight: 5 },
  ];

  const zoneSeconds: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const sorted = samples
    .map((s) => ({ ms: new Date(s.recordedAt).getTime(), bpm: s.bpm }))
    .filter((s) => Number.isFinite(s.ms) && Number.isFinite(s.bpm) && s.bpm > 20 && s.bpm <= 260)
    .sort((a, b) => a.ms - b.ms);

  const zoneForBpm = (bpm: number): (1 | 2 | 3 | 4 | 5) | null => {
    const pct = bpm / maxHr;
    if (pct < 0.5) return null;
    if (pct < 0.6) return 1;
    if (pct < 0.7) return 2;
    if (pct < 0.8) return 3;
    if (pct < 0.9) return 4;
    return 5;
  };

  let coveredSec = 0;
  if (sorted.length >= 2) {
    for (let i = 0; i < sorted.length; i++) {
      const prevDt = i > 0 ? (sorted[i].ms - sorted[i - 1].ms) / 1000 : 60;
      const nextDt = i < sorted.length - 1 ? (sorted[i + 1].ms - sorted[i].ms) / 1000 : 60;
      const dt = Math.min(maxGapSec, Math.max(1, (Math.min(prevDt, maxGapSec) + Math.min(nextDt, maxGapSec)) / 2));
      coveredSec += dt;
      const z = zoneForBpm(sorted[i].bpm);
      if (z) zoneSeconds[z] += dt;
    }
  } else if (sorted.length === 1) {
    coveredSec = 60;
    const z = zoneForBpm(sorted[0].bpm);
    if (z) zoneSeconds[z] += 60;
  }

  if (sorted.length > 0) {
    const zones: TrimpZoneBreakdown[] = zoneDefs.map((d) => {
      const minutes = Math.round((zoneSeconds[d.zone] / 60) * 100) / 100;
      const trimp = Math.round(minutes * d.weight * 100) / 100;
      return {
        zone: d.zone,
        label: d.label,
        minBpm: Math.round(maxHr * d.minPct),
        maxBpm: d.zone === 5 ? maxHr : Math.round(maxHr * d.maxPct) - 1,
        weight: d.weight,
        minutes,
        trimp,
      };
    });
    const cRaw = Math.round(zones.reduce((sum, z) => sum + z.trimp, 0) * 100) / 100;
    return {
      cRaw,
      zones,
      sampleCount: sorted.length,
      coveredMinutes: Math.round((coveredSec / 60) * 10) / 10,
      status: "measured",
      note: `Edwards TRIMP from ${sorted.length} timestamped HR sample(s).`,
    };
  }

  // Fallback to trustworthy Active Zone Minutes summary only if provided
  const azm = options.fallbackActiveZoneMinutes;
  if (azm != null && Number.isFinite(azm) && azm > 0) {
    const zones: TrimpZoneBreakdown[] = zoneDefs.map((d) => ({
      zone: d.zone,
      label: d.label,
      minBpm: Math.round(maxHr * d.minPct),
      maxBpm: d.zone === 5 ? maxHr : Math.round(maxHr * d.maxPct) - 1,
      weight: d.weight,
      minutes: d.zone === 2 ? azm : 0,
      trimp: d.zone === 2 ? Math.round(azm * 2 * 100) / 100 : 0,
    }));
    return {
      cRaw: Math.round(azm * 2 * 100) / 100,
      zones,
      sampleCount: 0,
      coveredMinutes: azm,
      status: "estimated_azm",
      note: `Estimated from ${azm} Active Zone Minute(s) (timestamped HR unavailable).`,
    };
  }

  return {
    cRaw: 0,
    zones: zoneDefs.map((d) => ({
      zone: d.zone,
      label: d.label,
      minBpm: Math.round(maxHr * d.minPct),
      maxBpm: d.zone === 5 ? maxHr : Math.round(maxHr * d.maxPct) - 1,
      weight: d.weight,
      minutes: 0,
      trimp: 0,
    })),
    sampleCount: 0,
    coveredMinutes: 0,
    status: "unavailable",
    note: "Timestamped HR samples unavailable; Cardio Strain not invented.",
  };
}

export interface HevySetForStrain {
  exerciseTitle: string;
  setType: string;
  reps: number | null;
  rpe: number | null;
  weightKg: number | null;
  durationSeconds?: number | null;
}

export interface MuscularLoadResult {
  mRaw: number;
  workingSetCount: number;
  warmupSetCount: number;
  assumedRpeSetCount: number;
  muscleLoads: Record<MuscleGroup, number>;
}

export function setTypeWeight(setType: string): number {
  const s = setType.toLowerCase();
  if (s === "warmup" || s === "warm_up") return 0;
  if (s === "failure") return 1.15;
  if (s === "dropset" || s === "drop_set") return 0.75;
  return 1.0;
}

export function effortWeightFromRpe(rpe: number | null | undefined): { weight: number; assumed: boolean } {
  if (rpe == null || !Number.isFinite(rpe)) {
    return { weight: PROVISIONAL_MISSING_RPE_WEIGHT, assumed: true };
  }
  const clamped = Math.max(5, Math.min(10, rpe));
  // RPE 6 -> 0.65, RPE 7 -> 0.775, RPE 8 -> 0.90, RPE 9 -> 1.025, RPE 10 -> 1.15
  const weight = Math.round((0.525 + (clamped - 5) * 0.125) * 1000) / 1000;
  return { weight, assumed: false };
}

export function repetitionWeight(reps: number | null | undefined, durationSeconds?: number | null): number {
  if (reps != null && Number.isFinite(reps) && reps > 0) {
    return Math.round(Math.min(1.6, 0.5 + 0.05 * Math.min(reps, 22)) * 1000) / 1000;
  }
  if (durationSeconds != null && Number.isFinite(durationSeconds) && durationSeconds > 0) {
    return Math.round(Math.min(1.4, 0.6 + (durationSeconds / 60) * 0.4) * 1000) / 1000;
  }
  return 0.8;
}

export function computeMuscularWorkload(
  sets: HevySetForStrain[],
  muscleOverrides?: Record<string, MuscleMapping>,
): MuscularLoadResult {
  let mRaw = 0;
  let workingSetCount = 0;
  let warmupSetCount = 0;
  let assumedRpeSetCount = 0;
  const muscleLoads = Object.fromEntries(MUSCLE_GROUPS.map((m) => [m, 0])) as Record<MuscleGroup, number>;

  for (const s of sets) {
    const stWeight = setTypeWeight(s.setType);
    if (stWeight <= 0) {
      warmupSetCount += 1;
      continue;
    }
    workingSetCount += 1;
    const { weight: effWeight, assumed } = effortWeightFromRpe(s.rpe);
    if (assumed) assumedRpeSetCount += 1;
    const repWeight = repetitionWeight(s.reps, s.durationSeconds);

    const setLoad = effWeight * repWeight * stWeight;
    mRaw += setLoad;

    const mapping = resolveExerciseMuscles(s.exerciseTitle, muscleOverrides);
    const dist = distributeMuscleLoad(setLoad, mapping);
    for (const g of MUSCLE_GROUPS) {
      muscleLoads[g] += dist[g];
    }
  }

  for (const g of MUSCLE_GROUPS) {
    muscleLoads[g] = Math.round(muscleLoads[g] * 100) / 100;
  }

  return {
    mRaw: Math.round(mRaw * 100) / 100,
    workingSetCount,
    warmupSetCount,
    assumedRpeSetCount,
    muscleLoads,
  };
}

export interface WalkingContributionResult {
  status: "measured" | "disabled" | "incomplete";
  totalSteps: number | null;
  excludedWorkoutSteps: number | null;
  eligibleSteps: number | null;
  threshold: number;
  excessSteps: number;
  walkingPoints: number;
  cWalk: number;
  note: string;
}

export function computeWalkingContribution(
  input: {
    totalSteps: number | null;
    verifiedWorkoutSteps: number | null;
    hasWorkoutOnDay: boolean;
  },
  settings: Pick<StrainSettings, "walkingEnabled" | "walkingStepThreshold" | "walkingSensitivity" | "walkingMaxPoints">,
): WalkingContributionResult {
  if (!settings.walkingEnabled) {
    return {
      status: "disabled",
      totalSteps: input.totalSteps,
      excludedWorkoutSteps: input.verifiedWorkoutSteps,
      eligibleSteps: input.totalSteps != null ? Math.max(0, input.totalSteps - (input.verifiedWorkoutSteps ?? 0)) : null,
      threshold: settings.walkingStepThreshold,
      excessSteps: 0,
      walkingPoints: 0,
      cWalk: 0,
      note: "Walking contribution disabled in Settings.",
    };
  }

  if (input.totalSteps == null) {
    return {
      status: "incomplete",
      totalSteps: null,
      excludedWorkoutSteps: input.verifiedWorkoutSteps,
      eligibleSteps: null,
      threshold: settings.walkingStepThreshold,
      excessSteps: 0,
      walkingPoints: 0,
      cWalk: 0,
      note: "Daily step count unavailable.",
    };
  }

  // Conservative policy: if a workout occurred and we have zero verified step-interval attribution,
  // mark walking contribution incomplete rather than guessing how many steps occurred during the workout.
  if (input.hasWorkoutOnDay && input.verifiedWorkoutSteps == null) {
    return {
      status: "incomplete",
      totalSteps: input.totalSteps,
      excludedWorkoutSteps: null,
      eligibleSteps: null,
      threshold: settings.walkingStepThreshold,
      excessSteps: 0,
      walkingPoints: 0,
      cWalk: 0,
      note: "Workout-window step intervals unavailable; walking bonus withheld to prevent double-counting.",
    };
  }

  const excluded = Math.max(0, input.verifiedWorkoutSteps ?? 0);
  const eligibleSteps = Math.max(0, input.totalSteps - excluded);
  const excessSteps = Math.max(0, eligibleSteps - settings.walkingStepThreshold);
  const divisor = WALKING_SENSITIVITY_DIVISOR[settings.walkingSensitivity];
  const rawPoints = excessSteps > 0 ? Math.min(settings.walkingMaxPoints, (settings.walkingMaxPoints * excessSteps) / divisor) : 0;
  const walkingPoints = Math.round(rawPoints * 100) / 100;
  const cWalk = walkingPoints > 0 ? Math.round(-Math.log(1 - Math.min(0.99, walkingPoints / 100)) * 10000) / 10000 : 0;

  return {
    status: "measured",
    totalSteps: input.totalSteps,
    excludedWorkoutSteps: excluded,
    eligibleSteps,
    threshold: settings.walkingStepThreshold,
    excessSteps,
    walkingPoints,
    cWalk,
    note:
      excessSteps > 0
        ? `${eligibleSteps.toLocaleString("en-GB")} eligible steps exceeded ${settings.walkingStepThreshold.toLocaleString("en-GB")} threshold by ${excessSteps.toLocaleString("en-GB")}.`
        : `${eligibleSteps.toLocaleString("en-GB")} eligible steps within ${settings.walkingStepThreshold.toLocaleString("en-GB")} free-step threshold.`,
  };
}

export interface CompositeStrainResult {
  algorithmVersion: string;
  overallStrain: number;
  cardioStrain: number;
  muscularStrain: number;
  cNormalized: number;
  cWalkNormalized: number;
  cTotalNormalized: number;
  mNormalized: number;
  attribution: {
    cardioPoints: number;
    muscularPoints: number;
    walkingPoints: number;
  };
}

export function computeCompositeStrain(
  cRaw: number,
  mRaw: number,
  cWalk = 0,
): CompositeStrainResult {
  const safeC = Math.max(0, Number.isFinite(cRaw) ? cRaw : 0);
  const safeM = Math.max(0, Number.isFinite(mRaw) ? mRaw : 0);
  const safeCWalk = Math.max(0, Number.isFinite(cWalk) ? cWalk : 0);

  const cNorm = safeC / CARDIO_REFERENCE_C_RAW;
  const cTotal = cNorm + safeCWalk;
  const mNorm = safeM / MUSCULAR_REFERENCE_M_RAW;

  const w =
    cTotal === 0 && mNorm === 0
      ? 0
      : Math.pow(Math.pow(cTotal, COMPOSITE_EXPONENT) + Math.pow(mNorm, COMPOSITE_EXPONENT), 1 / COMPOSITE_EXPONENT);

  const overallStrain = Math.min(99.9, Math.round(100 * (1 - Math.exp(-w)) * 10) / 10);
  const cardioStrain = Math.min(99.9, Math.round(100 * (1 - Math.exp(-cNorm)) * 10) / 10);
  const muscularStrain = Math.min(99.9, Math.round(100 * (1 - Math.exp(-mNorm)) * 10) / 10);

  // Proportional attribution in W^1.3 space so displayed points sum cleanly to overallStrain
  let cardioPoints = 0;
  let muscularPoints = 0;
  let walkingPoints = 0;
  if (w > 0 && overallStrain > 0) {
    const cPow = Math.pow(cTotal, COMPOSITE_EXPONENT);
    const mPow = Math.pow(mNorm, COMPOSITE_EXPONENT);
    const denom = cPow + mPow;
    const cardioShare = denom > 0 ? (cPow / denom) * (cTotal > 0 ? cNorm / cTotal : 0) : 0;
    const walkShare = denom > 0 ? (cPow / denom) * (cTotal > 0 ? safeCWalk / cTotal : 0) : 0;
    const muscularShare = denom > 0 ? mPow / denom : 0;
    cardioPoints = Math.round(overallStrain * cardioShare * 10) / 10;
    walkingPoints = Math.round(overallStrain * walkShare * 10) / 10;
    muscularPoints = Math.round((overallStrain - cardioPoints - walkingPoints) * 10) / 10;
  }

  return {
    algorithmVersion: STRAIN_ALGORITHM_VERSION,
    overallStrain,
    cardioStrain,
    muscularStrain,
    cNormalized: Math.round(cNorm * 1000) / 1000,
    cWalkNormalized: Math.round(safeCWalk * 1000) / 1000,
    cTotalNormalized: Math.round(cTotal * 1000) / 1000,
    mNormalized: Math.round(mNorm * 1000) / 1000,
    attribution: { cardioPoints, muscularPoints, walkingPoints },
  };
}

export interface TargetStrainRecommendation {
  min: number;
  max: number;
  optimal?: number;
  label: string;
  guidance: string;
}

export function computeTargetStrain(
  recoveryScore: number | null | undefined,
  options?: { acwr?: number | null; priorEffort?: (number | null)[] },
): TargetStrainRecommendation {
  if (recoveryScore == null || !Number.isFinite(recoveryScore)) {
    return {
      min: 40,
      max: 60,
      optimal: 50,
      label: "Baseline target",
      guidance: "Sync sleep and Resting HR to personalize your daily target strain.",
    };
  }

  const acwr = options?.acwr ?? null;
  const validPrior = (options?.priorEffort ?? []).filter((v): v is number => v != null && Number.isFinite(v));
  const baselineEffort = validPrior.length >= 4 ? validPrior.reduce((a, b) => a + b, 0) / validPrior.length : null;

  // Base target coupled to recovery (preserving compatibility with existing thresholds)
  let min = recoveryScore >= 75 ? 55 : recoveryScore >= 50 ? 35 : 15;
  let max = recoveryScore >= 75 ? 75 : recoveryScore >= 50 ? 55 : 35;

  if (baselineEffort != null) {
    const recFactor = 0.72 + (Math.max(0, Math.min(100, recoveryScore)) / 100) * 0.56;
    const center = Math.max(15, Math.min(82, baselineEffort * recFactor));
    min = Math.round(Math.max(10, center - 10));
    max = Math.round(Math.min(92, center + 10));
  }

  // ACWR load-management damper when acute load exceeds chronic baseline
  if (acwr != null && Number.isFinite(acwr)) {
    if (acwr > 1.5) {
      min = Math.max(10, min - 15);
      max = Math.max(25, max - 20);
    } else if (acwr > 1.3) {
      min = Math.max(12, min - 8);
      max = Math.max(30, max - 12);
    } else if (acwr < 0.8 && recoveryScore >= 67) {
      min = Math.min(70, min + 5);
      max = Math.min(90, max + 5);
    }
  }

  const optimal = Math.round((min + max) / 2);

  if (acwr != null && acwr > 1.35) {
    return {
      min,
      max,
      optimal,
      label: "Manage load (High ACWR)",
      guidance: `ACWR ${acwr.toFixed(2)} — dialing back ceiling to keep progression sustainable.`,
    };
  }
  if (recoveryScore >= 75) {
    return {
      min,
      max,
      optimal,
      label: "Ready to push",
      guidance: "High recovery — good day for a hard strength or cardio session.",
    };
  }
  if (recoveryScore >= 50) {
    return {
      min,
      max,
      optimal,
      label: "Steady training",
      guidance: "Moderate recovery — stick to planned volume without pushing to failure.",
    };
  }
  return {
    min,
    max,
    optimal,
    label: "Active recovery",
    guidance: "Low recovery — prioritize sleep, light walking, or a deload session.",
  };
}

