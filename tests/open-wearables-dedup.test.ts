import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, randomBytes, sign as signCrypto } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import type { AuthDatabase } from "../lib/auth";
import { POST as googleWebhookPost } from "../app/api/integrations/google/webhook/route";
import { verifyGoogleWebhookAuthorization, verifyGoogleWebhookSignature } from "../lib/google-health";
import {
  createOpenWearablesInviteCode,
  disconnectOpenWearables,
  handleOpenWearablesWebhookEvent,
  openWearablesStatus,
  syncOpenWearables,
  verifySvixSignature,
} from "../lib/open-wearables";
import * as schema from "../lib/schema";
import {
  dedupeWorkoutsAcrossSources,
  pickDailyEnergyRow,
  pickRecoveryRowForDay,
  selectDailyHrStream,
  selectHrSamplesForWindow,
  selectStepIntervalsForEnergySource,
} from "../lib/source-priority";
import { strainData } from "../lib/strain-data";

const pg = new PGlite();
const db = drizzle(pg, { schema });
const typedDb = db as unknown as AuthDatabase;

before(async () => {
  const migrations = (await readdir("migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const m of migrations) {
    await pg.exec(await readFile(`migrations/${m}`, "utf8"));
  }
  await db.insert(schema.user).values([
    { id: "OW-1", name: "Alex Runner", email: "ow1@example.test", createdAt: new Date(), updatedAt: new Date() },
    { id: "OW-2", name: "Sam Lifter", email: "ow2@example.test", createdAt: new Date(), updatedAt: new Date() },
  ]);
});

after(async () => pg.close());

test("cross-wearable workout deduplication keeps primary on overlap and keeps both on watch swap", () => {
  const fitbitRun = {
    source: "google",
    sessionId: "fb-run-1",
    startTime: new Date("2026-11-24T07:32:00Z"),
    endTime: new Date("2026-11-24T08:15:00Z"),
    durationSeconds: 2580,
  };
  const appleRunSimultaneous = {
    source: "apple",
    sessionId: "aw-run-1",
    startTime: new Date("2026-11-24T07:30:00Z"),
    endTime: new Date("2026-11-24T08:16:00Z"),
    durationSeconds: 2760,
  };
  const eveningGymFitbit = {
    source: "google",
    sessionId: "fb-gym-2",
    startTime: new Date("2026-11-24T18:00:00Z"),
    endTime: new Date("2026-11-24T19:00:00Z"),
    durationSeconds: 3600,
  };

  // Default priority prefers Apple Watch for simultaneous workouts, while keeping non-overlapping evening Fitbit workout
  const dedupedAuto = dedupeWorkoutsAcrossSources([fitbitRun, appleRunSimultaneous, eveningGymFitbit], "auto");
  assert.equal(dedupedAuto.length, 2);
  assert.deepEqual(
    dedupedAuto.map((w) => w.sessionId),
    ["aw-run-1", "fb-gym-2"],
  );

  // Explicit primaryWorkoutSource = "google" flips simultaneous selection to Fitbit
  const dedupedGooglePref = dedupeWorkoutsAcrossSources([fitbitRun, appleRunSimultaneous, eveningGymFitbit], "google");
  assert.equal(dedupedGooglePref.length, 2);
  assert.deepEqual(
    dedupedGooglePref.map((w) => w.sessionId),
    ["fb-run-1", "fb-gym-2"],
  );
});

test("HR window, daily HR stream, step intervals, and recovery baseline never interleave multiple watches", () => {
  const hrSamples = [
    { source: "google", recordedAt: new Date("2026-11-24T07:35:00Z"), bpm: 148 },
    { source: "apple", recordedAt: new Date("2026-11-24T07:35:00Z"), bpm: 152 },
    { source: "apple", recordedAt: new Date("2026-11-24T07:36:00Z"), bpm: 156 },
  ];
  const windowHr = selectHrSamplesForWindow(
    hrSamples,
    new Date("2026-11-24T07:30:00Z").getTime(),
    new Date("2026-11-24T08:00:00Z").getTime(),
    "apple",
  );
  assert.equal(windowHr.length, 2);
  assert.ok(windowHr.every((s) => s.source === "apple"));

  const dailyStream = selectDailyHrStream(hrSamples, "google");
  assert.equal(dailyStream.length, 1);
  assert.equal(dailyStream[0].source, "google");

  const steps = [
    { source: "google", startTime: new Date("2026-11-24T09:00:00Z"), endTime: new Date("2026-11-24T09:15:00Z"), steps: 1400 },
    { source: "apple", startTime: new Date("2026-11-24T09:00:00Z"), endTime: new Date("2026-11-24T09:15:00Z"), steps: 1450 },
  ];
  assert.equal(selectStepIntervalsForEnergySource(steps, "google").length, 1);

  const recMap = pickRecoveryRowForDay(
    [
      { source: "apple", day: "2026-11-24", syncedAt: new Date("2026-11-24T08:00:00Z"), hrvRmssdMs: 42 },
      { source: "google", day: "2026-11-24", syncedAt: new Date("2026-11-24T07:00:00Z"), hrvRmssdMs: 55 },
    ],
    "auto",
  );
  const rec = recMap.get("2026-11-24");
  assert.equal(rec?.source, "google");
  assert.equal(rec?.hrvRmssdMs, 55);

  const energy = pickDailyEnergyRow(
    [
      { source: "apple", steps: 9500 },
      { source: "google", steps: 9100 },
    ],
    "apple",
  );
  assert.equal(energy?.source, "apple");
});

test("verifySvixSignature verifies HMAC-SHA256 signatures and enforces 5-minute replay window", () => {
  const rawSecret = randomBytes(32);
  const whsec = `whsec_${rawSecret.toString("base64")}`;
  const svixId = "msg_2test123";
  const nowSec = 1764000000;
  const svixTimestamp = String(nowSec);
  const body = JSON.stringify({ type: "workout.created", data: { user_id: "ow-u1" } });
  const expectedSig = createHmac("sha256", rawSecret).update(`${svixId}.${svixTimestamp}.${body}`).digest("base64");

  assert.equal(
    verifySvixSignature(
      body,
      { svixId, svixTimestamp, svixSignature: `v0,oldsig v1,${expectedSig}` },
      whsec,
      nowSec + 60,
    ).ok,
    true,
  );
  assert.equal(
    verifySvixSignature(
      `${body} `,
      { svixId, svixTimestamp, svixSignature: `v1,${expectedSig}` },
      whsec,
      nowSec,
    ).ok,
    false,
  );
  assert.equal(
    verifySvixSignature(
      body,
      { svixId, svixTimestamp, svixSignature: `v1,${expectedSig}` },
      whsec,
      nowSec + 400,
    ).ok,
    false,
  );
});

test("syncOpenWearables ingests Apple Health + Garmin safely, isolates users, skips duplicate Google, and computes strain", async () => {
  const prevUrl = process.env.OPEN_WEARABLES_API_URL;
  const prevKey = process.env.OPEN_WEARABLES_API_KEY;
  const originalFetch = globalThis.fetch;
  const prevDeveloperEmail = process.env.OPEN_WEARABLES_DEVELOPER_EMAIL;
  const prevDeveloperPassword = process.env.OPEN_WEARABLES_DEVELOPER_PASSWORD;

  process.env.OPEN_WEARABLES_DEVELOPER_EMAIL = "ow-developer@example.test";
  process.env.OPEN_WEARABLES_DEVELOPER_PASSWORD = "test-developer-password";
  process.env.OPEN_WEARABLES_API_URL = "https://ow.local.test";
  process.env.OPEN_WEARABLES_API_KEY = "sk-test-123";

  // Pretend OW-1 also has direct Google Health connected -> Open Wearables should skip provider=fitbit duplicates
  await db.insert(schema.healthIntegration).values({
    userId: "OW-1",
    provider: "google",
    credential: "sealed-dummy",
    externalUserId: "gh-user-1",
    status: "connected",
  });

  const owUserUuid = "11111111-1111-4111-8111-111111111111";

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.endsWith("/api/v1/auth/login")) {
      assert.equal(init?.method, "POST");
      assert.ok(init?.body instanceof URLSearchParams);
      assert.equal(init.body.get("username"), "ow-developer@example.test");
      assert.equal(init.body.get("password"), "test-developer-password");
      return Response.json({ access_token: "developer-jwt", expires_in: 900 });
    }
    if (url.endsWith("/api/v1/users") && init?.method === "POST") {
      assert.equal(new Headers(init.headers).get("X-Open-Wearables-API-Key"), "sk-test-123");
      assert.equal(new Headers(init.headers).get("Authorization"), null);
      return Response.json({ id: owUserUuid });
    }
    if (url.endsWith(`/api/v1/users/${owUserUuid}/invitation-code`)) {
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer developer-jwt");
      return Response.json({ id: "inv-1", code: "ABCD1234", expires_at: "2026-11-26T00:00:00Z" });
    }
    if (url.includes(`/api/v1/users/${owUserUuid}/connections`)) {
      return Response.json([{ provider: "apple_health_sdk", status: "active" }]);
    }
    if (url.includes("/summaries/activity")) {
      return Response.json({
        data: [
          {
            date: "2026-11-24",
            source: { provider: "apple_health", device: "Apple Watch" },
            steps: 11200,
            total_calories_kcal: 2480,
            active_calories_kcal: 620,
            distance_meters: 8400,
          },
          {
            date: "2026-11-24",
            source: { provider: "fitbit", device: "Fitbit" },
            steps: 9000,
            total_calories_kcal: 2300,
          },
        ],
      });
    }
    if (url.includes("/events/sleep")) {
      return Response.json({
        data: [
          {
            id: "slp-aw-1",
            start_time: "2026-11-23T23:00:00Z",
            end_time: "2026-11-24T06:40:00Z",
            sleep_duration_seconds: 430 * 60,
            source: { provider: "apple_health" },
            stages: { awake_minutes: 30, light_minutes: 210, deep_minutes: 100, rem_minutes: 120 },
            is_nap: false,
          },
        ],
      });
    }
    if (url.includes("/summaries/sleep")) {
      return Response.json({ data: [] });
    }
    if (url.includes("/summaries/recovery")) {
      return Response.json({
        data: [
          {
            date: "2026-11-24",
            source: { provider: "apple_health" },
            resting_heart_rate_bpm: 54,
            avg_hrv_sdnn_ms: 61,
            avg_spo2_percent: 98,
          },
        ],
      });
    }
    if (url.includes("/summaries/body")) {
      return Response.json({
        source: { provider: "apple_health" },
        slow_changing: { weight_kg: 74.6, height_cm: 178, body_fat_percent: 14.5 },
      });
    }
    if (url.includes("/events/workouts")) {
      return Response.json({
        data: [
          {
            id: "aw-run-99",
            type: "running",
            name: "Morning Tempo Run",
            start_time: "2026-11-24T07:30:00Z",
            end_time: "2026-11-24T08:10:00Z",
            duration_seconds: 2400,
            source: { provider: "apple_health" },
            calories_kcal: 410,
            distance_meters: 7200,
            avg_heart_rate_bpm: 158,
          },
        ],
      });
    }
    if (url.includes("types=heart_rate")) {
      const samples = Array.from({ length: 35 }, (_, idx) => ({
        timestamp: new Date(Date.UTC(2026, 10, 24, 7, 31 + idx, 0)).toISOString(),
        type: "heart_rate",
        value: 156 + (idx % 6),
        source: { provider: "apple_health" },
      }));
      return Response.json({ data: samples });
    }
    if (url.includes("types=steps")) {
      return Response.json({
        data: [
          {
            timestamp: "2026-11-24T07:35:00Z",
            window_seconds: 600,
            type: "steps",
            value: 1600,
            source: { provider: "apple_health" },
          },
        ],
      });
    }
    return Response.json({ data: [] });
  }) as typeof fetch;

  try {
    const invite = await createOpenWearablesInviteCode(typedDb, "OW-1");
    assert.equal(invite.code, "ABCD1234");

    const syncRes = await syncOpenWearables(typedDb, "OW-1", { from: "2026-11-24", to: "2026-11-24" });
    assert.equal(syncRes.syncedDays, 1);
    assert.equal(syncRes.syncedWorkouts, 1);
    assert.equal(syncRes.syncedHeartRateSamples, 35);

    const status1 = await openWearablesStatus(typedDb, "OW-1");
    assert.equal(status1.connected, true);
    assert.ok(status1.providers.includes("apple"));

    // User OW-2 stays completely isolated
    const status2 = await openWearablesStatus(typedDb, "OW-2");
    assert.equal(status2.connected, false);

    // Webhook event triggers targeted sync cleanly
    const whRes = await handleOpenWearablesWebhookEvent(typedDb, {
      type: "workout.created",
      data: { user_id: owUserUuid, start_time: "2026-11-24T07:30:00Z", end_time: "2026-11-24T08:10:00Z" },
    });
    assert.equal(whRes.handled, true);
    assert.equal(whRes.userId, "OW-1");

    // Duplicate Google rows did not overwrite Google integration; Apple energy exists
    const energyRows = await db.select().from(schema.dailyEnergy).where(eq(schema.dailyEnergy.userId, "OW-1"));
    assert.equal(energyRows.length, 1);
    assert.equal(energyRows[0].source, "apple");

    // Strain computation succeeds against synced Open Wearables workout
    const dayStrain = await strainData(typedDb, "OW-1").computeDay("2026-11-24");
    assert.ok((dayStrain.overallStrain ?? 0) > 0);

    await disconnectOpenWearables(typedDb, "OW-1");
    const afterDisconnect = await openWearablesStatus(typedDb, "OW-1");
    assert.equal(afterDisconnect.connected, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (prevUrl === undefined) delete process.env.OPEN_WEARABLES_API_URL;
    else process.env.OPEN_WEARABLES_API_URL = prevUrl;
    if (prevKey === undefined) delete process.env.OPEN_WEARABLES_API_KEY;
    else process.env.OPEN_WEARABLES_API_KEY = prevKey;
    if (prevDeveloperEmail === undefined) delete process.env.OPEN_WEARABLES_DEVELOPER_EMAIL;
    else process.env.OPEN_WEARABLES_DEVELOPER_EMAIL = prevDeveloperEmail;
    if (prevDeveloperPassword === undefined) delete process.env.OPEN_WEARABLES_DEVELOPER_PASSWORD;
    else process.env.OPEN_WEARABLES_DEVELOPER_PASSWORD = prevDeveloperPassword;
  }
});

test("Google Health API v4 webhook enforces 2-step verification handshake and Tink ECDSA signatures", async () => {
  const prevSecret = process.env.GOOGLE_HEALTH_WEBHOOK_SECRET;
  process.env.GOOGLE_HEALTH_WEBHOOK_SECRET = "new-secret-123,old-secret-456";

  try {
    // 1. Authorized verification challenge -> 200 OK
    const authRes = await googleWebhookPost(
      new Request("https://fitness.test/api/integrations/google/webhook", {
        method: "POST",
        headers: { Authorization: "Bearer new-secret-123", "Content-Type": "application/json" },
        body: JSON.stringify({ type: "verification" }),
      }),
    );
    assert.equal(authRes.status, 200);

    // 2. Unauthorized verification challenge -> 401 Unauthorized
    const unauthRes = await googleWebhookPost(
      new Request("https://fitness.test/api/integrations/google/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "verification" }),
      }),
    );
    assert.equal(unauthRes.status, 401);

    // Rotation secret also accepted
    assert.equal(verifyGoogleWebhookAuthorization("Bearer old-secret-456", process.env.GOOGLE_HEALTH_WEBHOOK_SECRET), true);
    assert.equal(verifyGoogleWebhookAuthorization("Bearer wrong", process.env.GOOGLE_HEALTH_WEBHOOK_SECRET), false);

    // 3. Tink ECDSA P-256 signature verification
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
    const xBytes = Buffer.from(jwk.x, "base64url");
    const yBytes = Buffer.from(jwk.y, "base64url");
    // Construct minimal Tink EcdsaPublicKey protobuf: field 3 (0x1a len 32) x + field 4 (0x22 len 32) y
    const protoBuf = Buffer.concat([
      Buffer.from([0x1a, xBytes.length]),
      xBytes,
      Buffer.from([0x22, yBytes.length]),
      yBytes,
    ]);
    const keyId = 2280854714;
    const mockKeyset = {
      primaryKeyId: keyId,
      key: [
        {
          keyId,
          status: "ENABLED",
          keyData: { value: protoBuf.toString("base64") },
        },
      ],
    };

    const payload = JSON.stringify([{ data: { healthUserId: "gh-u-1", dataType: "steps" } }]);
    const derSig = signCrypto("sha256", Buffer.from(payload, "utf8"), privateKey);
    const prefix = Buffer.alloc(5);
    prefix[0] = 0x01;
    prefix.writeUInt32BE(keyId, 1);
    const headerSig = Buffer.concat([prefix, derSig]).toString("base64");

    assert.equal(await verifyGoogleWebhookSignature(payload, headerSig, mockKeyset), true);
    assert.equal(await verifyGoogleWebhookSignature(`${payload}x`, headerSig, mockKeyset), false);
  } finally {
    process.env.GOOGLE_HEALTH_WEBHOOK_SECRET = prevSecret;
  }
});
