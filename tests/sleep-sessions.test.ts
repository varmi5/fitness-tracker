import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { parseGoogleSleep, parseSavedHealthImport, disconnectGoogle, fetchSleepSessions, syncGoogle, seal } from "../lib/google-health";
import { nutritionData } from "../lib/nutrition-data";
import { computeSleepInsights, selectNonOverlappingSleepSessions } from "../lib/pulse-engine";
import { saveSleepSession } from "../lib/sleep-session-data";
import * as schema from "../lib/schema";

const pg = new PGlite();
const db = drizzle(pg, { schema });
before(async () => {
  for (const f of (await readdir("migrations")).filter(f => f.endsWith(".sql")).sort()) await pg.exec(await readFile(`migrations/${f}`, "utf8"));
  await db.insert(schema.user).values(["sleep-a", "sleep-b"].map(id => ({ id, name: id, email: `${id}@example.test`, createdAt: new Date(), updatedAt: new Date() })));
});
after(async () => pg.close());

function googleSleep(id: string, start: string, end: string, asleep: number, nap = false) {
  return { name: `users/me/dataTypes/sleep/dataPoints/${id}`, sleep: {
    interval: { startTime: start, endTime: end }, metadata: { processed: true, mainSleep: !nap, nap },
    summary: { minutesAsleep: String(asleep), minutesAwake: "20", stagesSummary: [
      { type: "DEEP", minutes: "70" }, { type: "REM", minutes: "90" }, { type: "LIGHT", minutes: String(Math.max(0, asleep - 160)) },
    ] }, stages: [{ type: "DEEP", startTime: start, endTime: new Date(new Date(start).getTime() + 10 * 60000).toISOString() }],
  } };
}

test("Google official type fields retain deep/REM, naps and raw stage intervals without duplicate IDs", () => {
  const main = googleSleep("main", "2026-11-16T23:00:00Z", "2026-11-17T07:00:00Z", 460);
  const nap = googleSleep("nap", "2026-11-17T14:00:00Z", "2026-11-17T14:30:00Z", 25, true);
  const result = parseGoogleSleep({ dataPoints: [main, nap, main] });
  assert.equal(result.sessions.size, 1);
  assert.equal(result.allSessions.length, 2);
  assert.equal(result.allSessions[0].classificationMethod, "provider");
  assert.equal(result.sessions.get("2026-11-17")?.deepMinutes, 70);
  assert.equal(result.sessions.get("2026-11-17")?.remMinutes, 90);
  assert.equal(result.allSessions.find(s => s.sessionId === "nap")?.isMainSleep, false);
  assert.equal(result.allSessions[0].stageIntervalsJson?.[0].stage, "DEEP");
  const imported = parseSavedHealthImport(JSON.stringify({ dataPoints: [main, nap] }));
  assert.equal(imported.sleepEntries.length, 2);
});

test("Explicit provider main classification takes precedence over duration heuristics", () => {
  const main = googleSleep("main-short", "2026-11-16T23:00:00Z", "2026-11-16T23:40:00Z", 35);
  const unclassified = googleSleep("long-unknown", "2026-11-16T17:00:00Z", "2026-11-16T20:00:00Z", 160);
  delete (unclassified.sleep.metadata as Partial<typeof unclassified.sleep.metadata>).mainSleep;
  const parsed = parseGoogleSleep({ dataPoints: [main, unclassified] });
  assert.equal(parsed.sessions.get("2026-11-16")?.sessionId, "main-short");
  assert.equal(parsed.allSessions.filter(s => s.isMainSleep).length, 1);
});

test("Intervals alone do not establish minutes asleep, efficiency or zero awake", () => {
  const parsed = parseGoogleSleep({ dataPoints: [{ sleep: { interval: { startTime: "2026-11-16T23:00:00Z", endTime: "2026-11-17T07:00:00Z" } } }] });
  assert.equal(parsed.allSessions.length, 0);
});

test("Saved exports retain source identity even when two sources share a session ID", () => {
  const record = { day: "2026-11-17", sessionId: "shared-id", sleepStart: "2026-11-16T23:00:00Z", sleepEnd: "2026-11-17T07:00:00Z", minutesAsleep: 450 };
  const parsed = parseSavedHealthImport(JSON.stringify({ sleepSessions: [{ ...record, source: "google" }, { ...record, source: "manual" }] }));
  assert.equal(parsed.sleepEntries.length, 2);
  assert.deepEqual(parsed.sleepEntries.map(s => s.source).sort(), ["google", "manual"]);
});

test("Session persistence is idempotent, supports corrected dates, keeps naps and isolates users", async () => {
  const entries = parseGoogleSleep({ dataPoints: [
    googleSleep("persist-main", "2026-11-16T23:00:00Z", "2026-11-17T07:00:00Z", 460),
    googleSleep("persist-nap", "2026-11-17T14:00:00Z", "2026-11-17T14:30:00Z", 25, true),
  ] }).allSessions;
  for (let i = 0; i < 2; i++) await nutritionData(db, "sleep-a").importHealthRecords({ sleepEntries: entries.map(s => ({ ...s, source: "google" })) });
  await nutritionData(db, "sleep-b").importHealthRecords({ sleepEntries: [{ ...entries[0], minutesAsleep: 430, source: "google" }] });
  let data = await nutritionData(db, "sleep-a").healthHistory("2026-11-17", "2026-11-18");
  assert.equal(data.sleepSessions.length, 2);
  assert.equal(data.sleep[0].minutesAsleep, 460);
  assert.equal(data.sleepSessions.find(s => !s.isMainSleep)?.minutesAsleep, 25);
  assert.equal(JSON.stringify(data).includes("sleep-b"), false);
  const corrected = { ...entries[0], day: "2026-11-18", sleepStart: "2026-11-17T23:00:00Z", sleepEnd: "2026-11-18T07:00:00Z", source: "google" as const };
  await db.transaction(tx => saveSleepSession(tx, "sleep-a", corrected));
  data = await nutritionData(db, "sleep-a").healthHistory("2026-11-17", "2026-11-18");
  assert.equal(data.sleepSessions.length, 2);
  assert.equal(data.sleep.length, 1);
  assert.equal(data.sleep[0].day, "2026-11-18");
  assert.equal((await nutritionData(db, "sleep-b").healthHistory("2026-11-17", "2026-11-18")).sleep[0].minutesAsleep, 430);
});

test("Future and unprocessed observations remain raw but never create completed readiness", async () => {
  await db.transaction(tx => saveSleepSession(tx, "sleep-a", { day: "2099-11-17", source: "manual", sessionId: "future", sleepStart: "2099-11-16T23:00:00Z", sleepEnd: "2099-11-17T07:00:00Z", minutesAsleep: 460, isMainSleep: true }));
  await db.transaction(tx => saveSleepSession(tx, "sleep-a", { day: "2026-11-19", source: "google", sessionId: "processing", sleepStart: "2026-11-18T23:00:00Z", sleepEnd: "2026-11-19T07:00:00Z", minutesAsleep: 460, isMainSleep: true, processed: false }));
  const future = await nutritionData(db, "sleep-a").healthHistory("2099-11-17", "2099-11-17");
  assert.equal(future.sleepSessions[0].completed, false);
  assert.equal(future.sleep.length, 0);
  const processing = await nutritionData(db, "sleep-a").healthHistory("2026-11-19", "2026-11-19");
  assert.equal(processing.sleepSessions[0].completed, false);
  assert.equal(processing.sleep.length, 0);
});

test("Naps reduce observed shortfall once; overlapping records and unknown awake do not inflate scores", () => {
  const main = { day: "2026-11-17", minutesAsleep: 420, minutesAwake: null, deepMinutes: 70, remMinutes: 80, sleepStart: new Date("2026-11-16T23:00:00Z"), sleepEnd: new Date("2026-11-17T06:30:00Z"), isMainSleep: true };
  const nap = { ...main, minutesAsleep: 30, sleepStart: new Date("2026-11-17T14:00:00Z"), sleepEnd: new Date("2026-11-17T14:30:00Z"), isMainSleep: false };
  const selected = selectNonOverlappingSleepSessions([main, { ...main }, nap]);
  assert.equal(selected.length, 2);
  const insights = computeSleepInsights(main, selected, "2026-11-17", null);
  assert.equal(insights.sleepDebtHours, .5);
  assert.equal(insights.efficiencyPct, null);
  assert.equal(insights.debtCoverage, "partial");
  assert.equal(insights.deepPct, 16.7);
});

test("Historical sleep goals are user-scoped and exports preserve sessions; disconnect removes only Google", async () => {
  const a = nutritionData(db, "sleep-a"), b = nutritionData(db, "sleep-b");
  await a.setPreferences({ timezone: "America/New_York", googleTwoWaySync: true });
  await a.setPreferences({ sleepGoalMinutes: 450, sleepGoalEffectiveFrom: "2026-11-01" });
  await a.setPreferences({ timezone: "Europe/London", sleepGoalMinutes: 480, sleepGoalEffectiveFrom: "2026-11-18" });
  await a.setPreferences({ timezone: "Europe/London", sleepGoalMinutes: 480, sleepGoalEffectiveFrom: "2026-11-18" });
  assert.equal((await a.settings()).sleepGoals.length, 2);
  assert.equal((await a.settings()).googleTwoWaySync, true);
  assert.equal((await b.settings()).sleepGoals.length, 0);
  await assert.rejects(() => a.setPreferences({ timezone: "Europe/London", sleepGoalMinutes: 200 }));
  const detailed = await a.healthHistory("2026-11-17", "2026-11-18", { includeStageIntervals: true });
  assert.ok(detailed.sleepSessions.some(s => Array.isArray(s.stageIntervalsJson) && s.stageIntervalsJson.length > 0));
  assert.equal((await a.healthHistory("2026-11-17", "2026-11-18")).sleepSessions[0].stageIntervalsJson, undefined);
  await assert.rejects(() => a.healthHistory("2026-10-01", "2026-11-18", { includeStageIntervals: true }), /at most 31/);
  const exported = await a.export();
  assert.ok(exported.sleepSessions.length >= 2);
  assert.equal(exported.sleepGoals.length, 2);
  await disconnectGoogle(db, "sleep-a");
  assert.equal((await db.select().from(schema.sleepSession).where(eq(schema.sleepSession.userId, "sleep-a"))).some(s => s.source === "google"), false);
  assert.equal((await db.select().from(schema.sleepSession).where(eq(schema.sleepSession.userId, "sleep-b"))).length, 1);
  assert.ok((await db.select().from(schema.sleepSession).where(eq(schema.sleepSession.userId, "sleep-a"))).some(s => s.source === "manual"));
});


test("Paged Google reads choose one main globally and authoritative refresh removes deleted provider sessions", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FITNESS_INTEGRATION_KEY;
  process.env.FITNESS_INTEGRATION_KEY = "f".repeat(64);
  const short = googleSleep("paged-short", "2026-11-20T01:00:00Z", "2026-11-20T04:00:00Z", 160);
  const long = googleSleep("paged-long", "2026-11-20T05:00:00Z", "2026-11-20T10:00:00Z", 280);
  delete (short.sleep.metadata as Partial<typeof short.sleep.metadata>).mainSleep;
  delete (long.sleep.metadata as Partial<typeof long.sleep.metadata>).mainSleep;
  short.sleep.metadata.nap = false; long.sleep.metadata.nap = false;
  let empty = false, failed = false;
  const grant = { accessToken: "synthetic", refreshToken: "synthetic", expiresAt: Date.now() + 3600000, scopes: ["https://www.googleapis.com/auth/googlehealth.sleep.readonly"] };
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    assert.equal(url.hostname, "health.googleapis.com", "Synthetic mock must never access another service");
    if (url.pathname.includes("/sleep/")) {
      if (failed) return new Response("temporary upstream failure", { status: 503 });
      return Response.json(empty ? { dataPoints: [] } : url.searchParams.get("pageToken") ? { dataPoints: [long] } : { dataPoints: [short, short], nextPageToken: "second" });
    }
    return Response.json({ dataPoints: [], rollupDataPoints: [] });
  };
  try {
    const fetched = await fetchSleepSessions(grant, "2026-11-20", "2026-11-21");
    assert.equal(fetched.allSessions.length, 2);
    assert.equal(fetched.allSessions.filter(s => s.isMainSleep).length, 1);
    assert.equal(fetched.allSessions.find(s => s.isMainSleep)?.sessionId, "paged-long");
    await db.insert(schema.healthIntegration).values({ userId: "sleep-b", provider: "google", credential: seal(grant, "sleep-b"), status: "connected" });
    await syncGoogle(db, "sleep-b", "2026-11-20", "2026-11-20");
    const b = nutritionData(db, "sleep-b");
    assert.equal((await b.healthHistory("2026-11-20", "2026-11-20")).sleepSessions.length, 2);
    // Failed requests retain prior good records. Only a complete, successful read reconciles deletes.
    failed = true;
    await assert.rejects(() => syncGoogle(db, "sleep-b", "2026-11-20", "2026-11-20"));
    assert.equal((await b.healthHistory("2026-11-20", "2026-11-20")).sleepSessions.length, 2);
    failed = false; empty = true;
    await syncGoogle(db, "sleep-b", "2026-11-20", "2026-11-20");
    assert.equal((await b.healthHistory("2026-11-20", "2026-11-20")).sleepSessions.length, 0);
    assert.equal((await b.healthHistory("2026-11-20", "2026-11-20")).sleep.length, 0);
    assert.equal((await b.healthHistory("2026-11-17", "2026-11-17")).sleepSessions.length, 1, "Other dates preserved");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FITNESS_INTEGRATION_KEY;
    else process.env.FITNESS_INTEGRATION_KEY = originalKey;
  }
});
