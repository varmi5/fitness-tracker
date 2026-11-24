import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { createPhysiqueInput, physiqueData } from "../lib/physique-data";
import * as schema from "../lib/schema";

const pg = new PGlite();
const db = drizzle(pg, { schema });

const SAMPLE_DATA_URL =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

before(async () => {
  for (const migration of [
    "001-auth.sql",
    "002-tracker.sql",
    "004-nutrition-health.sql",
    "012-tracking-mode-and-fitbit-metrics.sql",
    "019-physique-checkins.sql",
  ]) {
    await pg.exec(await readFile(`migrations/${migration}`, "utf8"));
  }
  await db.insert(schema.user).values(
    ["A", "B"].map((id) => ({
      id,
      name: id,
      email: `${id}@example.test`,
      createdAt: new Date(),
      updatedAt: new Date(),
    })),
  );
});

after(async () => pg.close());

test("physique check-ins auto-fill weight/body-fat, filter by pose, and enforce user isolation", async () => {
  const a = physiqueData(db, "A");
  const b = physiqueData(db, "B");

  await db.insert(schema.measurement).values({
    id: "m1",
    userId: "A",
    metric: "weight",
    side: "none",
    value: 71.9,
    date: "2026-11-23",
    note: "",
  });
  await db.insert(schema.dailyRecovery).values({
    userId: "A",
    day: "2026-11-24",
    source: "google",
    bodyFatPct: 22.6,
  });

  const front = await a.create({
    day: "2026-11-24",
    pose: "front",
    cadence: "weekly",
    photoData: SAMPLE_DATA_URL,
    note: "Morning fasted",
  });
  assert.equal(front.weightKg, 71.9);
  assert.equal(front.bodyFatPct, 22.6);
  assert.equal(front.pose, "front");

  const side = await a.create({
    day: "2026-11-24",
    pose: "side",
    cadence: "daily",
    photoData: SAMPLE_DATA_URL,
    weightKg: 72.1,
    bodyFatPct: 22.4,
    note: "",
  });
  assert.equal(side.weightKg, 72.1);

  assert.equal((await a.list()).length, 2);
  assert.equal((await a.list("front")).length, 1);
  assert.equal((await b.list()).length, 0);

  // User B cannot delete User A's check-in
  assert.deepEqual(await b.remove(front.id), { deleted: false });
  assert.deepEqual(await a.remove(front.id), { deleted: true });
  assert.equal((await a.list()).length, 1);
});

test("physique validation rejects non-image data URLs", () => {
  assert.equal(
    createPhysiqueInput.safeParse({
      day: "2026-11-24",
      pose: "front",
      cadence: "weekly",
      photoData: "https://example.com/photo.jpg",
    }).success,
    false,
  );
});
