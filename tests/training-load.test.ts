import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { importHevyWorkouts } from "../lib/hevy";
import { computeEwmaSeries, estimateEpley1Rm, getTrainingLoadSummary } from "../lib/training-load";
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
});
