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
  recoveryInput,
  resolveLocalDateTime,
  sleepInput,
  workoutInput,
  type MealCategory,
} from "./nutrition-model";
import {
  dailyEnergy,
  dailyRecovery,
  dailySleep,
  dailyWorkout,
  googleMealSync,
  healthIntegration,
  meal,
  nutritionPreference,
  profile,
} from "./schema";

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
    await tx
      .insert(nutritionPreference)
      .values({
        userId,
        timezone: DEFAULT_TIMEZONE,
        trackingMode: "fitbit",
        preferredEnergySource: "google",
        googleTwoWaySync: false,
        sleepRolloverEnabled: true,
      })
      .onConflictDoUpdate({
        target: nutritionPreference.userId,
        set: {
          trackingMode: "fitbit",
          preferredEnergySource: "google",
        },
      });
    await tx.delete(googleMealSync).where(eq(googleMealSync.userId, userId));
    await tx.update(meal).set({ googleDatapointName: null }).where(eq(meal.userId, userId));
    // Replacing a connection clears prior Google energy, sleep, recovery & workout rows so two accounts never mix.
    await tx.delete(dailyEnergy).where(and(eq(dailyEnergy.userId, userId), eq(dailyEnergy.source, "google")));
    await tx.delete(dailySleep).where(and(eq(dailySleep.userId, userId), eq(dailySleep.source, "google")));
    await tx.delete(dailyRecovery).where(and(eq(dailyRecovery.userId, userId), eq(dailyRecovery.source, "google")));
    await tx.delete(dailyWorkout).where(and(eq(dailyWorkout.userId, userId), eq(dailyWorkout.source, "google")));
  });
}

type Field =
  | "totalKcal"
  | "activeKcal"
  | "steps"
  | "weightKg"
  | "activeZoneMinutes"
  | "distanceMeters"
  | "floors";

const types = {
  "total-calories": ["totalKcal", "totalCalories", "kcalSum"],
  "active-energy-burned": ["activeKcal", "activeEnergyBurned", "kcalSum"],
  steps: ["steps", "steps", "countSum"],
  weight: ["weightKg", "weight", "weightGramsAvg"],
  "active-zone-minutes": ["activeZoneMinutes", "activeZoneMinutes", "minutesSum"],
  distance: ["distanceMeters", "distance", "metersSum"],
  floors: ["floors", "floors", "countSum"],
} as const;

export type RollupType = keyof typeof types;

const coreRollupTypes = ["total-calories", "active-energy-burned", "steps", "weight"] as const;
const optionalRollupTypes = ["active-zone-minutes", "distance", "floors"] as const;

function civil(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return { date: { year, month, day: date } };
}

export function parseGoogleRollup(type: RollupType, payload: unknown) {
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
    let rawVal: unknown = sectionObj?.[name];
    let fromMillimeters = false;

    if (type === "active-zone-minutes" && rawVal == null) {
      rawVal =
        sectionObj?.activeZoneMinutesSum ??
        sectionObj?.countSum ??
        sectionObj?.totalMinutes ??
        sectionObj?.activeZoneMinutes;
    } else if (type === "distance" && rawVal == null && sectionObj?.millimetersSum != null) {
      rawVal = sectionObj.millimetersSum;
      fromMillimeters = true;
    } else if (type === "floors" && rawVal == null) {
      rawVal = sectionObj?.floorsSum ?? sectionObj?.count;
    }

    const fallbackKg = type === "weight" && rawVal == null ? sectionObj?.kilogramsAvg : undefined;
    const value = rawVal ?? fallbackKg;
    if (value == null || value === "") continue;
    const parsed = z.number().nonnegative().parse(typeof value === "string" ? Number(value) : value);
    if (field === "weightKg") {
      const kg = fallbackKg != null ? parsed : parsed / 1000;
      if (kg > 0 && kg < 500) rows.set(date, Math.round(kg * 100) / 100);
    } else if (field === "distanceMeters") {
      const meters = fromMillimeters ? parsed / 1000 : parsed;
      rows.set(date, Math.round(meters * 10) / 10);
    } else if (field === "steps" || field === "activeZoneMinutes" || field === "floors") {
      rows.set(date, Math.round(parsed));
    } else {
      rows.set(date, Math.round(parsed * 10) / 10);
    }
  }

  return { field, rows, nextPageToken: envelope.nextPageToken };
}

async function fetchRollup(type: RollupType, grant: Tokens, from: string, end: string) {
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

export type RecoveryField =
  | "restingHrBpm"
  | "hrvRmssdMs"
  | "spo2Pct"
  | "respiratoryRate"
  | "skinTempDeltaC"
  | "vo2Max"
  | "bodyFatPct";

const recoveryTypes = {
  "daily-resting-heart-rate": {
    field: "restingHrBpm" as const,
    sections: ["dailyRestingHeartRate", "restingHeartRate"],
    keys: ["beatsPerMinute", "beatsPerMinuteAvg", "bpmAvg", "bpm", "restingHrBpm", "value"],
    min: 0.1,
    max: 300,
  },
  "daily-heart-rate-variability": {
    field: "hrvRmssdMs" as const,
    sections: ["dailyHeartRateVariability", "heartRateVariability"],
    keys: [
      "rmssdMilliseconds",
      "rootMeanSquareOfSuccessiveDifferencesMilliseconds",
      "rmssdMsAvg",
      "rmssdMs",
      "hrvRmssdMs",
      "value",
    ],
    min: 0,
    max: 1000,
  },
  "daily-oxygen-saturation": {
    field: "spo2Pct" as const,
    sections: ["dailyOxygenSaturation", "oxygenSaturation"],
    keys: ["percentageAvg", "averagePercentage", "percentage", "spo2Pct", "value"],
    min: 0,
    max: 100,
  },
  "daily-respiratory-rate": {
    field: "respiratoryRate" as const,
    sections: ["dailyRespiratoryRate", "respiratoryRate"],
    keys: ["breathsPerMinute", "breathsPerMinuteAvg", "respiratoryRate", "value"],
    min: 0.1,
    max: 120,
  },
  "daily-sleep-temperature-derivations": {
    field: "skinTempDeltaC" as const,
    sections: ["dailySleepTemperatureDerivations", "sleepTemperatureDerivations", "skinTemperatureDerivation"],
    keys: [
      "nightlyTemperatureCelsiusDelta",
      "relativeNighttimeTemperatureCelsius",
      "skinTemperatureDeltaCelsius",
      "deltaCelsius",
      "skinTempDeltaC",
      "value",
    ],
    min: -20,
    max: 20,
  },
  "daily-vo2-max": {
    field: "vo2Max" as const,
    sections: ["dailyVo2Max", "vo2Max"],
    keys: ["vo2Max", "mlPerKgPerMin", "vo2MaxAvg", "value"],
    min: 0.1,
    max: 150,
  },
  "body-fat": {
    field: "bodyFatPct" as const,
    sections: ["bodyFat"],
    keys: ["percentage", "percentageAvg", "bodyFatPct", "value"],
    min: 0.1,
    max: 100,
  },
} as const;

export type RecoveryType = keyof typeof recoveryTypes;

function formatCivilDate(d?: { year?: number; month?: number; day?: number } | null): string | null {
  if (!d || typeof d.year !== "number" || typeof d.month !== "number" || typeof d.day !== "number") return null;
  const candidate = [d.year, String(d.month).padStart(2, "0"), String(d.day).padStart(2, "0")].join("-");
  return z.iso.date().safeParse(candidate).success ? candidate : null;
}

function extractPointDay(
  item: Record<string, unknown>,
  sectionObj: Record<string, unknown> | undefined,
  timezone = DEFAULT_TIMEZONE,
): string | null {
  const civilCandidates = [
    (item.civilStartTime as { date?: { year?: number; month?: number; day?: number } } | undefined)?.date,
    (item.civilEndTime as { date?: { year?: number; month?: number; day?: number } } | undefined)?.date,
    sectionObj?.date as { year?: number; month?: number; day?: number } | undefined,
    (sectionObj?.civilStartTime as { date?: { year?: number; month?: number; day?: number } } | undefined)?.date,
    (sectionObj?.civilEndTime as { date?: { year?: number; month?: number; day?: number } } | undefined)?.date,
    ((sectionObj?.interval as Record<string, unknown> | undefined)?.civilStartTime as { date?: { year?: number; month?: number; day?: number } } | undefined)?.date,
    ((sectionObj?.interval as Record<string, unknown> | undefined)?.civilEndTime as { date?: { year?: number; month?: number; day?: number } } | undefined)?.date,
    ((sectionObj?.sampleTime as Record<string, unknown> | undefined)?.civilTime as { date?: { year?: number; month?: number; day?: number } } | undefined)?.date,
    ((item.sampleTime as Record<string, unknown> | undefined)?.civilTime as { date?: { year?: number; month?: number; day?: number } } | undefined)?.date,
    item.date as { year?: number; month?: number; day?: number } | undefined,
  ];
  for (const c of civilCandidates) {
    const formatted = formatCivilDate(c);
    if (formatted) return formatted;
  }
  for (const strCandidate of [sectionObj?.day, item.day, sectionObj?.date, item.date]) {
    if (typeof strCandidate === "string" && z.iso.date().safeParse(strCandidate).success) {
      return strCandidate;
    }
  }
  const tsCandidates = [
    (sectionObj?.sampleTime as { physicalTime?: string } | undefined)?.physicalTime,
    (item.sampleTime as { physicalTime?: string } | undefined)?.physicalTime,
    (sectionObj?.interval as { endTime?: string; startTime?: string } | undefined)?.endTime,
    (sectionObj?.interval as { startTime?: string } | undefined)?.startTime,
    (item.interval as { endTime?: string; startTime?: string } | undefined)?.endTime,
    (item.interval as { startTime?: string } | undefined)?.startTime,
  ];
  for (const ts of tsCandidates) {
    if (typeof ts === "string" && !Number.isNaN(new Date(ts).getTime())) {
      return localDay(ts, timezone);
    }
  }
  return null;
}

export function parseGoogleRecovery(type: RecoveryType, payload: unknown, timezone = DEFAULT_TIMEZONE) {
  const spec = recoveryTypes[type];
  const envelope = z
    .object({
      dataPoints: z.array(z.unknown()).default([]),
      rollupDataPoints: z.array(z.unknown()).default([]),
      nextPageToken: z.string().optional(),
    })
    .parse(payload);

  const rows = new Map<string, number>();
  const points = [...envelope.rollupDataPoints, ...envelope.dataPoints];

  for (const raw of points) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    let sectionObj: Record<string, unknown> | undefined;
    for (const sec of spec.sections) {
      if (item[sec] && typeof item[sec] === "object") {
        sectionObj = item[sec] as Record<string, unknown>;
        break;
      }
    }
    const day = extractPointDay(item, sectionObj, timezone);
    if (!day) continue;

    let rawVal: unknown;
    for (const k of spec.keys) {
      if (sectionObj && sectionObj[k] != null && sectionObj[k] !== "") {
        rawVal = sectionObj[k];
        break;
      }
      if (item[k] != null && item[k] !== "" && typeof item[k] !== "object") {
        rawVal = item[k];
        break;
      }
    }
    if (rawVal == null || rawVal === "") continue;
    const num = typeof rawVal === "string" ? Number(rawVal) : typeof rawVal === "number" ? rawVal : NaN;
    if (!Number.isFinite(num) || num < spec.min || num > spec.max) continue;
    rows.set(day, Math.round(num * 10) / 10);
  }

  return { field: spec.field, rows, nextPageToken: envelope.nextPageToken };
}

async function fetchRecoveryMetric(
  type: RecoveryType,
  grant: Tokens,
  from: string,
  endExclusive: string,
  timezone = DEFAULT_TIMEZONE,
) {
  let pageToken: string | undefined;
  const rows = new Map<string, number>();
  const filter = `date >= "${from}" AND date < "${endExclusive}"`;

  for (let page = 0; page < 10; page++) {
    const url = new URL(`${googleAPI}/dataTypes/${type}/dataPoints:reconcile`);
    url.searchParams.set("filter", filter);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${grant.accessToken}` },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!response.ok) throw new NutritionError(`Google Health could not retrieve ${type}.`, 502);
    const parsed = parseGoogleRecovery(type, await response.json(), timezone);
    for (const [day, value] of parsed.rows) {
      if (day >= from && day < endExclusive) rows.set(day, value);
    }
    pageToken = parsed.nextPageToken;
    if (!pageToken) return { field: parsed.field, rows };
  }
  return { field: recoveryTypes[type].field, rows };
}

export interface ParsedWorkout {
  day: string;
  sessionId: string;
  title: string;
  exerciseType: string;
  startTime: string | null;
  endTime: string | null;
  durationSeconds: number | null;
  caloriesKcal: number | null;
  distanceMeters: number | null;
  avgHrBpm: number | null;
  activeZoneMinutes: number | null;
}

function humanizeExerciseType(rawType: string): string {
  const cleaned = rawType
    .replace(/^EXERCISE_TYPE_/i, "")
    .replace(/_/g, " ")
    .trim()
    .toLowerCase();
  if (!cleaned) return "Workout";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function parseGoogleWorkouts(payload: unknown, timezone = DEFAULT_TIMEZONE): {
  workouts: ParsedWorkout[];
  nextPageToken?: string;
} {
  const rawList: unknown[] = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object"
      ? [
          ...(Array.isArray((payload as Record<string, unknown>).dataPoints)
            ? ((payload as Record<string, unknown>).dataPoints as unknown[])
            : []),
          ...(Array.isArray((payload as Record<string, unknown>).workouts)
            ? ((payload as Record<string, unknown>).workouts as unknown[])
            : []),
          ...(Array.isArray((payload as Record<string, unknown>).exercises)
            ? ((payload as Record<string, unknown>).exercises as unknown[])
            : []),
        ]
      : [];
  const nextPageToken =
    payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).nextPageToken === "string"
      ? ((payload as Record<string, unknown>).nextPageToken as string)
      : undefined;

  const bySession = new Map<string, ParsedWorkout>();

  for (const raw of rawList) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const ex = (item.exercise && typeof item.exercise === "object" ? item.exercise : item) as Record<string, unknown>;
    const interval = (ex.interval && typeof ex.interval === "object" ? ex.interval : item.interval && typeof item.interval === "object" ? item.interval : {}) as Record<string, unknown>;

    const startTimeRaw =
      typeof interval.startTime === "string"
        ? interval.startTime
        : typeof ex.startTime === "string"
          ? ex.startTime
          : typeof ex.originalStartTime === "string"
            ? ex.originalStartTime
            : null;
    const endTimeRaw =
      typeof interval.endTime === "string"
        ? interval.endTime
        : typeof ex.endTime === "string"
          ? ex.endTime
          : null;

    const startTime =
      startTimeRaw && !Number.isNaN(new Date(startTimeRaw).getTime()) ? new Date(startTimeRaw).toISOString() : null;
    const endTime =
      endTimeRaw && !Number.isNaN(new Date(endTimeRaw).getTime()) ? new Date(endTimeRaw).toISOString() : null;

    const day =
      extractPointDay(item, ex, timezone) ??
      (startTime ? localDay(startTime, timezone) : endTime ? localDay(endTime, timezone) : null);
    if (!day) continue;

    const exerciseType =
      typeof ex.exerciseType === "string"
        ? ex.exerciseType.trim().slice(0, 120)
        : typeof ex.activityType === "string"
          ? ex.activityType.trim().slice(0, 120)
          : "";
    const rawTitle =
      typeof ex.displayName === "string" && ex.displayName.trim()
        ? ex.displayName.trim()
        : typeof ex.title === "string" && ex.title.trim()
          ? ex.title.trim()
          : typeof ex.activityName === "string" && ex.activityName.trim()
            ? ex.activityName.trim()
            : exerciseType
              ? humanizeExerciseType(exerciseType)
              : "Workout";
    const title = rawTitle.slice(0, 200);

    const sessionIdRaw =
      typeof ex.sessionId === "string" && ex.sessionId.trim()
        ? ex.sessionId.trim()
        : typeof item.sessionId === "string" && item.sessionId.trim()
          ? item.sessionId.trim()
          : typeof item.name === "string" && item.name.trim()
            ? item.name.split("/").at(-1)?.trim() ?? ""
            : typeof ex.logId === "number" || typeof ex.logId === "string"
              ? String(ex.logId)
              : "";
    const sessionId = (
      sessionIdRaw ||
      createHash("sha256")
        .update(`${day}|${startTime ?? ""}|${title}|${exerciseType}`)
        .digest("hex")
        .slice(0, 24)
    ).slice(0, 200);

    const metrics = (
      ex.metricsSummary && typeof ex.metricsSummary === "object"
        ? ex.metricsSummary
        : ex.summary && typeof ex.summary === "object"
          ? ex.summary
          : ex
    ) as Record<string, unknown>;

    let durationSeconds: number | null = null;
    const rawDurSec =
      metrics.durationSeconds ??
      ex.durationSeconds ??
      (typeof ex.activeDuration === "string" && ex.activeDuration.endsWith("s")
        ? Number.parseFloat(ex.activeDuration)
        : undefined) ??
      (typeof metrics.activeDuration === "string" && metrics.activeDuration.endsWith("s")
        ? Number.parseFloat(metrics.activeDuration)
        : undefined) ??
      (typeof ex.activeDuration === "number" ? Math.round(ex.activeDuration / 1000) : undefined) ??
      (typeof ex.duration === "number" ? Math.round(ex.duration / 1000) : undefined) ??
      (typeof ex.durationMinutes === "number" ? Math.round(ex.durationMinutes * 60) : undefined);
    if (rawDurSec != null && Number.isFinite(Number(rawDurSec)) && Number(rawDurSec) >= 0) {
      durationSeconds = Math.round(Number(rawDurSec));
    } else if (startTime && endTime) {
      const diffSec = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000);
      if (Number.isFinite(diffSec) && diffSec >= 0) durationSeconds = diffSec;
    }

    const rawCal =
      (metrics.caloriesExpended as { kcal?: number } | undefined)?.kcal ??
      (metrics.calories as { kcal?: number } | undefined)?.kcal ??
      metrics.caloriesKcal ??
      ex.caloriesKcal ??
      ex.calories;
    const caloriesKcal =
      rawCal != null && Number.isFinite(Number(rawCal)) && Number(rawCal) >= 0
        ? Math.round(Number(rawCal) * 10) / 10
        : null;

    const distObj = metrics.distance as { meters?: number; millimeters?: number } | undefined;
    const rawDist =
      distObj?.meters ??
      (distObj?.millimeters != null ? Number(distObj.millimeters) / 1000 : undefined) ??
      metrics.distanceMeters ??
      ex.distanceMeters ??
      (typeof ex.distance === "number" ? ex.distance : undefined);
    const distanceMeters =
      rawDist != null && Number.isFinite(Number(rawDist)) && Number(rawDist) >= 0
        ? Math.round(Number(rawDist) * 10) / 10
        : null;

    const rawHr =
      (metrics.averageHeartRate as { beatsPerMinute?: number } | undefined)?.beatsPerMinute ??
      (metrics.heartRate as { beatsPerMinuteAvg?: number; beatsPerMinute?: number } | undefined)?.beatsPerMinuteAvg ??
      (metrics.heartRate as { beatsPerMinute?: number } | undefined)?.beatsPerMinute ??
      metrics.averageHeartRateBpm ??
      metrics.avgHrBpm ??
      ex.averageHeartRateBpm ??
      ex.avgHrBpm ??
      ex.averageHeartRate;
    const avgHrBpm =
      rawHr != null && Number.isFinite(Number(rawHr)) && Number(rawHr) > 0
        ? Math.round(Number(rawHr) * 10) / 10
        : null;

    const azmObj = metrics.activeZoneMinutes as
      | number
      | { minutesSum?: number; activeZoneMinutes?: number; totalMinutes?: number }
      | undefined;
    const rawAzm =
      typeof azmObj === "number"
        ? azmObj
        : azmObj?.minutesSum ??
          azmObj?.activeZoneMinutes ??
          azmObj?.totalMinutes ??
          (typeof ex.activeZoneMinutes === "number" ? ex.activeZoneMinutes : undefined);
    const activeZoneMinutes =
      rawAzm != null && Number.isFinite(Number(rawAzm)) && Number(rawAzm) >= 0 ? Math.round(Number(rawAzm)) : null;

    const valid = workoutInput.safeParse({
      day,
      source: "google",
      sessionId,
      title,
      exerciseType,
      startTime,
      endTime,
      durationSeconds,
      caloriesKcal,
      distanceMeters,
      avgHrBpm,
      activeZoneMinutes,
    });
    if (valid.success) {
      bySession.set(sessionId, {
        day: valid.data.day,
        sessionId: valid.data.sessionId,
        title: valid.data.title,
        exerciseType: valid.data.exerciseType,
        startTime: valid.data.startTime ?? null,
        endTime: valid.data.endTime ?? null,
        durationSeconds: valid.data.durationSeconds ?? null,
        caloriesKcal: valid.data.caloriesKcal ?? null,
        distanceMeters: valid.data.distanceMeters ?? null,
        avgHrBpm: valid.data.avgHrBpm ?? null,
        activeZoneMinutes: valid.data.activeZoneMinutes ?? null,
      });
    }
  }

  return { workouts: [...bySession.values()], nextPageToken };
}

export async function fetchExerciseSessions(
  grant: Tokens,
  from: string,
  endExclusive: string,
  timezone = DEFAULT_TIMEZONE,
) {
  let pageToken: string | undefined;
  const bySession = new Map<string, ParsedWorkout>();
  const filter = `exercise.interval.civil_start_time >= "${from}T00:00:00" AND exercise.interval.civil_start_time < "${endExclusive}T00:00:00"`;

  for (let page = 0; page < 10; page++) {
    const url = new URL(`${googleAPI}/dataTypes/exercise/dataPoints:reconcile`);
    url.searchParams.set("filter", filter);
    url.searchParams.set("pageSize", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${grant.accessToken}` },
      signal: AbortSignal.timeout(9000),
      cache: "no-store",
    });
    if (!response.ok) throw new NutritionError("Google Health could not retrieve exercise data.", 502);
    const parsed = parseGoogleWorkouts(await response.json(), timezone);
    for (const w of parsed.workouts) {
      if (w.day < from || w.day >= endExclusive) continue;
      bySession.set(w.sessionId, w);
    }
    pageToken = parsed.nextPageToken;
    if (!pageToken) return [...bySession.values()];
  }
  return [...bySession.values()];
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
    const canMeasurements = grant.scopes.includes(measurementsScope);
    const canActivity = grant.scopes.includes(activityScope);
    const allowedCore = coreRollupTypes.filter(
      (name) => name !== "weight" || canMeasurements,
    );

    // Chunk into 14-day windows to respect Google Health API total-calories max window.
    for (let start = from; start <= through; start = addDays(start, 14)) {
      const limit = addDays(start, 14);
      const end = limit <= through ? limit : addDays(through, 1);
      const [coreResults, optionalResults] = await Promise.all([
        Promise.all(allowedCore.map((type) => fetchRollup(type, grant, start, end))),
        canActivity
          ? Promise.all(optionalRollupTypes.map((type) => fetchRollup(type, grant, start, end).catch(() => null)))
          : Promise.resolve([]),
      ]);
      for (const { field, rows } of coreResults) {
        for (const [day, value] of rows) readings.set(day, { ...readings.get(day), [field]: value });
      }
      for (const opt of optionalResults) {
        if (!opt) continue;
        for (const [day, value] of opt.rows) readings.set(day, { ...readings.get(day), [opt.field]: value });
      }
    }

    const canSleep = grant.scopes.includes(sleepScope);
    const endExclusive = addDays(through, 1);
    const recoveryMetricNames = Object.keys(recoveryTypes) as RecoveryType[];

    const [remoteHeightCm, sleepSessions, recoveryResults, workoutSessions] = await Promise.all([
      fetchLatestHeightCm(grant),
      canSleep ? fetchSleepSessions(grant, from, endExclusive, tz) : Promise.resolve(new Map<string, ParsedSleepSession>()),
      canMeasurements
        ? Promise.all(
            recoveryMetricNames.map((type) =>
              fetchRecoveryMetric(type, grant, from, endExclusive, tz).catch(() => null),
            ),
          )
        : Promise.resolve([]),
      canActivity ? fetchExerciseSessions(grant, from, endExclusive, tz).catch(() => null) : Promise.resolve(null),
    ]);

    const recoveryReadings = new Map<string, Partial<Record<RecoveryField, number>>>();
    for (const res of recoveryResults) {
      if (!res) continue;
      for (const [day, value] of res.rows) {
        recoveryReadings.set(day, { ...recoveryReadings.get(day), [res.field]: value });
      }
    }

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

      if (canMeasurements) {
        await tx
          .delete(dailyRecovery)
          .where(and(eq(dailyRecovery.userId, userId), eq(dailyRecovery.source, "google"), gte(dailyRecovery.day, from), lte(dailyRecovery.day, through)));
        for (const [day, rec] of recoveryReadings) {
          const valid = recoveryInput.parse({ day, source: "google", ...rec });
          await tx.insert(dailyRecovery).values({
            userId,
            source: "google",
            day: valid.day,
            restingHrBpm: valid.restingHrBpm ?? null,
            hrvRmssdMs: valid.hrvRmssdMs ?? null,
            spo2Pct: valid.spo2Pct ?? null,
            respiratoryRate: valid.respiratoryRate ?? null,
            skinTempDeltaC: valid.skinTempDeltaC ?? null,
            vo2Max: valid.vo2Max ?? null,
            bodyFatPct: valid.bodyFatPct ?? null,
            syncedAt: new Date(),
          });
        }
      }

      if (workoutSessions !== null) {
        await tx
          .delete(dailyWorkout)
          .where(and(eq(dailyWorkout.userId, userId), eq(dailyWorkout.source, "google"), gte(dailyWorkout.day, from), lte(dailyWorkout.day, through)));
        for (const w of workoutSessions) {
          const valid = workoutInput.parse({ ...w, source: "google" });
          await tx
            .insert(dailyWorkout)
            .values({
              userId,
              source: "google",
              sessionId: valid.sessionId,
              day: valid.day,
              title: valid.title,
              exerciseType: valid.exerciseType,
              startTime: valid.startTime ? new Date(valid.startTime) : null,
              endTime: valid.endTime ? new Date(valid.endTime) : null,
              durationSeconds: valid.durationSeconds ?? null,
              caloriesKcal: valid.caloriesKcal ?? null,
              distanceMeters: valid.distanceMeters ?? null,
              avgHrBpm: valid.avgHrBpm ?? null,
              activeZoneMinutes: valid.activeZoneMinutes ?? null,
              syncedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [dailyWorkout.userId, dailyWorkout.source, dailyWorkout.sessionId],
              set: {
                day: valid.day,
                title: valid.title,
                exerciseType: valid.exerciseType,
                startTime: valid.startTime ? new Date(valid.startTime) : null,
                endTime: valid.endTime ? new Date(valid.endTime) : null,
                durationSeconds: valid.durationSeconds ?? null,
                caloriesKcal: valid.caloriesKcal ?? null,
                distanceMeters: valid.distanceMeters ?? null,
                avgHrBpm: valid.avgHrBpm ?? null,
                activeZoneMinutes: valid.activeZoneMinutes ?? null,
                syncedAt: new Date(),
              },
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

    return {
      syncedDays: readings.size,
      syncedSleepDays: sleepSessions.size,
      syncedRecoveryDays: recoveryReadings.size,
      syncedWorkouts: (workoutSessions ?? []).length,
      syncedHeight: remoteHeightCm != null,
    };
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
      const settings = await nutritionData(db, row.userId).settings();
      if (settings.trackingMode === "manual" || settings.preferredEnergySource !== "google") continue;
      const today = localDay(new Date(), settings.timezone);
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
    const settings = await nutritionData(db, userId).settings();
    if (settings.trackingMode === "manual" || settings.preferredEnergySource !== "google") {
      return { pushed: false, reason: "manual-mode" };
    }
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
  const settings = await nutritionData(db, userId).settings();
  if (settings.trackingMode === "manual" || settings.preferredEnergySource !== "google") {
    return { queued: false, reason: "manual-mode" };
  }
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
      activeZoneMinutes?: number | null;
      distanceMeters?: number | null;
      floors?: number | null;
      weightKg?: number | null;
      complete?: boolean;
    }
  >();
  const recoveryByDay = new Map<
    string,
    {
      day: string;
      source: "google" | "apple" | "manual";
      restingHrBpm?: number | null;
      hrvRmssdMs?: number | null;
      spo2Pct?: number | null;
      respiratoryRate?: number | null;
      skinTempDeltaC?: number | null;
      vo2Max?: number | null;
      bodyFatPct?: number | null;
    }
  >();
  const workoutMap = new Map<string, ParsedWorkout & { source?: "google" | "apple" | "manual" }>();
  let heightCm: number | null = null;
  const sleepMap = new Map<string, ParsedSleepSession>();
  const meals: {
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
      activeZoneMinutes?: number | null;
      distanceMeters?: number | null;
      floors?: number | null;
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
      activeZoneMinutes: patch.activeZoneMinutes ?? prev.activeZoneMinutes,
      distanceMeters: patch.distanceMeters ?? prev.distanceMeters,
      floors: patch.floors ?? prev.floors,
      weightKg: patch.weightKg ?? prev.weightKg,
      complete: patch.complete ?? prev.complete,
    });
  };

  const mergeRecovery = (
    day: string,
    patch: {
      source?: "google" | "apple" | "manual";
      restingHrBpm?: number | null;
      hrvRmssdMs?: number | null;
      spo2Pct?: number | null;
      respiratoryRate?: number | null;
      skinTempDeltaC?: number | null;
      vo2Max?: number | null;
      bodyFatPct?: number | null;
    },
  ) => {
    const prev = recoveryByDay.get(day) ?? { day, source: patch.source ?? "google" };
    recoveryByDay.set(day, {
      ...prev,
      ...patch,
      source: patch.source ?? prev.source,
      restingHrBpm: patch.restingHrBpm ?? prev.restingHrBpm,
      hrvRmssdMs: patch.hrvRmssdMs ?? prev.hrvRmssdMs,
      spo2Pct: patch.spo2Pct ?? prev.spo2Pct,
      respiratoryRate: patch.respiratoryRate ?? prev.respiratoryRate,
      skinTempDeltaC: patch.skinTempDeltaC ?? prev.skinTempDeltaC,
      vo2Max: patch.vo2Max ?? prev.vo2Max,
      bodyFatPct: patch.bodyFatPct ?? prev.bodyFatPct,
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
      // 0a. Saved exercise / workout point
      if (
        (pt.exercise && typeof pt.exercise === "object") ||
        (typeof pt.sessionId === "string" && typeof pt.title === "string" && typeof pt.day === "string") ||
        (typeof pt.activityName === "string" && (typeof pt.startTime === "string" || typeof pt.originalStartTime === "string"))
      ) {
        const parsedWorkouts = parseGoogleWorkouts({ dataPoints: [pt] }, timezone);
        const src = pt.source === "manual" || pt.source === "apple" ? pt.source : "google";
        for (const w of parsedWorkouts.workouts) {
          workoutMap.set(w.sessionId, { ...w, source: src });
        }
        return;
      }

      // 0b. Saved sleep point (FitnessTrackr export or Google Health v4 dataPoint with .sleep)
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

      // 0c. Google Health v4 recovery dataPoint / rollupPoint
      if (
        pt.dailyRestingHeartRate ||
        pt.restingHeartRate ||
        pt.dailyHeartRateVariability ||
        pt.heartRateVariability ||
        pt.dailyOxygenSaturation ||
        pt.oxygenSaturation ||
        pt.dailyRespiratoryRate ||
        pt.respiratoryRate ||
        pt.dailySleepTemperatureDerivations ||
        pt.sleepTemperatureDerivations ||
        pt.skinTemperatureDerivation ||
        pt.dailyVo2Max ||
        (pt.vo2Max && typeof pt.vo2Max === "object") ||
        (pt.bodyFat && typeof pt.bodyFat === "object")
      ) {
        for (const recType of Object.keys(recoveryTypes) as RecoveryType[]) {
          const parsedRec = parseGoogleRecovery(recType, { dataPoints: [pt] }, timezone);
          for (const [day, val] of parsedRec.rows) {
            mergeRecovery(day, { source: "google", [parsedRec.field]: val });
          }
        }
      }

      // 1. Native app / export array entry (energy and/or recovery)
      if (typeof pt.day === "string" && z.iso.date().safeParse(pt.day).success) {
        const src = pt.source === "apple" || pt.source === "manual" ? pt.source : "google";
        const hasRec =
          typeof pt.restingHrBpm === "number" ||
          typeof pt.hrvRmssdMs === "number" ||
          typeof pt.spo2Pct === "number" ||
          typeof pt.respiratoryRate === "number" ||
          typeof pt.skinTempDeltaC === "number" ||
          typeof pt.vo2Max === "number" ||
          typeof pt.bodyFatPct === "number";
        if (hasRec) {
          mergeRecovery(pt.day, {
            source: src,
            restingHrBpm: typeof pt.restingHrBpm === "number" ? pt.restingHrBpm : undefined,
            hrvRmssdMs: typeof pt.hrvRmssdMs === "number" ? pt.hrvRmssdMs : undefined,
            spo2Pct: typeof pt.spo2Pct === "number" ? pt.spo2Pct : undefined,
            respiratoryRate: typeof pt.respiratoryRate === "number" ? pt.respiratoryRate : undefined,
            skinTempDeltaC: typeof pt.skinTempDeltaC === "number" ? pt.skinTempDeltaC : undefined,
            vo2Max: typeof pt.vo2Max === "number" ? pt.vo2Max : undefined,
            bodyFatPct: typeof pt.bodyFatPct === "number" ? pt.bodyFatPct : undefined,
          });
        }
        const hasEnergy =
          typeof pt.totalKcal === "number" ||
          typeof pt.activeKcal === "number" ||
          typeof pt.steps === "number" ||
          typeof pt.activeZoneMinutes === "number" ||
          typeof pt.distanceMeters === "number" ||
          typeof pt.floors === "number" ||
          typeof pt.weightKg === "number";
        if (hasEnergy || !hasRec) {
          mergeDay(pt.day, {
            source: src,
            totalKcal: typeof pt.totalKcal === "number" ? pt.totalKcal : undefined,
            activeKcal: typeof pt.activeKcal === "number" ? pt.activeKcal : undefined,
            steps: typeof pt.steps === "number" ? Math.round(pt.steps) : undefined,
            activeZoneMinutes: typeof pt.activeZoneMinutes === "number" ? Math.round(pt.activeZoneMinutes) : undefined,
            distanceMeters: typeof pt.distanceMeters === "number" ? Math.round(pt.distanceMeters * 10) / 10 : undefined,
            floors: typeof pt.floors === "number" ? Math.round(pt.floors) : undefined,
            weightKg: typeof pt.weightKg === "number" ? Math.round(pt.weightKg * 100) / 100 : undefined,
            complete: typeof pt.complete === "boolean" ? pt.complete : typeof pt.totalKcal === "number",
          });
        }
        return;
      }

      // 2. Google Health v4 rollup point
      const civilDate = (pt.civilStartTime as { date?: { year: number; month: number; day: number } } | undefined)?.date;
      if (civilDate) {
        const day = `${civilDate.year}-${String(civilDate.month).padStart(2, "0")}-${String(civilDate.day).padStart(2, "0")}`;
        const tot = (pt.totalCalories as { kcalSum?: number } | undefined)?.kcalSum;
        const act = (pt.activeEnergyBurned as { kcalSum?: number } | undefined)?.kcalSum;
        const st = (pt.steps as { countSum?: number | string } | undefined)?.countSum;
        const azmObj = pt.activeZoneMinutes as
          | { minutesSum?: number; activeZoneMinutesSum?: number; countSum?: number; totalMinutes?: number }
          | undefined;
        const azm =
          azmObj?.minutesSum ?? azmObj?.activeZoneMinutesSum ?? azmObj?.countSum ?? azmObj?.totalMinutes;
        const distObj = pt.distance as { metersSum?: number; millimetersSum?: number } | undefined;
        const dist =
          distObj?.metersSum ?? (distObj?.millimetersSum != null ? Number(distObj.millimetersSum) / 1000 : undefined);
        const flObj = pt.floors as { countSum?: number; floorsSum?: number } | undefined;
        const fl = flObj?.countSum ?? flObj?.floorsSum;
        const wtObj = pt.weight as { weightGramsAvg?: number; kilogramsAvg?: number } | undefined;
        const wt = wtObj?.weightGramsAvg != null ? wtObj.weightGramsAvg / 1000 : wtObj?.kilogramsAvg;
        if (tot != null || act != null || st != null || azm != null || dist != null || fl != null || wt != null) {
          mergeDay(day, {
            source: "google",
            totalKcal: tot != null ? Math.round(Number(tot) * 10) / 10 : undefined,
            activeKcal: act != null ? Math.round(Number(act) * 10) / 10 : undefined,
            steps: st != null ? Math.round(Number(st)) : undefined,
            activeZoneMinutes: azm != null ? Math.round(Number(azm)) : undefined,
            distanceMeters: dist != null ? Math.round(Number(dist) * 10) / 10 : undefined,
            floors: fl != null ? Math.round(Number(fl)) : undefined,
            weightKg: wt != null ? Math.round(Number(wt) * 100) / 100 : undefined,
            complete: tot != null,
          });
        }
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

    const ingestContainer = (obj: Record<string, unknown>) => {
      if (typeof obj.heightCm === "number" && obj.heightCm > 50 && obj.heightCm < 300) {
        heightCm = Math.round(obj.heightCm * 10) / 10;
      }
      for (const keyName of [
        "dataPoints",
        "rollupDataPoints",
        "entries",
        "dailyEnergy",
        "dailySleep",
        "dailyRecovery",
        "recovery",
        "dailyWorkout",
        "workouts",
        "exercises",
        "exercise",
        "sleep",
        "sleepLogs",
        "weight",
        "calories",
        "steps",
      ]) {
        if (Array.isArray(obj[keyName])) {
          for (const item of obj[keyName] as unknown[]) {
            if (item && typeof item === "object") ingestPoint(item as Record<string, unknown>);
          }
        }
      }
      if (obj.nutrition && typeof obj.nutrition === "object" && !Array.isArray(obj.nutrition)) {
        ingestContainer(obj.nutrition as Record<string, unknown>);
      }
    };

    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && typeof item === "object") ingestPoint(item as Record<string, unknown>);
      }
    } else if (parsed && typeof parsed === "object") {
      ingestContainer(parsed as Record<string, unknown>);
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
    const iAzm = col("activezoneminutes", "azm", "zoneminutes");
    const iDistance = col("distance", "distancemeters", "distancekm");
    const distanceInKm = iDistance !== -1 && (headers[iDistance]?.includes("km") || headers[iDistance]?.includes("kilometer"));
    const iFloors = col("floors");
    const iWeight = col("weight");
    const weightInLbs = iWeight !== -1 && (headers[iWeight]?.includes("lb") || headers[iWeight]?.includes("pound"));
    const iRhr = col("restingheartrate", "restinghr", "rhr");
    const iHrv = col("hrv", "heartratevariability", "rmssd");
    const iSpo2 = col("spo2", "oxygensaturation");
    const iResp = col("respiratoryrate", "breathingrate");
    const iSkinTemp = col("skintemp", "temperaturedelta");
    const iVo2 = col("vo2max", "cardiofitness");
    const iBodyFat = col("bodyfat", "fatpct");
    if (iDate === -1) throw new NutritionError("CSV must contain a Date or Day column.");

    for (const line of lines.slice(1)) {
      const cells = splitCsvLine(line);
      const day = normalizeDateString(cells[iDate] ?? "");
      if (!day) continue;
      const numAt = (idx: number, allowNegative = false) => {
        if (idx === -1 || !cells[idx]) return null;
        const clean = cells[idx].replace(/,/g, "").replace(/%/g, "").trim();
        if (!clean) return null;
        const n = Number(clean);
        return Number.isFinite(n) && (allowNegative || n >= 0) ? n : null;
      };
      const totalKcal = numAt(iTotal);
      const activeKcal = numAt(iActive);
      const steps = numAt(iSteps);
      const azm = numAt(iAzm);
      const rawDist = numAt(iDistance);
      const distanceMeters = rawDist != null ? Math.round((distanceInKm ? rawDist * 1000 : rawDist) * 10) / 10 : null;
      const floors = numAt(iFloors);
      const rawWt = numAt(iWeight);
      const weightKg = rawWt != null && rawWt > 0 ? Math.round((weightInLbs ? rawWt * 0.45359237 : rawWt) * 100) / 100 : null;

      if (
        totalKcal != null ||
        activeKcal != null ||
        steps != null ||
        azm != null ||
        distanceMeters != null ||
        floors != null ||
        weightKg != null
      ) {
        mergeDay(day, {
          source: "google",
          totalKcal,
          activeKcal: totalKcal != null && activeKcal != null && activeKcal > totalKcal ? null : activeKcal,
          steps: steps != null ? Math.round(steps) : null,
          activeZoneMinutes: azm != null ? Math.round(azm) : null,
          distanceMeters,
          floors: floors != null ? Math.round(floors) : null,
          weightKg,
          complete: totalKcal != null,
        });
      }

      const restingHrBpm = numAt(iRhr);
      const hrvRmssdMs = numAt(iHrv);
      const spo2Pct = numAt(iSpo2);
      const respiratoryRate = numAt(iResp);
      const skinTempDeltaC = numAt(iSkinTemp, true);
      const vo2Max = numAt(iVo2);
      const bodyFatPct = numAt(iBodyFat);
      if (
        restingHrBpm != null ||
        hrvRmssdMs != null ||
        spo2Pct != null ||
        respiratoryRate != null ||
        skinTempDeltaC != null ||
        vo2Max != null ||
        bodyFatPct != null
      ) {
        mergeRecovery(day, {
          source: "google",
          restingHrBpm,
          hrvRmssdMs,
          spo2Pct,
          respiratoryRate,
          skinTempDeltaC,
          vo2Max,
          bodyFatPct,
        });
      }
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
        activeZoneMinutes: entry.activeZoneMinutes ?? null,
        distanceMeters: entry.distanceMeters ?? null,
        floors: entry.floors ?? null,
        weightKg: entry.weightKg ?? null,
        complete: entry.complete ?? entry.totalKcal != null,
      }),
    );

  const sleepEntries = [...sleepMap.values()]
    .slice(0, 365)
    .map((s) => sleepInput.parse({ ...s, source: "google" }));

  const recoveryEntries = [...recoveryByDay.values()]
    .slice(0, 365)
    .map((r) =>
      recoveryInput.parse({
        day: r.day,
        source: r.source,
        restingHrBpm: r.restingHrBpm ?? null,
        hrvRmssdMs: r.hrvRmssdMs ?? null,
        spo2Pct: r.spo2Pct ?? null,
        respiratoryRate: r.respiratoryRate ?? null,
        skinTempDeltaC: r.skinTempDeltaC ?? null,
        vo2Max: r.vo2Max ?? null,
        bodyFatPct: r.bodyFatPct ?? null,
      }),
    );

  const workoutEntries = [...workoutMap.values()]
    .slice(0, 365)
    .map((w) => workoutInput.parse({ ...w, source: w.source ?? "google" }));

  if (
    energyEntries.length === 0 &&
    sleepEntries.length === 0 &&
    recoveryEntries.length === 0 &&
    workoutEntries.length === 0 &&
    meals.length === 0 &&
    heightCm == null
  ) {
    throw new NutritionError("No valid energy, sleep, recovery, workout, weight, height, or meal records found in that file.");
  }

  return { energyEntries, sleepEntries, recoveryEntries, workoutEntries, heightCm, meals: meals.slice(0, 500) };
}

export async function disconnectGoogle(db: AuthDatabase, userId: string) {
  const [row] = await db.transaction(async (tx) => {
    const removed = await tx
      .delete(healthIntegration)
      .where(own(userId))
      .returning({ credential: healthIntegration.credential });
    await tx.delete(dailyEnergy).where(and(eq(dailyEnergy.userId, userId), eq(dailyEnergy.source, "google")));
    await tx.delete(dailySleep).where(and(eq(dailySleep.userId, userId), eq(dailySleep.source, "google")));
    await tx.delete(dailyRecovery).where(and(eq(dailyRecovery.userId, userId), eq(dailyRecovery.source, "google")));
    await tx.delete(dailyWorkout).where(and(eq(dailyWorkout.userId, userId), eq(dailyWorkout.source, "google")));
    await tx
      .insert(nutritionPreference)
      .values({
        userId,
        timezone: DEFAULT_TIMEZONE,
        trackingMode: "manual",
        preferredEnergySource: "manual",
        googleTwoWaySync: false,
        sleepRolloverEnabled: true,
      })
      .onConflictDoUpdate({
        target: nutritionPreference.userId,
        set: {
          trackingMode: "manual",
          preferredEnergySource: "manual",
        },
      });
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
