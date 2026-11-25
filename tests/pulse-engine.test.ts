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

test("Sleep uses known components and planner without inventing an SRI", () => {
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
  assert.equal(sri, null); // Session bounds are not observed sleep/wake epochs.

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
  assert.equal(elevated.illnessRiskScore, null);
});

test("Strain target adjusts for ACWR and unsupported recovery forecast is withheld", () => {
  const highAcwr = computeTargetStrain(80, { acwr: 1.55, priorEffort: [55, 60, 58, 62, 57] });
  const normalAcwr = computeTargetStrain(80, { acwr: 1.0, priorEffort: [55, 60, 58, 62, 57] });
  assert.ok(highAcwr.max < normalAcwr.max);

  const forecast = computeRecoveryForecast([72, 75, 70, 78, 74, 76, 73, 75, 71, 74], 55, 8.0, 8.0);
  assert.equal(forecast.predictedScore, null);
  assert.equal(forecast.confidence, "unavailable");
});

test("FRIEND percentile preserves adult comparison and unsupported biological age is withheld", () => {
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
  assert.equal(bio.status, "unvalidated");
  assert.equal(bio.biologicalAge, null);
  assert.equal(bio.deltaYears, null);
  assert.equal(bio.paceOfAging, null);

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
  assert.equal(youngLifter.biologicalAge, null);
});

test("Experimental energy, HR elevation, sampled HRR and descriptive habit associations remain usable", () => {
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
    ...Array.from({ length: 7 }, (_, i) => ({
      day: `2026-11-0${i + 1}`,
      nextDayRecovery: 82,
      proteinGoalHit: true,
      calorieTargetMet: true,
      strengthWorkout: true,
      cardioWorkout: false,
      tenKSteps: true,
      goodSleep: true,
    })),
    ...Array.from({ length: 7 }, (_, i) => ({
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

const core = { hrvRmssdMs: 60, restingHrBpm: 58, respiratoryRate: 14, skinTempDeltaC: 0, sleepHours: 8 };
const emptyCore = { hrvRmssdMs: null, restingHrBpm: null, respiratoryRate: null, skinTempDeltaC: null, sleepHours: null };
const session = (day: string, extra = {}) => ({ day, sleepStart: new Date(`${addDays(day, -1)}T23:00:00Z`), sleepEnd: new Date(`${day}T07:00:00Z`), minutesAsleep: 480, minutesAwake: null, deepMinutes: null, remMinutes: null, ...extra });

test("readiness requires completed sleep, both core signals and fresh independent personal baselines", () => {
  const prior = Array.from({ length: 14 }, () => core);
  for (const today of [{ ...core, sleepHours: null }, { ...core, hrvRmssdMs: null }, { ...core, restingHrBpm: null }, { ...emptyCore, respiratoryRate: 18 }, { ...emptyCore, skinTempDeltaC: 0 }]) {
    assert.equal(computePulseRecovery(today, prior).score, null);
  }
  assert.equal(computePulseRecovery(core, [core, core, core]).availability, "calibrating");
  assert.equal(computePulseRecovery(core, [...prior, ...Array.from({ length: 15 }, () => emptyCore)]).availability, "stale");
  assert.equal(computePulseRecovery(core, []).score, null);
});

test("rejected baseline observations do not refresh freshness", () => {
  let state = null;
  for (let i = 0; i < 15; i++) state = updateBaseline(state, 58, PULSE_METRIC_CFG.restingHr);
  for (let i = 0; i < 15; i++) state = updateBaseline(state, 110, PULSE_METRIC_CFG.restingHr);
  assert.equal(state!.status, "stale");
  assert.equal(state!.nightsSinceUpdate, 15);
});

test("missing sleep and missing stages/awake stay unknown rather than perfect", () => {
  const empty = computeSleepInsights(null, [], "2026-11-24", null);
  assert.equal(empty.sleepDebtHours, null);
  assert.equal(empty.debtCoverage, "unavailable");
  const night = session("2026-11-24");
  const result = computeSleepInsights(night, [night], night.day, null);
  assert.equal(result.efficiencyPct, null);
  assert.equal(result.restorativePct, null);
  assert.equal(result.deepPct, null);
  assert.deepEqual(result.scoreCoverage, ["duration"]);
  assert.equal(result.debtCoverage, "partial");
  assert.equal(result.observedDays, 1);
  assert.equal(computeSleepInsights(session("2099-01-01"), [], "2099-01-01", null).score, null);
  assert.equal(computeSleepInsights({ ...night, sleepEnd: null }, [], night.day, null).score, null);
});

test("naps credit once, historical goals apply and today's debt never raises today's target", () => {
  const day = "2026-11-24";
  const main = session(day, { minutesAsleep: 420 });
  const nap = { ...session(day), sleepStart: new Date(`${day}T14:00:00Z`), sleepEnd: new Date(`${day}T15:00:00Z`), minutesAsleep: 60, isMainSleep: false };
  const result = computeSleepInsights(main, [main, main, nap], day, 100, { goalForDay: () => 8 });
  assert.equal(result.sleepDebtHours, 0);
  assert.equal(result.sleepNeedHours, 8);
  assert.equal(result.durationPct, 88);
  const yesterday = session(addDays(day, -1), { minutesAsleep: 420 });
  const goals = computeSleepInsights(main, [yesterday, main], day, null, { goalForDay: (d) => d < day ? 7 : 8 });
  assert.equal(goals.sleepDebtHours, 1);
});

test("planner handles London summer time, DST and circular wake medians", () => {
  const night = session("2026-07-01", { sleepStart: new Date("2026-06-30T22:00:00Z"), sleepEnd: new Date("2026-07-01T06:00:00Z") });
  assert.equal(computeSleepInsights(night, [night], night.day, null, { timezone: "Europe/London" }).recommendedWakeTime, "07:00");
  const shift = ["2026-11-20", "2026-11-21", "2026-11-22"].map((d, i) => session(d, { sleepStart: new Date(`${addDays(d, -1)}T16:00:00Z`), sleepEnd: new Date(`${i === 0 ? addDays(d, -1) : d}T${i === 0 ? "23:50" : i === 1 ? "00:10" : "00:20"}:00Z`), minutesAsleep: 420 }));
  assert.equal(computeSleepInsights(shift[2], shift, "2026-11-22", null, { timezone: "UTC" }).recommendedWakeTime, "00:10");
});

test("health monitor cannot call an uncalibrated personal reading in range", () => {
  const result = computeHealthMonitor({ restingHrBpm: 60, hrvRmssdMs: null, respiratoryRate: null, skinTempDeltaC: null, spo2Pct: null }, []);
  assert.equal(result.status, "calibrating");
  assert.equal(result.vitals[0].status, "calibrating");
  assert.equal(result.inRangeCount, 0);
  assert.equal(result.illnessRiskScore, null);
});

test("sparse, duplicate, sleeping and workout HR do not invent coverage or energy", () => {
  const t = Date.parse("2026-11-24T08:00:00Z");
  const samples = [0, 0, 60_000, 600_000].map((delta) => ({ recordedAt: new Date(t + delta).toISOString(), bpm: 95 }));
  const result = computeEnergyBankAndStress(samples, 58, 190, null, null, []);
  assert.equal(result.energyBank.currentPct, null);
  assert.equal(result.stress.observedMinutes, 1);
  const asleep = computeEnergyBankAndStress(samples, 58, 190, 70, 80, [], [{ startMs: t, endMs: t + 120_000 }]);
  assert.equal(asleep.stress.avgStress, null);
  assert.equal(asleep.stress.observedMinutes, 0);
  assert.equal(computeEnergyBankAndStress([samples[0]], 58, 190, null, null, []).stress.avgStress, null);
});

test("FRIEND adult reference is not extrapolated to children or ages 80+", () => {
  for (const age of [16, 19.9, 80, 90, Number.NaN]) assert.equal(computeFitnessLevel(50, age, "male").percentile, null);
  assert.notEqual(computeFitnessLevel(50, 79, "male").percentile, null);
});

test("daily vitals without prior qualifying sleep do not establish readiness calibration", () => {
  const days = Array.from({ length: 20 }, () => ({ ...core, sleepHours: null }));
  assert.equal(computePulseRecovery(core, days).availability, "calibrating");
});

test("sampled HR recovery uses cessation HR rather than an earlier peak", () => {
  const end = Date.parse("2026-11-24T10:00:00Z");
  const samples = [-180, -120, -60, 0, 60, 120].map((sec, i) => ({ recordedAt: new Date(end + sec * 1000).toISOString(), bpm: [160, 165, 180, 150, 130, 120][i] }));
  const result = computeHrRecovery(samples, end - 600_000, end, 190);
  assert.equal(result?.endHr, 150);
  assert.equal(result?.after1Minute, 20);
});

test("readiness does not merge baselines across providers", () => {
  const prior = Array.from({ length: 14 }, () => ({ ...core, source: "provider-a" }));
  assert.equal(computePulseRecovery({ ...core, source: "provider-b" }, prior).score, null);
  assert.notEqual(computePulseRecovery({ ...core, source: "provider-a" }, prior).score, null);
});

test("database Pulse reads user session history/goals and excludes unprocessed, future and unknown intervals", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { readdir, readFile } = await import("node:fs/promises");
  const schema = await import("../lib/schema");
  const { getPulseInsightsForUser } = await import("../lib/pulse-data");
  const { saveSleepSession } = await import("../lib/sleep-session-data");
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  try {
    for (const file of (await readdir("migrations")).filter((f) => f.endsWith(".sql")).sort()) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
    const now = new Date();
    await db.insert(schema.user).values(["pulse-a", "pulse-b"].map((id) => ({ id, email: `${id}@example.test`, name: id, createdAt: now, updatedAt: now })));
    await db.insert(schema.sleepGoal).values([
      { userId: "pulse-a", effectiveFrom: "2026-11-01", goalMinutes: 420 },
      { userId: "pulse-a", effectiveFrom: "2026-11-24", goalMinutes: 480 },
      { userId: "pulse-b", effectiveFrom: "2026-11-01", goalMinutes: 600 },
    ]);
    for (let i = 0; i < 9; i++) {
      const day = addDays("2026-11-24", -8 + i);
      await db.transaction((tx) => saveSleepSession(tx, "pulse-a", {
        day, source: "google", sessionId: `main-${day}`, sleepStart: `${addDays(day, -1)}T23:00:00Z`, sleepEnd: `${day}T07:00:00Z`,
        minutesAsleep: 420, deepMinutes: 70, remMinutes: 90, isMainSleep: true, processed: day !== "2026-11-22",
      }));
      await db.insert(schema.dailyRecovery).values({ userId: "pulse-a", source: "google", day, hrvRmssdMs: 60, restingHrBpm: 58 });
    }
    await db.transaction((tx) => saveSleepSession(tx, "pulse-a", { day: "2026-11-24", source: "google", sessionId: "nap", sleepStart: "2026-11-24T14:00:00Z", sleepEnd: "2026-11-24T15:00:00Z", minutesAsleep: 60, isMainSleep: false }));
    await db.transaction((tx) => saveSleepSession(tx, "pulse-a", { day: "2026-11-25", source: "manual", sessionId: "unknown-end", minutesAsleep: 480, isMainSleep: true }));
    await db.transaction((tx) => saveSleepSession(tx, "pulse-a", { day: "2099-11-25", source: "manual", sessionId: "future", sleepStart: "2099-11-24T23:00:00Z", sleepEnd: "2099-11-25T07:00:00Z", minutesAsleep: 480, isMainSleep: true }));
    // PGlite and node-postgres expose the same Drizzle query contract used by the service.
    const serviceDb = db as unknown as Parameters<typeof getPulseInsightsForUser>[0];
    const current = await getPulseInsightsForUser(serviceDb, "pulse-a", "2026-11-24");
    assert.equal(current.sleep.sleepNeedHours, 8);
    assert.equal(current.sleep.sleepDebtHours, 0);
    assert.equal(current.sleep.observedDays, 6);
    assert.equal(current.sleep.debtCoverage, "partial");
    assert.equal(current.sleep.efficiencyPct, null);
    assert.equal(current.sleep.deepPct, 16.7);
    assert.equal(current.recovery.availability, "available");
    assert.equal((await getPulseInsightsForUser(serviceDb, "pulse-a", "2026-11-23")).sleep.sleepNeedHours, 7);
    assert.equal((await getPulseInsightsForUser(serviceDb, "pulse-a", "2026-11-22")).recovery.availability, "waiting_for_sleep");
    assert.equal((await getPulseInsightsForUser(serviceDb, "pulse-a", "2026-11-25")).recovery.availability, "waiting_for_sleep");
    assert.equal((await getPulseInsightsForUser(serviceDb, "pulse-a", "2099-11-25")).sleep.score, null);
    const other = await getPulseInsightsForUser(serviceDb, "pulse-b", "2026-11-24");
    assert.equal(other.sleep.sleepNeedHours, 10);
    assert.equal(other.sleep.observedDays, 0);
    assert.equal(other.recovery.score, null);
  } finally {
    await pg.close();
  }
});

test("inconsistent awake/stage totals remain unassessed rather than improving sleep score", () => {
  const day = "2026-11-24";
  const night = session(day, { minutesAsleep: 420, minutesAwake: 120, deepMinutes: 100, remMinutes: 100, lightMinutes: 300 });
  const invalid = computeSleepInsights(night, [night], day, null);
  assert.equal(invalid.efficiencyPct, null);
  assert.equal(invalid.deepPct, null);
  assert.equal(invalid.remPct, null);
  assert.equal(invalid.restorativePct, null);
  assert.deepEqual(invalid.scoreCoverage, ["duration"]);
  const known = computeSleepInsights({ ...night, minutesAwake: 60, lightMinutes: 220 }, [night], day, null);
  assert.equal(known.efficiencyPct, 88);
  assert.equal(known.deepPct, 23.8);
  assert.equal(known.remPct, 23.8);
});

test("nap-only dates do not imply a missing main night had zero sleep", () => {
  const day = "2026-11-24";
  const nap = { ...session(day), sleepStart: new Date(`${day}T14:00:00Z`), sleepEnd: new Date(`${day}T15:00:00Z`), minutesAsleep: 60, isMainSleep: false };
  const onlyNap = computeSleepInsights(null, [nap], day, null);
  assert.equal(onlyNap.sleepDebtHours, null);
  assert.equal(onlyNap.observedDays, 0);
  assert.equal(onlyNap.debtCoverage, "unavailable");
  const previous = session(addDays(day, -1), { minutesAsleep: 420 });
  const partial = computeSleepInsights(null, [previous, nap], day, null);
  assert.equal(partial.sleepDebtHours, 1);
  assert.equal(partial.observedDays, 1);
  assert.equal(partial.debtCoverage, "partial");
});
