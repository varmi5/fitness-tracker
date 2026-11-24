import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { importHevyWorkouts } from "../lib/hevy";
import { classifyLoadStatus, computeEwmaSeries, estimateEpley1Rm, getTrainingLoadSummary, type EwmaSeriesPoint } from "../lib/training-load";
import { computeCompositeStrain, computeTargetStrain, STRENGTH_CARDIO_FACTOR } from "../lib/strain-engine";
import * as schema from "../lib/schema";

const pg = new PGlite();
const db = drizzle(pg, { schema });

before(async () => {
  const migrations = (await readdir("migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const m of migrations) {
    await pg.exec(await readFile(`migrations/${m}`, "utf8"));
  }
  await db.insert(schema.user).values({ id: "TL-1", name: "TL-1", email: "tl1@example.test", createdAt: new Date(), updatedAt: new Date() });
});

after(async () => pg.close());

test("computeEwmaSeries handles cold-start and keeps 7d acute more responsive than 42d chronic", () => {
  const series = computeEwmaSeries([
    { day: "2026-11-18", rawLoad: 0, confidence: "incomplete" },
    { day: "2026-11-19", rawLoad: 40, confidence: "complete" },
    { day: "2026-11-20", rawLoad: 120, confidence: "complete" },
    { day: "2026-11-21", rawLoad: 0, confidence: "rest" },
  ]);
  // Leading incomplete day is skipped on cold-start
  assert.equal(series.length, 3);
  assert.equal(series[0].day, "2026-11-19");
  assert.equal(series[0].acute7d, 40);
  assert.equal(series[0].chronic42d, 40);
  // After spike on Nov 20, acute rises faster than chronic
  assert.ok(series[1].acute7d > series[1].chronic42d);
  assert.equal(estimateEpley1Rm(100, 5), 116.7);
});

test("getTrainingLoadSummary tracks separate Cardio & Muscular loads, muscle working sets, and exercise progression", async () => {
  await importHevyWorkouts(db, "TL-1", [
    {
      hevyId: "tl-w1",
      day: "2026-11-20",
      title: "Push",
      description: "",
      startTime: "2026-11-20T10:00:00Z",
      endTime: "2026-11-20T11:00:00Z",
      durationSeconds: 3600,
      source: "hevy_csv",
      sets: [
        { exerciseIndex: 0, exerciseTitle: "Bench Press (Barbell)", exerciseTemplateId: null, supersetId: null, setIndex: 0, setType: "normal", weightKg: 80, reps: 5, distanceMeters: null, durationSeconds: null, rpe: 8, notes: "" },
      ],
    },
    {
      hevyId: "tl-w2",
      day: "2026-11-23",
      title: "Push",
      description: "",
      startTime: "2026-11-23T10:00:00Z",
      endTime: "2026-11-23T11:00:00Z",
      durationSeconds: 3600,
      source: "hevy_csv",
      sets: [
        { exerciseIndex: 0, exerciseTitle: "Bench Press (Barbell)", exerciseTemplateId: null, supersetId: null, setIndex: 0, setType: "normal", weightKg: 85, reps: 5, distanceMeters: null, durationSeconds: null, rpe: 8.5, notes: "" },
        { exerciseIndex: 0, exerciseTitle: "Bench Press (Barbell)", exerciseTemplateId: null, supersetId: null, setIndex: 1, setType: "normal", weightKg: 85, reps: 5, distanceMeters: null, durationSeconds: null, rpe: 9, notes: "" },
      ],
    },
  ]);

  const summary = await getTrainingLoadSummary(db, "TL-1", "2026-11-20", "2026-11-23");
  assert.ok(summary.latestMuscular && summary.latestMuscular.acute7d > 0);
  const chest = summary.muscleSummaries.find((m) => m.muscle === "Chest");
  assert.ok(chest && chest.weeklyWorkingSets === 3);
  const bench = summary.exerciseProgression.find((e) => e.exerciseTitle === "Bench Press (Barbell)");
  assert.ok(bench && bench.sessions === 2 && (bench.deltaKg ?? 0) > 0);
  // With only 4 days of history, status should honestly report calibrating rather than overtraining
  assert.equal(summary.muscularStatus?.status, "calibrating");
});

function makeSeries(acute: number, chronic: number, prevChronic = chronic, count = 10): EwmaSeriesPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    day: `2026-11-${String(10 + i).padStart(2, "0")}`,
    rawLoad: i % 2 === 0 ? chronic : 0,
    acute7d: i === count - 1 ? acute : chronic,
    chronic42d: i === count - 1 ? chronic : prevChronic,
    optimalMin: Math.round(chronic * 0.85 * 100) / 100,
    optimalMax: Math.round(chronic * 1.3 * 100) / 100,
    confidence: "complete",
  }));
}

test("classifyLoadStatus identifies Calibrating, Detraining, Peaking, Maintaining, Productive, Fatigued, and Overtraining", () => {
  assert.equal(classifyLoadStatus(makeSeries(10, 10, 10, 4), "muscular")?.status, "calibrating");
  assert.equal(classifyLoadStatus(makeSeries(6.5, 10), "muscular")?.status, "detraining");
  assert.equal(classifyLoadStatus(makeSeries(8.8, 10, 9.0), "muscular")?.status, "peaking");
  assert.equal(classifyLoadStatus(makeSeries(9.8, 10), "muscular")?.status, "maintaining");
  assert.equal(classifyLoadStatus(makeSeries(11.8, 10), "muscular")?.status, "productive");
  assert.equal(classifyLoadStatus(makeSeries(14.0, 10), "muscular")?.status, "fatigued");
  assert.equal(classifyLoadStatus(makeSeries(16.5, 10), "muscular")?.status, "overtraining");
});

test("strain-v2.0 keeps strength-only session Cardio Strain modest and computeTargetStrain adapts to recovery", () => {
  // Real-world 79-min Upper A strength session: raw HR TRIMP 170.77, muscular 16.65
  const effectiveCardio = Math.round(170.77 * STRENGTH_CARDIO_FACTOR * 100) / 100;
  const strain = computeCompositeStrain(effectiveCardio, 16.65, 0.03);
  assert.ok(strain.cardioStrain < 25, `Strength-only Cardio Strain should be modest (<25), got ${strain.cardioStrain}`);
  assert.ok(strain.muscularStrain >= 45 && strain.muscularStrain <= 55, `16.65 raw muscular should be ~50, got ${strain.muscularStrain}`);
  assert.ok(strain.overallStrain >= 50 && strain.overallStrain <= 65, `Overall strain should be ~57, got ${strain.overallStrain}`);

  assert.equal(computeTargetStrain(84).label, "Ready to push");
  assert.equal(computeTargetStrain(62).label, "Steady training");
  assert.equal(computeTargetStrain(38).label, "Active recovery");
  assert.equal(computeTargetStrain(null).label, "Baseline target");
});

