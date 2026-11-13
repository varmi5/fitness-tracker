import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { average, movingAverage, recomp, summary, type Reading } from "../lib/metrics";
import { signupMode } from "../lib/signup-config";
import { logInput, trackerData } from "../lib/tracker-data";
import * as schema from "../lib/schema";

const pg = new PGlite();
const db = drizzle(pg, { schema });

before(async () => {
  for (const migration of ["001-auth.sql", "002-tracker.sql"]) {
    await pg.exec(await readFile(`migrations/${migration}`, "utf8"));
  }
  await db.insert(schema.user).values(["A", "B"].map((id) => ({
    id, name: id, email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date(),
  })));
});
after(async () => pg.close());

test("users cannot read, overwrite or delete each other's measurements", async () => {
  const a = trackerData(db, "A");
  const b = trackerData(db, "B");
  const date = "2026-11-01";
  const input = { date, note: "B's note", values: [{ key: "waist" as const, value: 75 }] };
  await b.saveLog(input);
  const rowB = (await b.snapshot()).readings[0];
  assert.equal((await a.snapshot()).readings.length, 0);
  assert.equal(await a.deleteReading(rowB.id), false);

  await a.saveLog({ ...input, note: "", values: [{ key: "waist", value: 80 }] });
  await a.saveLog({ ...input, note: "", values: [{ key: "waist", value: 81 }] });
  const rowsA = (await a.snapshot()).readings;
  assert.equal(rowsA.length, 1);
  assert.equal(rowsA[0].value, 81);
  assert.deepEqual((await b.snapshot()).readings, [rowB]);

  await a.saveSettings({ heightCm: 175, units: "metric", goals: "A's goal" });
  assert.equal((await b.snapshot()).settings.heightCm, null);
  await a.deleteAccount();
  assert.equal((await a.snapshot()).readings.length, 0);
  assert.deepEqual((await b.snapshot()).readings, [rowB]);
});

test("measurement validation rejects invalid dates and duplicate metrics", () => {
  const input = { date: "2026-02-30", note: "", values: [{ key: "waist", value: 73 }] };
  assert.equal(logInput.safeParse(input).success, false);
  assert.equal(logInput.safeParse({ ...input, date: "2026-02-28", values: [...input.values, ...input.values] }).success, false);
});

const row = (date: string, value: number, metric = "waist", side = "none"): Reading =>
  ({ id: date, date, value, metric, side, note: "" });

test("averages use calendar days, skip absent dates and report missing history", () => {
  const readings = [row("2026-11-07", 85), row("2026-11-01", 80), row("2026-11-08", 82)];
  assert.deepEqual(movingAverage(readings).map((entry) => entry.average), [80, 82.5, 83.5]);
  assert.equal(summary(readings, "2026-11-08").change, 2);
  assert.equal(summary(readings, "2026-11-08").weekly, 83.5);
  assert.equal(summary(readings.slice(0, 1), "2026-11-08").change, null);
  assert.equal(average([]), null);
});

test("recomp compares adjacent 28-day periods", () => {
  const dates = ["2026-09-25", "2026-10-01", "2026-11-05", "2026-11-09"];
  const arms = dates.flatMap((date) => [row(date, 32, "bicep", "left"), row(date, 33, "bicep", "right")]);
  const result = (recentWaist: number) =>
    recomp([...arms, ...dates.map((date, i) => row(date, i < 2 ? 83 : recentWaist))], "2026-11-13");
  assert.equal(result(82), "On track");
  assert.equal(result(84), "Drifting");
  assert.equal(recomp(arms, "2026-11-13"), "Insufficient data");
});

test("opening signup requires sender and Turnstile configuration and invite mode requires a code", () => {
  assert.equal(signupMode({}), "closed");
  assert.throws(() => signupMode({ SIGNUP_MODE: "typo" }), /Invalid/);
  assert.throws(() => signupMode({ SIGNUP_MODE: "open" }), /RESEND_API_KEY/);
  assert.throws(() => signupMode({ SIGNUP_MODE: "open", RESEND_API_KEY: "test", EMAIL_FROM: "test@example.test" }), /TURNSTILE_SECRET_KEY/);
  const configured = { RESEND_API_KEY: "test", EMAIL_FROM: "test@example.test", TURNSTILE_SECRET_KEY: "test", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "test" };
  assert.equal(signupMode({ ...configured, SIGNUP_MODE: "open" }), "open");
  assert.throws(() => signupMode({ ...configured, SIGNUP_MODE: "invite" }), /INVITE_CODE/);
  assert.equal(signupMode({ ...configured, SIGNUP_MODE: "invite", INVITE_CODE: "test" }), "invite");
});
