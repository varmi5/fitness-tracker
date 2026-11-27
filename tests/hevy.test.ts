import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import {
  connectHevy,
  disconnectHevy,
  dedupeHevyWorkouts,
  findMatchingGoogleWorkout,
  hevyStatus,
  importHevyWorkouts,
  listHevyWorkoutsForRange,
  parseHevyCsv,
  parseHevyImport,
  parseHevyJson,
  syncHevyOAuth,
} from "../lib/hevy";
import * as schema from "../lib/schema";

const pg = new PGlite();
const db = drizzle(pg, { schema });

before(async () => {
  const migrations = (await readdir("migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const m of migrations) {
    await pg.exec(await readFile(`migrations/${m}`, "utf8"));
  }
  await db.insert(schema.user).values([
    { id: "HV-1", name: "HV-1", email: "hv1@example.test", createdAt: new Date(), updatedAt: new Date() },
    { id: "HV-2", name: "HV-2", email: "hv2@example.test", createdAt: new Date(), updatedAt: new Date() },
  ]);
});

after(async () => pg.close());

test("parseHevyCsv parses sets, set types, RPE, and produces deterministic deduplication IDs", () => {
  const csv = [
    "title,start_time,end_time,description,exercise_title,superset_id,exercise_notes,set_index,set_type,weight_kg,reps,distance_km,duration_seconds,rpe",
    '"Upper A","2026-11-23T13:42:00Z","2026-11-23T15:02:00Z","Heavy push","Bench Press (Barbell)",,"Paused",0,"warmup",40,8,,,',
    '"Upper A","2026-11-23T13:42:00Z","2026-11-23T15:02:00Z","Heavy push","Bench Press (Barbell)",,"Paused",1,"normal",80,6,,,8.5',
    '"Upper A","2026-11-23T13:42:00Z","2026-11-23T15:02:00Z","Heavy push","Bench Press (Barbell)",,"Paused",2,"failure",80,5,,,10',
    '"Upper A","2026-11-23T13:42:00Z","2026-11-23T15:02:00Z","Heavy push","Lateral Raise (Dumbbell)",1,,0,"dropset",10,12,,,9',
  ].join("\n");

  const parsedA = parseHevyCsv(csv, "Europe/London");
  const parsedB = parseHevyImport(csv, "Europe/London");
  assert.equal(parsedA.length, 1);
  assert.equal(parsedA[0].hevyId, parsedB[0].hevyId);
  assert.equal(parsedA[0].day, "2026-11-23");
  assert.equal(parsedA[0].durationSeconds, 4800);
  assert.equal(parsedA[0].sets.length, 4);
  assert.equal(parsedA[0].sets[0].setType, "warmup");
  assert.equal(parsedA[0].sets[1].rpe, 8.5);
  assert.equal(parsedA[0].sets[2].setType, "failure");
  assert.equal(parsedA[0].sets[3].setType, "dropset");
  assert.equal(parsedA[0].sets[3].supersetId, 1);
});

test("importHevyWorkouts matches Google workout, associates wearable HR samples, deduplicates, and isolates users", async () => {
  await db.insert(schema.dailyWorkout).values({
    userId: "HV-1",
    source: "google",
    sessionId: "g-nov23",
    day: "2026-11-23",
    title: "Strength training",
    exerciseType: "EXERCISE_TYPE_WEIGHTLIFTING",
    startTime: new Date("2026-11-23T13:42:30Z"),
    endTime: new Date("2026-11-23T15:01:30Z"),
    durationSeconds: 4740,
  });

  await db.insert(schema.heartRateSample).values([
    { userId: "HV-1", source: "google", recordedAt: new Date("2026-11-23T13:45:00Z"), bpm: 118, day: "2026-11-23", dataSource: "WATCH" },
    { userId: "HV-1", source: "google", recordedAt: new Date("2026-11-23T14:20:00Z"), bpm: 138, day: "2026-11-23", dataSource: "WATCH" },
    { userId: "HV-2", source: "google", recordedAt: new Date("2026-11-23T14:20:00Z"), bpm: 199, day: "2026-11-23", dataSource: "WATCH" },
  ]);

  const matched = findMatchingGoogleWorkout("2026-11-23T13:42:00Z", "2026-11-23T15:02:00Z", [
    { sessionId: "g-nov23", startTime: new Date("2026-11-23T13:42:30Z"), endTime: new Date("2026-11-23T15:01:30Z"), avgHrBpm: null },
  ]);
  assert.equal(matched?.sessionId, "g-nov23");

  const workouts = parseHevyJson(
    {
      workouts: [
        {
          id: "hv-workout-1",
          title: "Upper A",
          start_time: "2026-11-23T13:42:00Z",
          end_time: "2026-11-23T15:02:00Z",
          exercises: [
            {
              index: 0,
              title: "Incline Dumbbell Press",
              sets: [
                { index: 0, type: "normal", weight_kg: 32.5, reps: 8, rpe: 8 },
                { index: 1, type: "normal", weight_kg: 32.5, reps: 8, rpe: 9 },
              ],
            },
          ],
        },
      ],
    },
    "Europe/London",
  ).workouts;

  const res1 = await importHevyWorkouts(db, "HV-1", workouts);
  assert.equal(res1.importedWorkouts, 1);
  assert.equal(res1.matchedGoogleWorkouts, 1);
  assert.equal(res1.hrAssociatedWorkouts, 1);

  // Re-import edited workout (1 extra set) and verify no duplicates & clean set update
  workouts[0].sets.push({
    ...workouts[0].sets[1],
    setIndex: 2,
    rpe: 9.5,
  });
  await importHevyWorkouts(db, "HV-1", workouts);

  const list1 = await listHevyWorkoutsForRange(db, "HV-1", "2026-11-23", "2026-11-23");
  assert.equal(list1.length, 1);
  assert.equal(list1[0].matchedGoogleSessionId, "g-nov23");
  assert.equal(list1[0].avgHrBpm, 128);
  assert.equal(list1[0].hrSampleCount, 2);
  assert.equal(list1[0].sets.length, 3);

  // HV-2 must see zero workouts from HV-1
  const list2 = await listHevyWorkoutsForRange(db, "HV-2", "2026-11-23", "2026-11-23");
  assert.equal(list2.length, 0);

  // Deleted workout ID removes workout + sets cleanly
  const delRes = await importHevyWorkouts(db, "HV-1", [], { deletedIds: ["hv-workout-1"] });
  assert.equal(delRes.deletedWorkouts, 1);
  assert.equal((await listHevyWorkoutsForRange(db, "HV-1", "2026-11-23", "2026-11-23")).length, 0);
  assert.equal((await db.select().from(schema.hevySet).where(eq(schema.hevySet.userId, "HV-1"))).length, 0);
});

test("syncHevyOAuth paginates /v1/workouts and disconnectHevy cleans up credentials", async () => {
  process.env.FITNESS_INTEGRATION_KEY = randomBytes(32).toString("hex");
  const originalFetch = globalThis.fetch;

  await connectHevy(db, "HV-1", {
    accessToken: "hevy-tok",
    refreshToken: "hevy-ref",
    expiresAt: Date.now() + 3600_000,
    scopes: ["read:workouts"],
  });

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("page=1")) {
      return new Response(
        JSON.stringify({
          page: 1,
          page_count: 2,
          workouts: [
            {
              id: "oauth-w1",
              title: "Pull Day",
              start_time: "2026-11-22T10:00:00Z",
              end_time: "2026-11-22T11:00:00Z",
              exercises: [{ title: "Pull Up", sets: [{ type: "normal", reps: 10 }] }],
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        page: 2,
        page_count: 2,
        workouts: [
          {
            id: "oauth-w2",
            title: "Leg Day",
            start_time: "2026-11-21T10:00:00Z",
            end_time: "2026-11-21T11:05:00Z",
            exercises: [{ title: "Squat (Barbell)", sets: [{ type: "normal", weight_kg: 100, reps: 5, rpe: 8 }] }],
          },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const res = await syncHevyOAuth(db, "HV-1");
    assert.equal(res.importedWorkouts, 2);
    const status = await hevyStatus(db, "HV-1");
    assert.equal(status.connected, true);
    assert.equal(status.workoutCount, 2);

    await disconnectHevy(db, "HV-1", true);
    const afterDisconnect = await hevyStatus(db, "HV-1");
    assert.equal(afterDisconnect.connected, false);
    assert.equal(afterDisconnect.workoutCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FITNESS_INTEGRATION_KEY;
  }
});

test("Hevy matches overlapping strength and de-duplicates an export paired with a live record", () => {
  const day = "2026-11-23";
  const startTime = new Date(day + "T12:00:00Z");
  const endTime = new Date(day + "T13:00:00Z");
  const session = { day, startTime, endTime, title: "Bench Session" };
  const csv = { ...session, source: "hevy_csv" };
  const live = { ...session, source: "hevy_oauth" };
  assert.deepEqual(dedupeHevyWorkouts([csv, live]), [live]);
  assert.equal(findMatchingGoogleWorkout(startTime.toISOString(), endTime.toISOString(), [
    { ...session, avgHrBpm: 140, sessionId: "run", exerciseType: "running" },
  ]), null);
  assert.equal(findMatchingGoogleWorkout(startTime.toISOString(), endTime.toISOString(), [
    { ...session, avgHrBpm: 120, sessionId: "strength", exerciseType: "strength_training" },
  ])?.sessionId, "strength");
});
