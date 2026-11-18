import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import type { AuthDatabase } from "./auth";
import { NutritionError, nutritionData, upsertSyncedWeight, type MealRecord } from "./nutrition-data";
import {
  addDays,
  DEFAULT_TIMEZONE,
  energyInput,
  historyInput,
  localDay,
  resolveLocalDateTime,
  sleepInput,
  type MealCategory,
} from "./nutrition-model";
import { dailyEnergy, dailySleep, googleMealSync, healthIntegration, meal, measurement, profile } from "./schema";

const googleAPI = "https://health.googleapis.com/v4/users/me";
const activityScope = "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";
const measurementsScope = "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly";
const sleepScope = "https://www.googleapis.com/auth/googlehealth.sleep.readonly";
const measurementsWriteScope = "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.writeonly";
const nutritionWriteScope = "https://www.googleapis.com/auth/googlehealth.nutrition.writeonly";

const scopeValues = ["openid", "email", activityScope, measurementsScope, sleepScope];

const tokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number(),
  scopes: z.array(z.string()),
});
type Tokens = z.infer<typeof tokens>;

export function googleConfigured() {
  return Boolean(
    process.env.GOOGLE_HEALTH_CLIENT_ID &&
      process.env.GOOGLE_HEALTH_CLIENT_SECRET &&
      /^[a-f0-9]{64}$/i.test(process.env.FITNESS_INTEGRATION_KEY ?? ""),
  );
}

function key(rawHex = process.env.FITNESS_INTEGRATION_KEY) {
  if (!rawHex || !/^[a-f0-9]{64}$/i.test(rawHex)) {
    throw new NutritionError("Google Health integration encryption key is not configured.", 503);
  }
  return Buffer.from(rawHex, "hex");
}

export function seal(value: unknown, context: string, keyHex?: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(keyHex), nonce);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), body]).toString("base64url");
}

export function unseal(value: string, context: string, keyHex?: string): unknown {
  const data = Buffer.from(value, "base64url");
  if (data.length < 29) throw new Error("Invalid sealed payload.");
  const cipher = createDecipheriv("aes-256-gcm", key(keyHex), data.subarray(0, 12));
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8"));
}

export function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function googleConsent(callback: string, state: string, challenge: string, allowWrite = false) {
  if (!googleConfigured()) throw new NutritionError("Google Health is not configured.", 503);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_HEALTH_CLIENT_ID!,
    response_type: "code",
    redirect_uri: callback,
    access_type: "offline",
    prompt: "select_account consent",
    scope: [...scopeValues, ...(allowWrite ? [measurementsWriteScope, nutritionWriteScope] : [])].join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url;
}

async function exchange(params: Record<string, string>, previous?: Tokens) {
  if (!googleConfigured()) throw new NutritionError("Google Health is not configured.", 503);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    signal: AbortSignal.timeout(10000),
    body: new URLSearchParams({
      ...params,
      client_id: process.env.GOOGLE_HEALTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_HEALTH_CLIENT_SECRET!,
    }),
  });
  if (!response.ok) throw new NutritionError("Google rejected the authorization. Reconnect Google Health.", 422);
  const wire = z
    .object({
      access_token: z.string(),
      expires_in: z.number(),
      refresh_token: z.string().optional(),
      scope: z.string().optional(),
    })
    .parse(await response.json());

  const result = tokens.parse({
    accessToken: wire.access_token,
    refreshToken: wire.refresh_token ?? previous?.refreshToken,
    expiresAt: Date.now() + wire.expires_in * 1000,
    scopes: wire.scope?.split(" ") ?? previous?.scopes ?? [],
  });
  if (!result.scopes.includes(activityScope)) {
    throw new NutritionError("Google Health activity & fitness read permission is required.", 422);
  }
  return result;
}

async function fetchGoogleAccountLabel(accessToken: string, fallbackHealthUserId?: string): Promise<string | null> {
  try {
    const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5000),
    });
    if (infoRes.ok) {
      const info = (await infoRes.json()) as { email?: string };
      if (typeof info.email === "string" && info.email.trim()) {
        return info.email.trim().slice(0, 120);
      }
    }
  } catch {
    // Non-fatal fallback below
  }
  if (fallbackHealthUserId && fallbackHealthUserId.trim()) {
    const clean = fallbackHealthUserId.trim();
    return clean.length > 10 ? `Fitbit ID ${clean.slice(0, 8)}…` : clean;
  }
  return null;
}

export async function connectGoogle(db: AuthDatabase, userId: string, code: string, verifier: string, callback: string) {
  const grant = await exchange({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: callback,
  });

  const identity = await fetch(`${googleAPI}/identity`, {
    headers: { Authorization: `Bearer ${grant.accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  const identityPayload = await identity.json().catch(() => null);
  if (!identity.ok) {
    const unlinked = identityPayload?.error?.details?.some((value: { reason?: string }) => value.reason === "ACCOUNT_NOT_LINKED");
    throw new NutritionError(
      unlinked
        ? "Link your Fitbit / Google account in the Fitbit or Google Health app first."
        : "Google Health could not confirm this account is eligible.",
      422,
    );
  }
  const healthUserId = typeof identityPayload?.healthUserId === "string" ? identityPayload.healthUserId : undefined;
  const accountLabel = await fetchGoogleAccountLabel(grant.accessToken, healthUserId);

  await db.transaction(async (tx) => {
    await tx
      .insert(healthIntegration)
      .values({ userId, provider: "google", credential: seal(grant, userId), accountLabel, status: "connected", lastError: null })
      .onConflictDoUpdate({
        target: [healthIntegration.userId, healthIntegration.provider],
        set: {
          credential: seal(grant, userId),
          accountLabel,
          connectionId: randomBytes(16).toString("hex"),
          status: "connected",
          lastSync: null,
          lastError: null,
        },
      });
    await tx.delete(googleMealSync).where(eq(googleMealSync.userId, userId));
    await tx.update(meal).set({ googleDatapointName: null }).where(eq(meal.userId, userId));
    // Replacing a connection clears prior Google energy & sleep rows so two accounts never mix.
    await tx.delete(dailyEnergy).where(and(eq(dailyEnergy.userId, userId), eq(dailyEnergy.source, "google")));
    await tx.delete(dailySleep).where(and(eq(dailySleep.userId, userId), eq(dailySleep.source, "google")));
  });
}

type Field = "totalKcal" | "activeKcal" | "steps" | "weightKg";

const types = {
  "total-calories": ["totalKcal", "totalCalories", "kcalSum"],
  "active-energy-burned": ["activeKcal", "activeEnergyBurned", "kcalSum"],
  steps: ["steps", "steps", "countSum"],
  weight: ["weightKg", "weight", "weightGramsAvg"],
} as const;

function civil(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return { date: { year, month, day: date } };
}

export function parseGoogleRollup(type: keyof typeof types, payload: unknown) {
  const [field, section, name] = types[type];
  const envelope = z
    .object({ rollupDataPoints: z.array(z.unknown()).default([]), nextPageToken: z.string().optional() })
    .parse(payload);
  const rows = new Map<string, number>();

  for (const raw of envelope.rollupDataPoints) {
    const item = z
      .object({
        civilStartTime: z.object({
          date: z.object({ year: z.number().int(), month: z.number().int(), day: z.number().int() }),
        }),
      })
      .passthrough()
      .parse(raw);

    const { year, month, day } = item.civilStartTime.date;
    const date = z.iso
      .date()
      .parse([year, String(month).padStart(2, "0"), String(day).padStart(2, "0")].join("-"));
    const sectionObj = item[section] as Record<string, unknown> | undefined;
    const rawVal = sectionObj?.[name];
    const fallbackKg = type === "weight" && rawVal == null ? sectionObj?.kilogramsAvg : undefined;
    const value = rawVal ?? fallbackKg;
    if (value == null || value === "") continue;
    const parsed = z.number().nonnegative().parse(typeof value === "string" ? Number(value) : value);
    if (field === "weightKg") {
      const kg = fallbackKg != null ? parsed : parsed / 1000;
      if (kg > 0 && kg < 500) rows.set(date, Math.round(kg * 100) / 100);
    } else {
      rows.set(date, field === "steps" ? Math.round(parsed) : Math.round(parsed * 10) / 10);
    }
  }

  return { field, rows, nextPageToken: envelope.nextPageToken };
}

async function fetchRollup(type: keyof typeof types, grant: Tokens, from: string, end: string) {
  let pageToken: string | undefined;
  const rows = new Map<string, number>();
  for (let page = 0; page < 10; page++) {
    const response = await fetch(`${googleAPI}/dataTypes/${type}/dataPoints:dailyRollUp`, {
      method: "POST",
      signal: AbortSignal.timeout(9000),
      headers: { Authorization: `Bearer ${grant.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ range: { start: civil(from), end: civil(end) }, windowSizeDays: 1, pageToken }),
    });
    if (!response.ok) throw new NutritionError("Google Health could not retrieve the requested data.", 502);
    const result = parseGoogleRollup(type, await response.json());
    for (const [day, value] of result.rows) if (day >= from && day < end) rows.set(day, value);
    pageToken = result.nextPageToken;
    if (!pageToken) return { field: result.field, rows };
  }
  throw new NutritionError("Google returned too many pages for one sync.", 502);
}

async function fetchLatestHeightCm(grant: Tokens): Promise<number | null> {
  if (!grant.scopes.includes(measurementsScope)) return null;
  try {
    const response = await fetch(`${googleAPI}/dataTypes/height/dataPoints?pageSize=5`, {
      headers: { Authorization: `Bearer ${grant.accessToken}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      dataPoints?: { height?: { heightMillimeters?: number; millimeters?: number } }[];
    };
    for (const point of data.dataPoints ?? []) {
      const mm = point.height?.heightMillimeters ?? point.height?.millimeters;
      if (typeof mm === "number" && Number.isFinite(mm) && mm > 500 && mm < 3000) {
        return Math.round((mm / 10) * 10) / 10;
      }
    }
    return null;
  } catch {
    return null;
  }
}

const own = (userId: string) => and(eq(healthIntegration.userId, userId), eq(healthIntegration.provider, "google"));

type SleepStageType = "AWAKE" | "LIGHT" | "DEEP" | "REM";

export interface ParsedSleepSession {
  day: string;
  sessionId: string | null;
  sleepStart: string | null;
  sleepEnd: string | null;
  minutesAsleep: number;
  minutesAwake: number | null;
  deepMinutes: number | null;
  remMinutes: number | null;
  lightMinutes: number | null;
  stagesJson: { stage: SleepStageType; minutes: number }[];
}

function formatCivilDate(d?: { year?: number; month?: number; day?: number } | null): string | null {
  if (!d || typeof d.year !== "number" || typeof d.month !== "number" || typeof d.day !== "number") return null;
  const candidate = [d.year, String(d.month).padStart(2, "0"), String(d.day).padStart(2, "0")].join("-");
  return z.iso.date().safeParse(candidate).success ? candidate : null;
}

export function parseGoogleSleep(payload: unknown, timezone = DEFAULT_TIMEZONE): {
  sessions: Map<string, ParsedSleepSession>;
  nextPageToken?: string;
} {
  const envelope = z
    .object({
      dataPoints: z.array(z.unknown()).default([]),
      nextPageToken: z.string().optional(),
    })
    .parse(payload);

  const sessions = new Map<string, ParsedSleepSession>();

  for (const raw of envelope.dataPoints) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const sleepObj = (item.sleep ?? item) as Record<string, unknown> | undefined;
    if (!sleepObj || typeof sleepObj !== "object") continue;

    const interval = (sleepObj.interval ?? {}) as Record<string, unknown>;
    const startTimeRaw = typeof interval.startTime === "string" ? interval.startTime : null;
    const endTimeRaw = typeof interval.endTime === "string" ? interval.endTime : null;
    const civilEnd = (interval.civilEndTime as { date?: { year?: number; month?: number; day?: number } } | undefined)?.date;
    const day =
      formatCivilDate(civilEnd) ??
      (endTimeRaw && !Number.isNaN(new Date(endTimeRaw).getTime()) ? localDay(endTimeRaw, timezone) : null);
    if (!day) continue;

    const summary = (sleepObj.summary ?? sleepObj) as Record<string, unknown>;
    const rawStages = Array.isArray(summary.stagesSummary)
      ? summary.stagesSummary
      : Array.isArray(sleepObj.stagesSummary)
        ? sleepObj.stagesSummary
        : [];

    const stageMap = new Map<SleepStageType, number>();
    for (const stRaw of rawStages) {
      if (!stRaw || typeof stRaw !== "object") continue;
      const stObj = stRaw as Record<string, unknown>;
      const stageName = String(stObj.stage ?? "").toUpperCase();
      if (stageName !== "AWAKE" && stageName !== "LIGHT" && stageName !== "DEEP" && stageName !== "REM") continue;
      const mins = Number(stObj.minutes ?? (typeof stObj.durationSeconds === "number" ? Math.round(stObj.durationSeconds / 60) : NaN));
      if (!Number.isFinite(mins) || mins < 0 || mins > 1440) continue;
      const rounded = Math.round(mins);
      // Deduplicate stage summary entries cleanly instead of summing repeated enums.
      const prev = stageMap.get(stageName);
      if (prev == null || rounded > prev) stageMap.set(stageName, rounded);
    }

    const deepMinutes = stageMap.get("DEEP") ?? null;
    const remMinutes = stageMap.get("REM") ?? null;
    const lightMinutes = stageMap.get("LIGHT") ?? null;
    const minutesAwakeRaw = summary.minutesAwake != null ? Number(summary.minutesAwake) : stageMap.get("AWAKE") ?? null;
    const minutesAwake = minutesAwakeRaw != null && Number.isFinite(minutesAwakeRaw) && minutesAwakeRaw >= 0 ? Math.round(minutesAwakeRaw) : null;

    let minutesAsleep = summary.minutesAsleep != null ? Number(summary.minutesAsleep) : NaN;
    if (!Number.isFinite(minutesAsleep)) {
      const stageAsleep = (deepMinutes ?? 0) + (remMinutes ?? 0) + (lightMinutes ?? 0);
      if (stageAsleep > 0) {
        minutesAsleep = stageAsleep;
      } else if (startTimeRaw && endTimeRaw) {
        const diffMin = Math.round((new Date(endTimeRaw).getTime() - new Date(startTimeRaw).getTime()) / 60000);
        if (Number.isFinite(diffMin) && diffMin > 0) {
          minutesAsleep = Math.max(0, diffMin - (minutesAwake ?? 0));
        }
      }
    }

    if (!Number.isFinite(minutesAsleep) || minutesAsleep < 90 || minutesAsleep > 1440) continue;

    const sleepStart = startTimeRaw && !Number.isNaN(new Date(startTimeRaw).getTime()) ? new Date(startTimeRaw).toISOString() : null;
    const sleepEnd = endTimeRaw && !Number.isNaN(new Date(endTimeRaw).getTime()) ? new Date(endTimeRaw).toISOString() : null;
    const sessionId = typeof item.name === "string" ? item.name.split("/").at(-1)?.slice(0, 160) ?? null : null;
    const stagesJson = (["DEEP", "REM", "LIGHT", "AWAKE"] as const)
      .filter((s) => stageMap.has(s))
      .map((s) => ({ stage: s, minutes: stageMap.get(s)! }));

    const parsed: ParsedSleepSession = {
      day,
      sessionId,
      sleepStart,
      sleepEnd,
      minutesAsleep: Math.round(minutesAsleep),
      minutesAwake,
      deepMinutes,
      remMinutes,
      lightMinutes,
      stagesJson,
    };

    const existing = sessions.get(day);
    if (!existing || parsed.minutesAsleep > existing.minutesAsleep) {
      sessions.set(day, parsed);
    }
  }

  return { sessions, nextPageToken: envelope.nextPageToken };
}

export async function fetchSleepSessions(grant: Tokens, from: string, endExclusive: string, timezone = DEFAULT_TIMEZONE) {
  let pageToken: string | undefined;
  const merged = new Map<string, ParsedSleepSession>();
  const filter = `sleep.interval.civil_end_time >= "${from}T00:00:00" AND sleep.interval.civil_end_time < "${endExclusive}T00:00:00"`;

  for (let page = 0; page < 10; page++) {
    const url = new URL(`${googleAPI}/dataTypes/sleep/dataPoints:reconcile`);
    url.searchParams.set("filter", filter);
    url.searchParams.set("pageSize", "25");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${grant.accessToken}` },
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });
    if (!response.ok) throw new NutritionError("Google Health could not retrieve sleep data.", 502);
    const parsed = parseGoogleSleep(await response.json(), timezone);
    for (const [day, s] of parsed.sessions) {
      if (day < from || day >= endExclusive) continue;
      const prev = merged.get(day);
      if (!prev || s.minutesAsleep > prev.minutesAsleep) merged.set(day, s);
    }
    pageToken = parsed.nextPageToken;
    if (!pageToken) return merged;
  }
  throw new NutritionError("Google returned too many sleep pages for one sync.", 502);
}

export async function googleStatus(db: AuthDatabase, userId: string) {
  const [row] = await db
    .select({
      status: healthIntegration.status,
      accountLabel: healthIntegration.accountLabel,
      lastSync: healthIntegration.lastSync,
      lastError: healthIntegration.lastError,
      credential: healthIntegration.credential,
    })
    .from(healthIntegration)
    .where(own(userId));

  let scopes: string[] = [];
  if (row?.credential) {
    try {
      scopes = tokens.parse(unseal(row.credential, userId)).scopes;
    } catch {
      scopes = [];
    }
  }

  const jobs = await db.select({ state: googleMealSync.state, lastError: googleMealSync.lastError }).from(googleMealSync).where(eq(googleMealSync.userId, userId));
  return {
    mealSync: { pending: jobs.filter((job) => job.state === "pending").length, failed: jobs.filter((job) => job.state === "error").length, lastError: jobs.find((job) => job.lastError)?.lastError ?? null },
    available: googleConfigured(),
    connected: Boolean(row),
    accountLabel: row?.accountLabel ?? null,
    status: row?.status ?? null,
    lastSync: row?.lastSync?.toISOString() ?? null,
    lastError: row?.lastError ?? null,
    canReadWeights: scopes.includes(measurementsScope),
    canReadSleep: scopes.includes(sleepScope),
    canWriteWeights: scopes.includes(measurementsWriteScope),
    canReadNutrition: scopes.includes(nutritionWriteScope),
    canWriteNutrition: scopes.includes(nutritionWriteScope),
  };
}

export async function getFreshGrant(db: AuthDatabase, userId: string) {
  const [linked] = await db.select().from(healthIntegration).where(own(userId));
  if (!linked) throw new NutritionError("Connect Google Health first.", 409);
  let grant = tokens.parse(unseal(linked.credential, userId));
  let refreshed = false;
  if (grant.expiresAt < Date.now() + 60000) {
    grant = await exchange({ grant_type: "refresh_token", refresh_token: grant.refreshToken }, grant);
    refreshed = true;
  }
  if (refreshed) {
    await db
      .update(healthIntegration)
      .set({ credential: seal(grant, userId) })
      .where(and(own(userId), eq(healthIntegration.credential, linked.credential)));
  }
  return { linked, grant };
}

export async function syncGoogle(db: AuthDatabase, userId: string, from: string, to: string) {
  historyInput.parse({ from, to });
  if (addDays(from, 89) < to) throw new NutritionError("Sync at most 90 days at a time.");
  const [linked] = await db.select().from(healthIntegration).where(own(userId));
  if (!linked) throw new NutritionError("Connect Google Health first.", 409);

  try {
    let grant = tokens.parse(unseal(linked.credential, userId));
    if (grant.expiresAt < Date.now() + 60000) {
      grant = await exchange({ grant_type: "refresh_token", refresh_token: grant.refreshToken }, grant);
    }

    const readings = new Map<string, Partial<Record<Field, number>>>();
    const tz = (await nutritionData(db, userId).settings()).timezone;
    const today = localDay(new Date(), tz);
    const through = to < today ? to : today;
    const allowed = (Object.keys(types) as (keyof typeof types)[]).filter(
      (name) => name !== "weight" || grant.scopes.includes(measurementsScope),
    );

    // Chunk into 14-day windows to respect Google Health API total-calories max window.
    for (let start = from; start <= through; start = addDays(start, 14)) {
      const limit = addDays(start, 14);
      const end = limit <= through ? limit : addDays(through, 1);
      for (const { field, rows } of await Promise.all(allowed.map((type) => fetchRollup(type, grant, start, end)))) {
        for (const [day, value] of rows) readings.set(day, { ...readings.get(day), [field]: value });
      }
    }

    const canSleep = grant.scopes.includes(sleepScope);
    const [remoteHeightCm, sleepSessions] = await Promise.all([
      fetchLatestHeightCm(grant),
      canSleep ? fetchSleepSessions(grant, from, addDays(through, 1), tz) : Promise.resolve(new Map<string, ParsedSleepSession>()),
    ]);

    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(healthIntegration).where(own(userId)).for("update");
      if (current?.credential !== linked.credential) {
        throw new NutritionError("The Google connection changed. Retry the sync.", 409);
      }
      await tx
        .delete(dailyEnergy)
        .where(and(eq(dailyEnergy.userId, userId), eq(dailyEnergy.source, "google"), gte(dailyEnergy.day, from), lte(dailyEnergy.day, through)));

      for (const [day, reading] of readings) {
        // Keep active separate from total; never add active onto total.
        const values = {
          ...reading,
          activeKcal: reading.totalKcal != null && reading.activeKcal != null && reading.activeKcal > reading.totalKcal
            ? null
            : reading.activeKcal,
        };
        await tx.insert(dailyEnergy).values({
          userId,
          source: "google",
          ...energyInput.parse({
            day,
            source: "google",
            ...values,
            complete: day < today && values.totalKcal != null,
          }),
        });
        if (values.weightKg != null) {
          await upsertSyncedWeight(tx, userId, day, values.weightKg, "Synced from Google Health");
        }
      }

      if (canSleep) {
        await tx
          .delete(dailySleep)
          .where(and(eq(dailySleep.userId, userId), eq(dailySleep.source, "google"), gte(dailySleep.day, from), lte(dailySleep.day, through)));
        for (const s of sleepSessions.values()) {
          const valid = sleepInput.parse({ ...s, source: "google" });
          await tx.insert(dailySleep).values({
            userId,
            source: "google",
            day: valid.day,
            sessionId: valid.sessionId ?? null,
            sleepStart: valid.sleepStart ? new Date(valid.sleepStart) : null,
            sleepEnd: valid.sleepEnd ? new Date(valid.sleepEnd) : null,
            minutesAsleep: valid.minutesAsleep,
            minutesAwake: valid.minutesAwake ?? null,
            deepMinutes: valid.deepMinutes ?? null,
            remMinutes: valid.remMinutes ?? null,
            lightMinutes: valid.lightMinutes ?? null,
            stagesJson: valid.stagesJson,
            syncedAt: new Date(),
          });
        }
      }

      if (remoteHeightCm != null) {
        const [prof] = await tx.select({ heightCm: profile.heightCm }).from(profile).where(eq(profile.userId, userId));
        if (!prof) {
          await tx.insert(profile).values({ userId, heightCm: remoteHeightCm, units: "metric", goals: "" });
        } else if (prof.heightCm == null) {
          await tx.update(profile).set({ heightCm: remoteHeightCm }).where(eq(profile.userId, userId));
        }
      }

      await tx
        .update(healthIntegration)
        .set({ credential: seal(grant, userId), lastSync: new Date(), status: "connected", lastError: null })
        .where(own(userId));
    });

    return { syncedDays: readings.size, syncedSleepDays: sleepSessions.size, syncedHeight: remoteHeightCm != null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed.";
    await db
      .update(healthIntegration)
      .set({ status: "sync_failed", lastError: message.slice(0, 240) })
      .where(and(own(userId), eq(healthIntegration.credential, linked.credential)));
    throw error;
  }
}

export async function syncGoogleAllUsers(db: AuthDatabase) {
  const connected = await db
    .select({ userId: healthIntegration.userId })
    .from(healthIntegration)
    .where(eq(healthIntegration.provider, "google"));

  for (const row of connected) {
    try {
      const tz = (await nutritionData(db, row.userId).settings()).timezone;
      const today = localDay(new Date(), tz);
      await syncGoogle(db, row.userId, addDays(today, -1), today);
    } catch {
      // Keep failures isolated per user
    }
  }
}

export function buildGoogleWeightDataPoint(input: { weightKg: number; recordedAt: string; note?: string }) {
  return {
    weight: {
      sampleTime: { physicalTime: new Date(input.recordedAt).toISOString() },
      weightGrams: Math.round(input.weightKg * 1000),
      ...(input.note ? { notes: input.note.slice(0, 400) } : {}),
    },
  };
}

function mapCategoryToGoogleMealType(category: MealCategory): string {
  switch (category) {
    case "breakfast":
      return "BREAKFAST";
    case "lunch":
      return "LUNCH";
    case "dinner":
      return "DINNER";
    case "snacks":
    case "drinks":
    default:
      return "SNACK";
  }
}

export function buildGoogleNutritionLogDataPoint(record: {
  name: string;
  category: MealCategory;
  consumedAt: string;
  totals: {
    calories: number | null;
    proteinG: number | null;
    carbsG: number | null;
    fatG: number | null;
    fibreG: number | null;
  };
}) {
  const start = new Date(record.consumedAt);
  const end = new Date(start.getTime() + 15 * 60 * 1000);
  const nutrients: { nutrient: string; quantity: { grams: number } }[] = [];
  if (record.totals.proteinG != null) {
    nutrients.push({ nutrient: "PROTEIN", quantity: { grams: Math.round(record.totals.proteinG * 10) / 10 } });
  }
  if (record.totals.fibreG != null) {
    nutrients.push({ nutrient: "DIETARY_FIBER", quantity: { grams: Math.round(record.totals.fibreG * 10) / 10 } });
  }

  return {
    nutritionLog: {
      interval: {
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      },
      foodDisplayName: record.name.slice(0, 160),
      serving: { amount: 1 },
      mealType: mapCategoryToGoogleMealType(record.category),
      ...(record.totals.calories != null ? { energy: { kcal: Math.round(record.totals.calories) } } : {}),
      ...(record.totals.carbsG != null ? { totalCarbohydrate: { grams: Math.round(record.totals.carbsG * 10) / 10 } } : {}),
      ...(record.totals.fatG != null ? { totalFat: { grams: Math.round(record.totals.fatG * 10) / 10 } } : {}),
      ...(nutrients.length ? { nutrients } : {}),
    },
  };
}

export async function pushWeightToGoogle(
  db: AuthDatabase,
  userId: string,
  input: { weightKg: number; day: string; timezone?: string; note?: string },
) {
  if (!googleConfigured()) return { pushed: false, reason: "not-configured" };
  try {
    const { grant } = await getFreshGrant(db, userId);
    if (!grant.scopes.includes(measurementsWriteScope)) {
      return { pushed: false, reason: "missing-write-scope" };
    }
    const tz = input.timezone ?? DEFAULT_TIMEZONE;
    const recordedAt = resolveLocalDateTime(input.day, "08:00", tz).toISOString();
    const name = `users/me/dataTypes/weight/dataPoints/ft-weight-${input.day}`;
    const headers = { Authorization: `Bearer ${grant.accessToken}`, "Content-Type": "application/json" };
    const lookup = await fetch(`https://health.googleapis.com/v4/${name}`, { headers, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!lookup.ok && lookup.status !== 404) return { pushed: false, reason: `lookup-http-${lookup.status}` };
    const res = await fetch(lookup.ok ? `https://health.googleapis.com/v4/${name}` : `${googleAPI}/dataTypes/weight/dataPoints`, {
      method: lookup.ok ? "PATCH" : "POST", headers,
      body: JSON.stringify({ name, ...buildGoogleWeightDataPoint({ weightKg: input.weightKg, recordedAt, note: input.note }) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { pushed: false, reason: `http-${res.status}` };
    const operation = await res.json();
    if (operation.error) return { pushed: false, reason: "operation-failed" };
    if (!operation.done) return { pushed: false, reason: "operation-pending" };
    return { pushed: operation.response?.name?.split("/").at(-1) === name.split("/").at(-1) };

  } catch {
    return { pushed: false, reason: "request-failed" };
  }
}

export async function pushMealToGoogle(db: AuthDatabase, userId: string, record: MealRecord) {
  const { queueGoogleMeal } = await import("./google-sync-queue");
  return { queued: await queueGoogleMeal(db, userId, record.id, "upsert", true) };
}
export async function pushPendingToGoogle(db: AuthDatabase, userId: string, from: string, to: string) {
  historyInput.parse({ from, to });
  const { grant } = await getFreshGrant(db, userId);
  if (!grant.scopes.includes(nutritionWriteScope)) throw new NutritionError("Reconnect Google Health and grant meal write permission.", 403);
  const { queueGoogleMeal } = await import("./google-sync-queue");
  const rows = await db.select({ id: meal.id }).from(meal).where(and(eq(meal.userId, userId), gte(meal.localDay, from), lte(meal.localDay, to)));
  for (const row of rows) await queueGoogleMeal(db, userId, row.id, "upsert", true);
  return { mealsQueued: rows.length, mealsPushed: 0, weightsPushed: 0 };
}

function normalizeDateString(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Support MM/DD/YY or MM/DD/YYYY (common in Fitbit exports) or DD/MM/YYYY if first > 12
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const yRaw = Number(slash[3]);
    const year = yRaw < 100 ? 2000 + yRaw : yRaw;
    const [month, day] = a > 12 ? [b, a] : [a, b];
    const candidate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return z.iso.date().safeParse(candidate).success ? candidate : null;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

export function parseSavedHealthImport(rawText: string, timezone = DEFAULT_TIMEZONE) {
  const trimmed = rawText.trim();
  if (!trimmed) throw new NutritionError("Paste or upload saved JSON or CSV health data.");

  const byDay = new Map<
    string,
    {
      day: string;
      source: "google" | "apple" | "manual";
      totalKcal?: number | null;
      activeKcal?: number | null;
      steps?: number | null;
      weightKg?: number | null;
      complete?: boolean;
    }
  >();
  let heightCm: number | null = null;
  const sleepMap = new Map<string, ParsedSleepSession>();
  const meals: z.input<typeof energyInput> extends never ? never : {
    day: string;
    time: string;
    name: string;
    category: MealCategory;
    items: {
      name: string;
      amount: number | null;
      unit: "g" | "ml" | "serving";
      calories: number | null;
      proteinG: number | null;
      carbsG: number | null;
      fatG: number | null;
      fibreG: number | null;
      estimationMethod: "pack_label" | "weighed" | "measured" | "recipe" | "photo_estimate";
    }[];
  }[] = [];

  const mergeDay = (
    day: string,
    patch: {
      source?: "google" | "apple" | "manual";
      totalKcal?: number | null;
      activeKcal?: number | null;
      steps?: number | null;
      weightKg?: number | null;
      complete?: boolean;
    },
  ) => {
    const prev = byDay.get(day) ?? { day, source: patch.source ?? "google" };
    byDay.set(day, {
      ...prev,
      ...patch,
      source: patch.source ?? prev.source,
      totalKcal: patch.totalKcal ?? prev.totalKcal,
      activeKcal: patch.activeKcal ?? prev.activeKcal,
      steps: patch.steps ?? prev.steps,
      weightKg: patch.weightKg ?? prev.weightKg,
      complete: patch.complete ?? prev.complete,
    });
  };

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new NutritionError("Invalid JSON file.");
    }

    const ingestPoint = (pt: Record<string, unknown>) => {
      // 0. Saved sleep point (FitnessTrackr export or Google Health v4 dataPoint with .sleep)
      if (pt.sleep && typeof pt.sleep === "object") {
        const parsedSleep = parseGoogleSleep({ dataPoints: [pt] }, timezone);
        for (const [day, s] of parsedSleep.sessions) {
          const prev = sleepMap.get(day);
          if (!prev || s.minutesAsleep > prev.minutesAsleep) sleepMap.set(day, s);
        }
        return;
      }
      if (typeof pt.day === "string" && z.iso.date().safeParse(pt.day).success && typeof pt.minutesAsleep === "number") {
        const validSleep = sleepInput.safeParse({
          day: pt.day,
          source: pt.source === "manual" || pt.source === "apple" ? pt.source : "google",
          sessionId: typeof pt.sessionId === "string" ? pt.sessionId : null,
          sleepStart: typeof pt.sleepStart === "string" ? pt.sleepStart : null,
          sleepEnd: typeof pt.sleepEnd === "string" ? pt.sleepEnd : null,
          minutesAsleep: Math.round(pt.minutesAsleep),
          minutesAwake: typeof pt.minutesAwake === "number" ? Math.round(pt.minutesAwake) : null,
          deepMinutes: typeof pt.deepMinutes === "number" ? Math.round(pt.deepMinutes) : null,
          remMinutes: typeof pt.remMinutes === "number" ? Math.round(pt.remMinutes) : null,
          lightMinutes: typeof pt.lightMinutes === "number" ? Math.round(pt.lightMinutes) : null,
          stagesJson: Array.isArray(pt.stages) ? pt.stages : Array.isArray(pt.stagesJson) ? pt.stagesJson : [],
        });
        if (validSleep.success && validSleep.data.minutesAsleep >= 90) {
          sleepMap.set(pt.day, {
            day: validSleep.data.day,
            sessionId: validSleep.data.sessionId ?? null,
            sleepStart: validSleep.data.sleepStart ?? null,
            sleepEnd: validSleep.data.sleepEnd ?? null,
            minutesAsleep: validSleep.data.minutesAsleep,
            minutesAwake: validSleep.data.minutesAwake ?? null,
            deepMinutes: validSleep.data.deepMinutes ?? null,
            remMinutes: validSleep.data.remMinutes ?? null,
            lightMinutes: validSleep.data.lightMinutes ?? null,
            stagesJson: validSleep.data.stagesJson,
          });
        }
        return;
      }

      // 1. Native app / export array entry
      if (typeof pt.day === "string" && z.iso.date().safeParse(pt.day).success) {
        const src = pt.source === "apple" || pt.source === "manual" ? pt.source : "google";
        mergeDay(pt.day, {
          source: src,
          totalKcal: typeof pt.totalKcal === "number" ? pt.totalKcal : null,
          activeKcal: typeof pt.activeKcal === "number" ? pt.activeKcal : null,
          steps: typeof pt.steps === "number" ? Math.round(pt.steps) : null,
          weightKg: typeof pt.weightKg === "number" ? Math.round(pt.weightKg * 100) / 100 : null,
          complete: typeof pt.complete === "boolean" ? pt.complete : typeof pt.totalKcal === "number",
        });
        return;
      }

      // 2. Google Health v4 rollup point
      const civilDate = (pt.civilStartTime as { date?: { year: number; month: number; day: number } } | undefined)?.date;
      if (civilDate) {
        const day = `${civilDate.year}-${String(civilDate.month).padStart(2, "0")}-${String(civilDate.day).padStart(2, "0")}`;
        const tot = (pt.totalCalories as { kcalSum?: number } | undefined)?.kcalSum;
        const act = (pt.activeEnergyBurned as { kcalSum?: number } | undefined)?.kcalSum;
        const st = (pt.steps as { countSum?: number | string } | undefined)?.countSum;
        const wtObj = pt.weight as { weightGramsAvg?: number; kilogramsAvg?: number } | undefined;
        const wt = wtObj?.weightGramsAvg != null ? wtObj.weightGramsAvg / 1000 : wtObj?.kilogramsAvg;
        mergeDay(day, {
          source: "google",
          totalKcal: tot != null ? Math.round(Number(tot) * 10) / 10 : undefined,
          activeKcal: act != null ? Math.round(Number(act) * 10) / 10 : undefined,
          steps: st != null ? Math.round(Number(st)) : undefined,
          weightKg: wt != null ? Math.round(Number(wt) * 100) / 100 : undefined,
          complete: tot != null,
        });
        return;
      }

      // 3. Google Health v4 raw dataPoint (weight, height, nutritionLog)
      const wtRaw = pt.weight as { sampleTime?: { physicalTime?: string }; weightGrams?: number; kilograms?: number } | undefined;
      if (wtRaw) {
        const kg = wtRaw.weightGrams != null ? wtRaw.weightGrams / 1000 : wtRaw.kilograms;
        const ts = wtRaw.sampleTime?.physicalTime;
        const day = ts ? localDay(ts, timezone) : null;
        if (day && kg != null && kg > 0 && kg < 500) {
          mergeDay(day, { source: "google", weightKg: Math.round(kg * 100) / 100 });
        }
      }
      const htRaw = pt.height as { heightMillimeters?: number; millimeters?: number } | undefined;
      if (htRaw) {
        const mm = htRaw.heightMillimeters ?? htRaw.millimeters;
        if (typeof mm === "number" && mm > 500 && mm < 3000) heightCm = Math.round((mm / 10) * 10) / 10;
      }
      const nut = pt.nutritionLog as {
        interval?: { startTime?: string };
        foodDisplayName?: string;
        mealType?: string;
        energy?: { kcal?: number };
        totalCarbohydrate?: { grams?: number };
        totalFat?: { grams?: number };
        nutrients?: { nutrient?: string; quantity?: { grams?: number } }[];
      } | undefined;
      if (nut?.foodDisplayName && nut.interval?.startTime) {
        const start = new Date(nut.interval.startTime);
        if (!Number.isNaN(start.getTime())) {
          const day = localDay(start, timezone);
          const time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(start);
          const catRaw = (nut.mealType ?? "").toLowerCase();
          const category: MealCategory = catRaw.includes("breakfast")
            ? "breakfast"
            : catRaw.includes("lunch")
              ? "lunch"
              : catRaw.includes("dinner")
                ? "dinner"
                : "snacks";
          const findNutrient = (name: string) => {
            const match = nut.nutrients?.find((n) => n.nutrient?.includes(name));
            return match?.quantity?.grams ?? null;
          };
          meals.push({
            day,
            time,
            name: nut.foodDisplayName.slice(0, 160),
            category,
            items: [
              {
                name: nut.foodDisplayName.slice(0, 160),
                amount: null,
                unit: "serving",
                calories: nut.energy?.kcal ?? null,
                proteinG: findNutrient("PROTEIN"),
                carbsG: nut.totalCarbohydrate?.grams ?? findNutrient("CARBOHYDRATE"),
                fatG: nut.totalFat?.grams ?? findNutrient("FAT"),
                fibreG: findNutrient("FIBER"),
                estimationMethod: "pack_label",
              },
            ],
          });
        }
      }

      // 4. Fitbit Takeout weight/calories/steps/sleep format
      if (typeof pt.date === "string" && typeof pt.weight === "number") {
        const day = normalizeDateString(pt.date);
        if (day) {
          // Fitbit Takeout sometimes stores lbs by default if > 200 or marked
          const kg = pt.unit === "lb" || pt.weight > 260 ? Math.round((pt.weight * 0.45359237) * 100) / 100 : Math.round(pt.weight * 100) / 100;
          mergeDay(day, { source: "google", weightKg: kg });
        }
      } else if (typeof pt.dateOfSleep === "string" && typeof pt.minutesAsleep === "number") {
        const day = normalizeDateString(pt.dateOfSleep);
        if (day && pt.minutesAsleep >= 90) {
          const deep = (pt.levels as { summary?: { deep?: { minutes?: number }; rem?: { minutes?: number }; light?: { minutes?: number } } } | undefined)?.summary?.deep?.minutes;
          const rem = (pt.levels as { summary?: { rem?: { minutes?: number } } } | undefined)?.summary?.rem?.minutes;
          const light = (pt.levels as { summary?: { light?: { minutes?: number } } } | undefined)?.summary?.light?.minutes;
          const valid = sleepInput.safeParse({
            day,
            source: "google",
            sleepStart: typeof pt.startTime === "string" && !Number.isNaN(new Date(pt.startTime).getTime()) ? new Date(pt.startTime).toISOString() : null,
            sleepEnd: typeof pt.endTime === "string" && !Number.isNaN(new Date(pt.endTime).getTime()) ? new Date(pt.endTime).toISOString() : null,
            minutesAsleep: Math.round(pt.minutesAsleep),
            minutesAwake: typeof pt.minutesAwake === "number" ? Math.round(pt.minutesAwake) : null,
            deepMinutes: typeof deep === "number" ? Math.round(deep) : null,
            remMinutes: typeof rem === "number" ? Math.round(rem) : null,
            lightMinutes: typeof light === "number" ? Math.round(light) : null,
          });
          if (valid.success) {
            sleepMap.set(day, {
              day: valid.data.day,
              sessionId: valid.data.sessionId ?? null,
              sleepStart: valid.data.sleepStart ?? null,
              sleepEnd: valid.data.sleepEnd ?? null,
              minutesAsleep: valid.data.minutesAsleep,
              minutesAwake: valid.data.minutesAwake ?? null,
              deepMinutes: valid.data.deepMinutes ?? null,
              remMinutes: valid.data.remMinutes ?? null,
              lightMinutes: valid.data.lightMinutes ?? null,
              stagesJson: valid.data.stagesJson,
            });
          }
        }
      } else if (typeof pt.dateTime === "string" && pt.value != null) {
        const day = normalizeDateString(pt.dateTime);
        const val = Number(pt.value);
        if (day && Number.isFinite(val)) {
          if (val >= 1000 && Number.isInteger(val)) mergeDay(day, { source: "google", steps: val });
          else mergeDay(day, { source: "google", totalKcal: Math.round(val * 10) / 10, complete: true });
        }
      }
    };

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === "object") ingestPoint(item as Record<string, unknown>);
      }
    } else if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.heightCm === "number" && obj.heightCm > 50 && obj.heightCm < 300) {
        heightCm = Math.round(obj.heightCm * 10) / 10;
      }
      for (const keyName of ["dataPoints", "rollupDataPoints", "entries", "dailyEnergy", "dailySleep", "sleep", "sleepLogs", "weight", "calories", "steps"]) {
        if (Array.isArray(obj[keyName])) {
          for (const item of obj[keyName] as unknown[]) {
            if (item && typeof item === "object") ingestPoint(item as Record<string, unknown>);
          }
        }
      }
    }
  } else {
    // Parse CSV (Google Takeout / Fitbit / custom export)
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) throw new NutritionError("CSV file needs a header row and at least one data row.");
    const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
    const col = (...candidates: string[]) => headers.findIndex((h) => candidates.some((c) => h.includes(c)));

    const iDate = col("date", "day", "time");
    const iTotal = col("caloriesburned", "totalcalories", "totalkcal", "tdee", "energy");
    const iActive = col("activitycalories", "activecalories", "activekcal");
    const iSteps = col("steps");
    const iWeight = col("weight");
    const weightInLbs = headers[iWeight]?.includes("lb") || headers[iWeight]?.includes("pound");
    if (iDate === -1) throw new NutritionError("CSV must contain a Date or Day column.");

    for (const line of lines.slice(1)) {
      const cells = splitCsvLine(line);
      const day = normalizeDateString(cells[iDate] ?? "");
      if (!day) continue;
      const numAt = (idx: number) => {
        if (idx === -1 || !cells[idx]) return null;
        const clean = cells[idx].replace(/,/g, "").trim();
        const n = Number(clean);
        return Number.isFinite(n) && n >= 0 ? n : null;
      };
      const totalKcal = numAt(iTotal);
      const activeKcal = numAt(iActive);
      const steps = numAt(iSteps);
      const rawWt = numAt(iWeight);
      const weightKg = rawWt != null && rawWt > 0 ? Math.round((weightInLbs ? rawWt * 0.45359237 : rawWt) * 100) / 100 : null;
      if (totalKcal == null && activeKcal == null && steps == null && weightKg == null) continue;
      mergeDay(day, {
        source: "google",
        totalKcal,
        activeKcal: totalKcal != null && activeKcal != null && activeKcal > totalKcal ? null : activeKcal,
        steps: steps != null ? Math.round(steps) : null,
        weightKg,
        complete: totalKcal != null,
      });
    }
  }

  const energyEntries = [...byDay.values()]
    .slice(0, 365)
    .map((entry) =>
      energyInput.parse({
        day: entry.day,
        source: entry.source,
        totalKcal: entry.totalKcal ?? null,
        activeKcal: entry.activeKcal ?? null,
        steps: entry.steps ?? null,
        weightKg: entry.weightKg ?? null,
        complete: entry.complete ?? entry.totalKcal != null,
      }),
    );

  const sleepEntries = [...sleepMap.values()]
    .slice(0, 365)
    .map((s) => sleepInput.parse({ ...s, source: "google" }));

  if (energyEntries.length === 0 && sleepEntries.length === 0 && meals.length === 0 && heightCm == null) {
    throw new NutritionError("No valid energy, sleep, weight, height, or meal records found in that file.");
  }

  return { energyEntries, sleepEntries, heightCm, meals };
}

export async function disconnectGoogle(db: AuthDatabase, userId: string) {
  const [row] = await db.transaction(async (tx) => {
    const removed = await tx
      .delete(healthIntegration)
      .where(own(userId))
      .returning({ credential: healthIntegration.credential });
    await tx.delete(dailyEnergy).where(and(eq(dailyEnergy.userId, userId), eq(dailyEnergy.source, "google")));
    await tx.delete(dailySleep).where(and(eq(dailySleep.userId, userId), eq(dailySleep.source, "google")));
    await tx.delete(googleMealSync).where(eq(googleMealSync.userId, userId));
    await tx.update(meal).set({ googleDatapointName: null }).where(eq(meal.userId, userId));
    return removed;
  });

  if (!row) return { removed: true, revoked: true };
  try {
    const grant = tokens.parse(unseal(row.credential, userId));
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      body: new URLSearchParams({ token: grant.refreshToken || grant.accessToken }),
      signal: AbortSignal.timeout(8000),
    });
    return { removed: true, revoked: response.ok };
  } catch {
    return { removed: true, revoked: false };
  }
}
