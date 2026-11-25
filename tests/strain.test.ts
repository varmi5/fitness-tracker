import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { importHevyWorkouts } from "../lib/hevy";
import { MUSCLE_GROUPS, resolveExerciseMuscles } from "../lib/muscle-map";
import { overlapStepsForWindows, strainData } from "../lib/strain-data";
import {
  computeCompositeStrain,
  computeEdwardsTrimp,
  computeMuscularWorkload,
  computeWalkingContribution,
  DEFAULT_STRAIN_SETTINGS,
  STRAIN_ALGORITHM_VERSION,
} from "../lib/strain-engine";
import * as schema from "../lib/schema";

const pg = new PGlite();
const db = drizzle(pg, { schema });

before(async () => {
  const migrations = (await readdir("migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const m of migrations) {
    await pg.exec(await readFile(`migrations/${m}`, "utf8"));
  }
  await db.insert(schema.user).values([
    { id: "ST-1", name: "ST-1", email: "st1@example.test", createdAt: new Date(), updatedAt: new Date() },
    { id: "ST-2", name: "ST-2", email: "st2@example.test", createdAt: new Date(), updatedAt: new Date() },
  ]);
});

after(async () => pg.close());

test("Edwards TRIMP computes 5-zone weights, caps telemetry gaps, and marks missing HR unavailable", () => {
  const samples = Array.from({ length: 20 }, (_, i) => ({
    recordedAt: new Date(Date.UTC(2026, 10, 23, 14, i, 0)).toISOString(),
    bpm: 155, // 155 / 190 = 81.5% -> Zone 4 (weight 4)
  }));
  const res = computeEdwardsTrimp(samples, 190);
  assert.equal(res.status, "measured");
  assert.equal(res.sampleCount, 20);
  assert.ok(res.cRaw > 70 && res.cRaw < 90, `Expected ~80 TRIMP, got ${res.cRaw}`);

  const unavailable = computeEdwardsTrimp([], 190);
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.cRaw, 0);

  const azm = computeEdwardsTrimp([], 190, { fallbackActiveZoneMinutes: 25 });
  assert.equal(azm.status, "estimated_azm");
  assert.equal(azm.cRaw, 50);
});

test("Muscular workload excludes warmups, handles RPE/failure/dropsets, and maps 10 muscle groups", () => {
  const res = computeMuscularWorkload([
    { exerciseTitle: "Bench Press (Barbell)", setType: "warmup", reps: 10, rpe: null, weightKg: 40 },
    { exerciseTitle: "Bench Press (Barbell)", setType: "normal", reps: 8, rpe: 8, weightKg: 80 },
    { exerciseTitle: "Bench Press (Barbell)", setType: "failure", reps: 6, rpe: 10, weightKg: 80 },
    { exerciseTitle: "Lateral Raise (Dumbbell)", setType: "dropset", reps: 12, rpe: null, weightKg: 10 },
  ]);

  assert.equal(res.warmupSetCount, 1);
  assert.equal(res.workingSetCount, 3);
  assert.equal(res.assumedRpeSetCount, 1);
  assert.ok(res.mRaw > 2.0);
  assert.ok(res.muscleLoads.Chest > 0);
  assert.ok(res.muscleLoads.Shoulders > 0);
  assert.ok(res.muscleLoads.Triceps > 0);
  assert.equal(Object.keys(res.muscleLoads).length, MUSCLE_GROUPS.length);

  const squatMap = resolveExerciseMuscles("Barbell Back Squat");
  assert.ok(squatMap.primary.includes("Quads"));
});

test("Composite Strain mathematical guarantees: zero, monotonic, bounded < 100, and additive attribution", () => {
  const zero = computeCompositeStrain(0, 0, 0);
  assert.equal(zero.algorithmVersion, STRAIN_ALGORITHM_VERSION);
  assert.equal(zero.overallStrain, 0);
  assert.equal(zero.cardioStrain, 0);
  assert.equal(zero.muscularStrain, 0);

  const cardioOnly = computeCompositeStrain(80, 0, 0);
  const strengthOnly = computeCompositeStrain(0, 10, 0);
  const mixed = computeCompositeStrain(80, 10, 0);
  assert.ok(cardioOnly.overallStrain > 0 && cardioOnly.muscularStrain === 0);
  assert.ok(strengthOnly.overallStrain > 0 && strengthOnly.cardioStrain === 0);
  assert.ok(mixed.overallStrain > cardioOnly.overallStrain);
  assert.ok(mixed.overallStrain > strengthOnly.overallStrain);
  assert.ok(mixed.overallStrain < cardioOnly.overallStrain + strengthOnly.overallStrain);

  const high = computeCompositeStrain(500, 80, 0.05);
  assert.ok(high.overallStrain >= 95 && high.overallStrain < 100);

  const sumAttr =
    Math.round((mixed.attribution.cardioPoints + mixed.attribution.muscularPoints + mixed.attribution.walkingPoints) * 10) / 10;
  assert.equal(sumAttr, mixed.overallStrain);
});

test("Walking contribution: 5k/10k/10.5k=0, 12k small, 15.5k/20k/25k capped at 5, conservative on missing intervals", () => {
  for (const steps of [5000, 10000, 10500]) {
    const r = computeWalkingContribution(
      { totalSteps: steps, verifiedWorkoutSteps: 0, hasWorkoutOnDay: false },
      DEFAULT_STRAIN_SETTINGS,
    );
    assert.equal(r.walkingPoints, 0);
    assert.equal(r.excessSteps, 0);
  }

  const r12k = computeWalkingContribution(
    { totalSteps: 12000, verifiedWorkoutSteps: 0, hasWorkoutOnDay: false },
    DEFAULT_STRAIN_SETTINGS,
  );
  assert.equal(r12k.excessSteps, 1500);
  assert.equal(r12k.walkingPoints, 1.5);

  for (const steps of [15500, 20000, 25000]) {
    const r = computeWalkingContribution(
      { totalSteps: steps, verifiedWorkoutSteps: 0, hasWorkoutOnDay: false },
      DEFAULT_STRAIN_SETTINGS,
    );
    assert.equal(r.walkingPoints, 5);
  }

  // Disabled walking
  const disabled = computeWalkingContribution(
    { totalSteps: 20000, verifiedWorkoutSteps: 0, hasWorkoutOnDay: false },
    { ...DEFAULT_STRAIN_SETTINGS, walkingEnabled: false },
  );
  assert.equal(disabled.status, "disabled");
  assert.equal(disabled.walkingPoints, 0);

  // Workout day without verified step intervals -> incomplete (never guesses workout steps)
  const missingIntervals = computeWalkingContribution(
    { totalSteps: 16000, verifiedWorkoutSteps: null, hasWorkoutOnDay: true },
    DEFAULT_STRAIN_SETTINGS,
  );
  assert.equal(missingIntervals.status, "incomplete");
  assert.equal(missingIntervals.walkingPoints, 0);

  // High sensitivity reaches cap faster
  const highSens = computeWalkingContribution(
    { totalSteps: 14000, verifiedWorkoutSteps: 0, hasWorkoutOnDay: false },
    { ...DEFAULT_STRAIN_SETTINGS, walkingSensitivity: "high" },
  );
  assert.equal(highSens.walkingPoints, 5);
});

test("strainData combines Hevy + matched Google workout + HR samples + step intervals without double-counting", async () => {
  await db.insert(schema.dailyEnergy).values({
    userId: "ST-1",
    day: "2026-11-23",
    source: "google",
    steps: 18500,
    totalKcal: 2600,
    complete: true,
  });

  await db.insert(schema.dailyWorkout).values({
    userId: "ST-1",
    source: "google",
    sessionId: "g-st-nov23",
    day: "2026-11-23",
    title: "Strength training",
    exerciseType: "EXERCISE_TYPE_WEIGHTLIFTING",
    startTime: new Date("2026-11-23T13:42:00Z"),
    endTime: new Date("2026-11-23T15:02:00Z"),
    durationSeconds: 4800,
  });

  await db.insert(schema.heartRateSample).values(
    Array.from({ length: 30 }, (_, i) => ({
      userId: "ST-1",
      source: "google",
      recordedAt: new Date(Date.UTC(2026, 10, 23, 13, 45 + i, 0)),
      bpm: 138, // ~72% of 190 -> Zone 3 (weight 3)
      day: "2026-11-23",
      dataSource: "WATCH",
    })),
  );

  await db.insert(schema.stepInterval).values({
    userId: "ST-1",
    source: "google",
    startTime: new Date("2026-11-23T13:45:00Z"),
    endTime: new Date("2026-11-23T14:55:00Z"),
    steps: 1500,
    day: "2026-11-23",
    dataSource: "all-sources",
  });

  await importHevyWorkouts(db, "ST-1", [
    {
      hevyId: "hv-st-nov23",
      day: "2026-11-23",
      title: "Upper A",
      description: "",
      startTime: "2026-11-23T13:42:00Z",
      endTime: "2026-11-23T15:02:00Z",
      durationSeconds: 4800,
      source: "hevy_csv",
      sets: [
        { exerciseIndex: 0, exerciseTitle: "Bench Press (Barbell)", exerciseTemplateId: null, supersetId: null, setIndex: 0, setType: "normal", weightKg: 80, reps: 8, distanceMeters: null, durationSeconds: null, rpe: 8.5, notes: "" },
        { exerciseIndex: 0, exerciseTitle: "Bench Press (Barbell)", exerciseTemplateId: null, supersetId: null, setIndex: 1, setType: "normal", weightKg: 80, reps: 8, distanceMeters: null, durationSeconds: null, rpe: 9, notes: "" },
        { exerciseIndex: 1, exerciseTitle: "Barbell Row", exerciseTemplateId: null, supersetId: null, setIndex: 0, setType: "normal", weightKg: 70, reps: 10, distanceMeters: null, durationSeconds: null, rpe: 8, notes: "" },
      ],
    },
  ]);

  const s1 = strainData(db, "ST-1");
  const dayView = await s1.computeDay("2026-11-23");
  assert.equal(dayView.confidence, "complete");
  assert.equal(dayView.excludedWorkoutSteps, 1500);
  assert.equal(dayView.eligibleSteps, 17000);
  assert.equal(dayView.excessSteps, 6500);
  assert.equal(dayView.walkingPoints, 5);
  // Matched Google workout must NOT appear as a duplicate separate activity
  assert.equal(dayView.activities.filter((a) => a.kind !== "walking").length, 1);
  assert.equal(dayView.activities[0].source, "Hevy + Google Health");
  assert.ok((dayView.overallStrain ?? 0) > 20);

  // Updating threshold to 20,000 and recomputing drops walkingPoints to 0
  await s1.updateSettings({ walkingStepThreshold: 20000 });
  const recomputed = await s1.computeDay("2026-11-23");
  assert.equal(recomputed.walkingPoints, 0);

  // ST-2 isolation
  const s2 = strainData(db, "ST-2");
  const st2View = await s2.computeDay("2026-11-23");
  assert.equal(st2View.overallStrain, null);
  assert.equal(st2View.confidence, "incomplete");
});

test("Google session duration does not invent muscular sets; Hevy pairing invalidates history cache", async () => {
  const s1 = strainData(db, "ST-1");
  await db.insert(schema.dailyWorkout).values({
    userId: "ST-1",
    source: "google",
    sessionId: "gw-nov24",
    day: "2026-11-24",
    exerciseType: "EXERCISE_TYPE_WEIGHTLIFTING",
    title: "Push Workout",
    startTime: new Date("2026-11-24T10:00:00Z"),
    endTime: new Date("2026-11-24T10:50:00Z"),
    durationSeconds: 3000,
    caloriesKcal: 340,
    distanceMeters: 0,
    avgHrBpm: 132,
  });

  const provisional = await s1.computeDay("2026-11-24");
  const strengthAct = provisional.activities.find((a) => a.id === "google:gw-nov24" || a.id === "gw-nov24");
  assert.ok(strengthAct, "Unmatched Google Health strength workout must be present");
  assert.equal(strengthAct.kind, "strength");
  assert.equal(provisional.mRaw, 0, "Duration cannot establish sets or muscular load");
  assert.equal(provisional.muscularStrain ?? 0, 0);
  assert.equal(provisional.muscleLoads.Chest, 0, "Session titles cannot establish muscle-specific sets");

  // Simulate later Hevy sync for the same workout timestamp and verify history() invalidates the cached row
  await new Promise((r) => setTimeout(r, 15));
  await importHevyWorkouts(db, "ST-1", [
    {
      hevyId: "hv-st-nov24",
      day: "2026-11-24",
      title: "Push Workout",
      description: "",
      startTime: "2026-11-24T10:01:00Z",
      endTime: "2026-11-24T10:51:00Z",
      durationSeconds: 3000,
      source: "hevy_oauth",
      sets: [
        { exerciseIndex: 0, exerciseTitle: "Bench Press (Barbell)", exerciseTemplateId: null, supersetId: null, setIndex: 0, setType: "normal", weightKg: 90, reps: 8, distanceMeters: null, durationSeconds: null, rpe: 9, notes: "" },
        { exerciseIndex: 0, exerciseTitle: "Bench Press (Barbell)", exerciseTemplateId: null, supersetId: null, setIndex: 1, setType: "normal", weightKg: 90, reps: 8, distanceMeters: null, durationSeconds: null, rpe: 9, notes: "" },
        { exerciseIndex: 0, exerciseTitle: "Bench Press (Barbell)", exerciseTemplateId: null, supersetId: null, setIndex: 2, setType: "normal", weightKg: 90, reps: 8, distanceMeters: null, durationSeconds: null, rpe: 9.5, notes: "" },
      ],
    },
  ]);

  const hist = await s1.history("2026-11-24", "2026-11-24");
  const nov24 = hist.find((d) => d.day === "2026-11-24");
  assert.ok(nov24);
  const pairedAct = nov24.activities.find((a) => a.kind === "strength");
  assert.ok(pairedAct);
  assert.equal(pairedAct.source, "Hevy + Google Health");
  assert.equal(pairedAct.sets?.length, 3);
});



test("exercise title specificity prevents false muscle attribution and unknown Core load", () => {
  assert.deepEqual(resolveExerciseMuscles("Seated Leg Curl").primary, ["Hamstrings"]);
  assert.deepEqual(resolveExerciseMuscles("Romanian Deadlift (Barbell)").primary, ["Hamstrings", "Glutes"]);
  assert.deepEqual(resolveExerciseMuscles("Close-grip Bench Press").primary, ["Triceps"]);
  assert.deepEqual(resolveExerciseMuscles("Triceps Kickback").primary, ["Triceps"]);
  assert.deepEqual(resolveExerciseMuscles("Hip Adduction").primary, []);
  assert.deepEqual(resolveExerciseMuscles("Unrecognised Exercise").primary, []);
  const result = computeMuscularWorkload([{ exerciseTitle: "Unrecognised Exercise", setType: "normal", reps: 8, rpe: 8, weightKg: 40 }]);
  assert.equal(result.unmappedSetCount, 1);
  assert.equal(result.muscleLoads.Core, 0);
  assert.ok(result.mRaw > 0, "Unmapped sets remain part of recorded total workload");
});

test("TRIMP integrates observed time only, deduplicates timestamps and excludes outages", () => {
  const lone = { recordedAt: "2026-11-23T10:00:00Z", bpm: 155 };
  assert.equal(computeEdwardsTrimp([lone], 190).status, "unavailable");
  assert.equal(computeEdwardsTrimp([lone, lone], 190).coveredMinutes, 0);
  assert.equal(computeEdwardsTrimp([lone, { ...lone, recordedAt: "2026-11-23T11:00:00Z" }], 190).cRaw, 0);
  const adjacent = computeEdwardsTrimp([lone, { ...lone, recordedAt: "2026-11-23T10:01:00Z" }], 190);
  assert.equal(adjacent.cRaw, 4);
  assert.equal(adjacent.coveredMinutes, 1);
  const fallback = computeEdwardsTrimp([], 190, { fallbackActiveZoneMinutes: 20 });
  assert.equal(fallback.zones.reduce((sum, zone) => sum + zone.minutes, 0), 0, "Weighted AZM are not observed zone duration");
});

test("personal same-exercise references distinguish intensity without naive cross-exercise tonnage", () => {
  const set = { exerciseTitle: "Bench Press", setType: "normal", reps: 8, rpe: null, weightKg: 20, reference1RmKg: 100 };
  const light = computeMuscularWorkload([set]);
  const heavy = computeMuscularWorkload([{ ...set, weightKg: 80 }]);
  assert.ok(heavy.mRaw > light.mRaw);
  assert.equal(heavy.relativeIntensitySetCount, 1);
  assert.equal(heavy.externalVolumeKg, 640);
  const knownEffort = computeMuscularWorkload([{ ...set, rpe: 9 }]);
  const sameRelativeEffort = computeMuscularWorkload([{ ...set, rpe: 9, weightKg: 80 }]);
  assert.equal(knownEffort.mRaw, sameRelativeEffort.mRaw, "Known effort is not scaled by arbitrary absolute kg");
});


test("workout step exclusion uses interval union across disjoint and overlapping sessions", () => {
  const time = (minute: number) => new Date(Date.UTC(2026, 10, 25, 10, minute));
  const intervals = [{ startTime: time(0), endTime: time(60), steps: 6000 }];
  const windows = [
    { startTime: time(0), endTime: time(10) },
    { startTime: time(30), endTime: time(40) },
    { startTime: time(35), endTime: time(45) },
  ];
  assert.equal(overlapStepsForWindows(intervals, windows), 2500);
  assert.equal(overlapStepsForWindows(intervals, [...windows, windows[0]]), 2500, "Repeated workout windows do not duplicate excluded steps");
  assert.equal(overlapStepsForWindows([], windows), null);
  assert.equal(overlapStepsForWindows(intervals, []), 0);
});

test("TRIMP discloses estimated versus configured maximum HR provenance", () => {
  const samples = [
    { recordedAt: "2026-11-25T10:00:00Z", bpm: 140 },
    { recordedAt: "2026-11-25T10:01:00Z", bpm: 140 },
  ];
  assert.match(computeEdwardsTrimp(samples, 190, { maxHrIsEstimated: true }).note, /Maximum HR 190 bpm is estimated/);
  assert.match(computeEdwardsTrimp(samples, 180, { maxHrIsEstimated: false }).note, /user-configured, not verified/);
});
