import assert from "node:assert/strict";
import { test } from "node:test";
import { addDays } from "../lib/nutrition-model";
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
  computeSleepRegularity,
  PULSE_METRIC_CFG,
  updateBaseline,
} from "../lib/pulse-engine";
import { computeTargetStrain } from "../lib/strain-engine";

test("EWMA baseline adapts and rejects single-night hard outliers once settled", () => {
  let state = null;
  for (let i = 0; i < 15; i++) {
    state = updateBaseline(state, 58, PULSE_METRIC_CFG.restingHr);
  }
  assert.equal(state?.status, "trusted");
  const settledBase = state!.baseline;
  const afterSpike = updateBaseline(state, 110, PULSE_METRIC_CFG.restingHr);
  assert.equal(afterSpike.baseline, settledBase);
});

test("Pulse recovery computes weighted drivers and handles unavailable data honestly", () => {
  const empty = computePulseRecovery(
    { hrvRmssdMs: null, restingHrBpm: null, respiratoryRate: null, skinTempDeltaC: null, sleepHours: null },
    [],
  );
  assert.equal(empty.score, null);
  assert.equal(empty.band, "unavailable");

  const prior = Array.from({ length: 14 }, () => ({
    hrvRmssdMs: 55,
    restingHrBpm: 58,
    respiratoryRate: 14.5,
    skinTempDeltaC: 0.0,
    sleepHours: 7.5,
  }));
  const goodDay = computePulseRecovery(
    { hrvRmssdMs: 74, restingHrBpm: 53, respiratoryRate: 14.2, skinTempDeltaC: 0.1, sleepHours: 8.2 },
    prior,
    8.0,
  );
  assert.ok(goodDay.score != null && goodDay.score >= 70);
  assert.equal(goodDay.band, "optimal");
  assert.ok(goodDay.drivers.some((d) => d.key === "hrv" && d.tone === "good"));
});

test("Sleep score, SRI, and bedtime planner compute composite metrics", () => {
  const anchor = "2026-11-24";
  const nights = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(anchor, -6 + i);
    const prevDay = addDays(day, -1);
    return {
      day,
      sleepStart: new Date(`${prevDay}T23:00:00Z`),
      sleepEnd: new Date(`${day}T07:00:00Z`),
      minutesAsleep: 455,
      minutesAwake: 25,
      deepMinutes: 85,
      remMinutes: 105,
    };
  });
  const sri = computeSleepRegularity(nights, anchor);
  assert.ok(sri != null && sri >= 95);

  const sleep = computeSleepInsights(nights[6], nights, anchor, 68);
  assert.ok(sleep.score != null && sleep.score >= 80);
  assert.ok(sleep.sleepNeedHours >= 8.0);
  assert.equal(sleep.recommendedWakeTime, "07:00");
  assert.ok(sleep.recommendedBedtime != null);
});

test("Health monitor flags elevated when >= 2 vitals drift outside personal range", () => {
  const history = Array.from({ length: 15 }, (_, i) => ({
    restingHrBpm: 55 + (i % 2),
    hrvRmssdMs: 65 + (i % 3),
    respiratoryRate: 14.0,
    skinTempDeltaC: 0.0,
  }));
  const elevated = computeHealthMonitor(
    { restingHrBpm: 72, hrvRmssdMs: 28, respiratoryRate: 18.5, spo2Pct: 97, skinTempDeltaC: 1.4 },
    history,
  );
  assert.equal(elevated.status, "elevated");
  assert.ok(elevated.illnessRiskScore >= 50);
});

test("Dynamic strain target couples ACWR and recovery, and forecast projects tomorrow", () => {
  const highAcwr = computeTargetStrain(80, { acwr: 1.55, priorEffort: [55, 60, 58, 62, 57] });
  const normalAcwr = computeTargetStrain(80, { acwr: 1.0, priorEffort: [55, 60, 58, 62, 57] });
  assert.ok(highAcwr.max < normalAcwr.max);

  const forecast = computeRecoveryForecast([72, 75, 70, 78, 74, 76, 73, 75, 71, 74], 55, 8.0, 8.0);
  assert.ok(forecast.predictedScore != null && forecast.confidence === "solid");
});

test("Biological age & FRIEND VO2max percentile compute expected healthspan deltas", () => {
  const fit = computeFitnessLevel(52, 28, "male");
  assert.ok(fit.percentile != null && fit.percentile >= 60);
  assert.ok(fit.category === "excellent" || fit.category === "superior");

  const anchor = "2026-11-24";
  const days = Array.from({ length: 30 }, (_, i) => ({
    day: addDays(anchor, -29 + i),
    sleepHours: 7.8,
    sri: 86,
    zone13Min: 30,
    zone45Min: 10,
    strengthMin: 15,
    steps: 10500,
    vo2max: 52,
    restingHr: 51,
    weightKg: 72,
    bodyFatPct: 14,
  }));
  const bio = computeBiologicalAge(days, { age: 30, sex: "male", heightCm: 178 }, anchor);
  assert.equal(bio.status, "ready");
  assert.ok(bio.biologicalAge != null && bio.biologicalAge < 30);
  assert.ok(bio.deltaYears != null && bio.deltaYears < 0);

  const lifterDays = Array.from({ length: 30 }, (_, i) => ({
    day: addDays(anchor, -29 + i),
    sleepHours: 7.5,
    sri: 80,
    zone13Min: 10,
    strengthMin: 26,
    steps: 7000,
    restingHr: 58,
    weightKg: 72,
  }));
  const youngLifter = computeBiologicalAge(lifterDays, { age: 23, sex: "male", heightCm: 173 }, anchor);
  assert.ok(
    youngLifter.biologicalAge != null && youngLifter.biologicalAge <= 23.5,
    `Expected healthy 23yo lifter bio age <= 23.5, got ${youngLifter.biologicalAge}`,
  );
});

test("Energy bank, daytime stress, HRR, and auto behavior impacts compute accurately", () => {
  const baseMs = Date.parse("2026-11-24T08:00:00Z");
  const samples = Array.from({ length: 20 }, (_, i) => ({
    recordedAt: new Date(baseMs + i * 60_000).toISOString(),
    bpm: i < 10 ? 155 : 115 - (i - 10) * 4,
  }));
  const { energyBank, stress } = computeEnergyBankAndStress(
    samples,
    56,
    190,
    82,
    85,
    [{ startMs: baseMs, endMs: baseMs + 9 * 60_000 }],
  );
  assert.ok(energyBank.currentPct != null && energyBank.peakPct != null);
  assert.ok(stress.avgStress != null);

  const hrr = computeHrRecovery(samples, baseMs, baseMs + 9 * 60_000, 190);
  assert.ok(hrr != null && hrr.after1Minute != null && hrr.after1Minute > 20);

  const obs = [
    ...Array.from({ length: 4 }, (_, i) => ({
      day: `2026-11-0${i + 1}`,
      nextDayRecovery: 82,
      proteinGoalHit: true,
      calorieTargetMet: true,
      strengthWorkout: true,
      cardioWorkout: false,
      tenKSteps: true,
      goodSleep: true,
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      day: `2026-11-1${i + 1}`,
      nextDayRecovery: 64,
      proteinGoalHit: false,
      calorieTargetMet: false,
      strengthWorkout: false,
      cardioWorkout: true,
      tenKSteps: false,
      goodSleep: false,
    })),
  ];
  const impacts = computeBehaviorImpacts(obs);
  assert.ok(impacts.some((x) => x.key === "protein" && x.deltaRecovery > 10));
});
