import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import type { AuthDatabase } from "./auth";
import { NutritionError, nutritionData, upsertSyncedWeight } from "./nutrition-data";
import {
  addDays,
  energyInput,
  historyInput,
  localDay,
  recoveryInput,
  sleepInput,
  workoutInput,
  type EnergySource,
} from "./nutrition-model";
import {
  dailyEnergy,
  dailyRecovery,
  dailySleep,
  dailyWorkout,
  healthIntegration,
  heartRateSample,
  nutritionPreference,
  profile,
  sleepSession,
  stepInterval,
  user,
} from "./schema";
import { saveSleepSession } from "./sleep-session-data";
import { strainData } from "./strain-data";
import { formatSourceLabel } from "./source-priority";

const OPEN_WEARABLES_PROVIDER = "open_wearables";

function apiBaseUrl(): string | null {
  const raw = process.env.OPEN_WEARABLES_API_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

function apiKey(): string | null {
  const raw = process.env.OPEN_WEARABLES_API_KEY?.trim();
  return raw || null;
}

export function openWearablesConfigured(): boolean {
  return Boolean(apiBaseUrl() && apiKey());
}

export function normalizeOwSource(provider?: string | null): EnergySource {
  const raw = (provider ?? "").trim().toLowerCase();
  if (!raw) return "apple";
  if (raw.includes("apple")) return "apple";
  if (raw.includes("health_connect") || raw === "android" || raw.includes("google_health_connect")) {
    return "health_connect";
  }
  if (raw.includes("samsung")) return "samsung";
  if (raw.includes("garmin")) return "garmin";
  if (raw.includes("whoop")) return "whoop";
  if (raw.includes("oura")) return "oura";
  if (raw.includes("polar")) return "polar";
  if (raw.includes("suunto")) return "suunto";
  if (raw.includes("strava")) return "strava";
  if (raw.includes("withings")) return "withings";
  if (raw.includes("fitbit") || raw === "google" || raw.includes("google_fit")) return "google";
  return "apple";
}

function ownOw(userId: string) {
  return and(eq(healthIntegration.userId, userId), eq(healthIntegration.provider, OPEN_WEARABLES_PROVIDER));
}

async function owFetch<T = unknown>(path: string, init?: RequestInit): Promise<{ status: number; ok: boolean; data: T | null }> {
  const base = apiBaseUrl();
  const key = apiKey();
  if (!base || !key) {
    throw new NutritionError("Open Wearables integration is not configured on this server.", 503);
  }
  const response = await fetch(`${base}${path}`, {
    ...init,
    signal: AbortSignal.timeout(15000),
    headers: {
      "X-Open-Wearables-API-Key": key,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text().catch(() => "");
  let data: T | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }
  return { status: response.status, ok: response.ok, data };
}

function unwrapItems<T = Record<string, unknown>>(payload: unknown): T[] {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload as T[];
  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (Array.isArray(obj.items)) return obj.items as T[];
  }
  return [];
}

function extractSource(item: Record<string, unknown> | null | undefined): EnergySource {
  if (!item) return "apple";
  const srcObj = item.source;
  if (srcObj && typeof srcObj === "object") {
    const provider = (srcObj as Record<string, unknown>).provider;
    if (typeof provider === "string" && provider.trim()) return normalizeOwSource(provider);
  }
  if (typeof item.source === "string" && item.source.trim()) return normalizeOwSource(item.source);
  if (typeof item.provider === "string" && item.provider.trim()) return normalizeOwSource(item.provider);
  return "apple";
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function intOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

export interface OpenWearablesIntegrationStatus {
  available: boolean;
  apiUrl: string | null;
  connected: boolean;
  owUserId: string | null;
  providers: string[];
  accountLabel: string | null;
  status: string | null;
  lastSync: string | null;
  lastError: string | null;
}

export async function openWearablesStatus(
  db: AuthDatabase,
  userId: string,
): Promise<OpenWearablesIntegrationStatus> {
  const [row] = await db
    .select({
      status: healthIntegration.status,
      accountLabel: healthIntegration.accountLabel,
      externalUserId: healthIntegration.externalUserId,
      lastSync: healthIntegration.lastSync,
      lastError: healthIntegration.lastError,
      diagnosticsJson: healthIntegration.diagnosticsJson,
    })
    .from(healthIntegration)
    .where(ownOw(userId));

  const diag =
    row?.diagnosticsJson && typeof row.diagnosticsJson === "object"
      ? (row.diagnosticsJson as Record<string, unknown>)
      : {};
  const providers = Array.isArray(diag.providers)
    ? diag.providers.filter((p): p is string => typeof p === "string" && p.length > 0)
    : [];

  return {
    available: openWearablesConfigured(),
    apiUrl: apiBaseUrl(),
    connected: Boolean(row && (row.status === "connected" || row.status === "sync_failed" || providers.length > 0)),
    owUserId: row?.externalUserId ?? null,
    providers,
    accountLabel: row?.accountLabel ?? null,
    status: row?.status ?? null,
    lastSync: row?.lastSync?.toISOString() ?? null,
    lastError: row?.lastError ?? null,
  };
}

export async function ensureOpenWearablesUser(db: AuthDatabase, userId: string): Promise<string> {
  if (!openWearablesConfigured()) {
    throw new NutritionError("Open Wearables integration is not configured on this server.", 503);
  }
  const [existing] = await db
    .select({ externalUserId: healthIntegration.externalUserId, status: healthIntegration.status })
    .from(healthIntegration)
    .where(ownOw(userId));

  if (existing?.externalUserId) {
    return existing.externalUserId;
  }

  const [userRow] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, userId));

  const fullName = (userRow?.name ?? "").trim();
  const [firstName = "FitnessTrackr", ...restName] = fullName ? fullName.split(/\s+/) : ["FitnessTrackr"];
  const lastName = restName.join(" ") || "Member";

  const createRes = await owFetch<{ id?: string; detail?: string }>("/api/v1/users", {
    method: "POST",
    body: JSON.stringify({
      first_name: firstName.slice(0, 80),
      last_name: lastName.slice(0, 80),
      email: userRow?.email ?? `${userId}@users.fitnesstrackr.local`,
      external_user_id: userId,
    }),
  });

  let owUserId = createRes.data?.id ?? null;

  // If external_user_id already existed on Open Wearables, look up via GET /api/v1/users?external_user_id=...
  if (!owUserId && !createRes.ok) {
    const lookupRes = await owFetch<{ data?: { id: string; external_user_id?: string }[]; items?: { id: string; external_user_id?: string }[] }>(
      `/api/v1/users?search=${encodeURIComponent(userId)}&limit=10`,
    );
    const matches = unwrapItems<{ id: string; external_user_id?: string }>(lookupRes.data);
    const exact = matches.find((m) => m.external_user_id === userId) ?? matches[0];
    if (exact?.id) owUserId = exact.id;
  }

  if (!owUserId) {
    throw new NutritionError(
      `Could not provision Open Wearables user (${createRes.status}).`,
      createRes.status >= 500 ? 502 : 422,
    );
  }

  await db
    .insert(healthIntegration)
    .values({
      userId,
      provider: OPEN_WEARABLES_PROVIDER,
      credential: JSON.stringify({ owUserId }),
      externalUserId: owUserId,
      accountLabel: "Awaiting device link",
      status: "pending",
      lastError: null,
    })
    .onConflictDoUpdate({
      target: [healthIntegration.userId, healthIntegration.provider],
      set: {
        credential: JSON.stringify({ owUserId }),
        externalUserId: owUserId,
        lastError: null,
      },
    });

  return owUserId;
}

export async function createOpenWearablesInviteCode(db: AuthDatabase, userId: string) {
  const owUserId = await ensureOpenWearablesUser(db, userId);
  const res = await owFetch<{ id?: string; code?: string; expires_at?: string; detail?: string }>(
    `/api/v1/users/${encodeURIComponent(owUserId)}/invitation-code`,
    { method: "POST" },
  );
  if (!res.ok || !res.data?.code) {
    throw new NutritionError(
      res.data?.detail || `Could not generate Open Wearables connection code (${res.status}).`,
      res.status >= 500 ? 502 : 422,
    );
  }
  return {
    code: res.data.code,
    expiresAt: res.data.expires_at ?? null,
    apiUrl: apiBaseUrl(),
    owUserId,
    status: await openWearablesStatus(db, userId),
  };
}

export async function syncOpenWearables(
  db: AuthDatabase,
  userId: string,
  opts: { from?: string; to?: string } = {},
) {
  if (!openWearablesConfigured()) {
    throw new NutritionError("Open Wearables integration is not configured on this server.", 503);
  }

  const [linked] = await db.select().from(healthIntegration).where(ownOw(userId));
  if (!linked?.externalUserId) {
    throw new NutritionError("Connect Open Wearables first.", 409);
  }
  const owUserId = linked.externalUserId;

  const settings = await nutritionData(db, userId).settings();
  const tz = settings.timezone;
  const today = localDay(new Date(), tz);
  const defaultDays = linked.lastSync ? -2 : -13;
  const to = opts.to && opts.to <= today ? opts.to : today;
  let from = opts.from ?? addDays(to, defaultDays);
  if (addDays(from, 30) < to) from = addDays(to, -30);
  historyInput.parse({ from, to });

  const [googleRow] = await db
    .select({ status: healthIntegration.status })
    .from(healthIntegration)
    .where(and(eq(healthIntegration.userId, userId), eq(healthIntegration.provider, "google")));
  const hasDirectGoogle = Boolean(googleRow);

  const encUser = encodeURIComponent(owUserId);
  const qsDates = `start_date=${encodeURIComponent(from)}&end_date=${encodeURIComponent(to)}&limit=100`;
  const startIso = `${from}T00:00:00Z`;
  const endIso = `${addDays(to, 1)}T23:59:59Z`;

  try {
    const [
      connRes,
      activityRes,
      sleepSummaryRes,
      recoveryRes,
      bodyRes,
      workoutsRes,
      sleepEventsRes,
      hrRes,
      stepsTsRes,
    ] = await Promise.all([
      owFetch(`/api/v1/users/${encUser}/connections`),
      owFetch(`/api/v1/users/${encUser}/summaries/activity?${qsDates}`),
      owFetch(`/api/v1/users/${encUser}/summaries/sleep?${qsDates}`),
      owFetch(`/api/v1/users/${encUser}/summaries/recovery?${qsDates}`),
      owFetch(`/api/v1/users/${encUser}/summaries/body`).catch(() => ({ ok: false, status: 404, data: null })),
      owFetch(`/api/v1/users/${encUser}/events/workouts?${qsDates}&filter_by_priority=true`),
      owFetch(`/api/v1/users/${encUser}/events/sleep?${qsDates}&filter_by_priority=true`),
      owFetch(
        `/api/v1/users/${encUser}/timeseries?start_time=${encodeURIComponent(startIso)}&end_time=${encodeURIComponent(endIso)}&types=heart_rate&resolution=1min&filter_by_priority=true&limit=100`,
      ).catch(() => ({ ok: false, status: 404, data: null })),
      owFetch(
        `/api/v1/users/${encUser}/timeseries?start_time=${encodeURIComponent(startIso)}&end_time=${encodeURIComponent(endIso)}&types=steps&filter_by_priority=true&limit=100`,
      ).catch(() => ({ ok: false, status: 404, data: null })),
    ]);

    if (!connRes.ok && connRes.status === 404) {
      throw new NutritionError("Open Wearables user not found. Regenerate connection code.", 404);
    }

    const connectionItems = unwrapItems<Record<string, unknown>>(connRes.data);
    const activeProviders = new Set<string>();
    for (const c of connectionItems) {
      const status = typeof c.status === "string" ? c.status.toLowerCase() : "active";
      if (status !== "disconnected" && status !== "revoked") {
        const norm = normalizeOwSource(typeof c.provider === "string" ? c.provider : null);
        activeProviders.add(norm);
      }
    }

    const touchedDays = new Set<string>();
    const activityItems = unwrapItems<Record<string, unknown>>(activityRes.data);
    const sleepSummaryItems = unwrapItems<Record<string, unknown>>(sleepSummaryRes.data);
    const recoveryItems = unwrapItems<Record<string, unknown>>(recoveryRes.data);
    const workoutItems = unwrapItems<Record<string, unknown>>(workoutsRes.data);
    const sleepEventItems = unwrapItems<Record<string, unknown>>(sleepEventsRes.data);
    const hrItems = unwrapItems<Record<string, unknown>>(hrRes.data);
    const stepItems = unwrapItems<Record<string, unknown>>(stepsTsRes.data);

    // Body summary is either a single BodySummary object or wrapped
    const bodyObj =
      bodyRes.ok && bodyRes.data && typeof bodyRes.data === "object" && !Array.isArray(bodyRes.data)
        ? (bodyRes.data as Record<string, unknown>)
        : null;
    const slowChanging =
      bodyObj?.slow_changing && typeof bodyObj.slow_changing === "object"
        ? (bodyObj.slow_changing as Record<string, unknown>)
        : null;
    const bodyWeightKg = num(slowChanging?.weight_kg);
    const bodyHeightCm = num(slowChanging?.height_cm);
    const bodyFatPct = num(slowChanging?.body_fat_percent);
    const bodySource = bodyObj ? extractSource(bodyObj) : null;

    let syncedDays = 0;
    let syncedSleepDays = 0;
    let syncedRecoveryDays = 0;
    let syncedWorkouts = 0;
    let syncedHeartRateSamples = 0;
    let syncedStepIntervals = 0;

    await db.transaction(async (tx) => {
      // 1. Activity Summaries -> dailyEnergy
      for (const item of activityItems) {
        const day = typeof item.date === "string" ? item.date.slice(0, 10) : null;
        if (!day || day < from || day > to) continue;
        const source = extractSource(item);
        if (hasDirectGoogle && source === "google") continue;
        activeProviders.add(source);

        const intensity =
          item.intensity_minutes && typeof item.intensity_minutes === "object"
            ? (item.intensity_minutes as Record<string, unknown>)
            : null;
        const azm =
          intensity != null
            ? intOrNull((num(intensity.moderate) ?? 0) + (num(intensity.vigorous) ?? 0) * 2)
            : intOrNull(item.active_minutes);

        const totalKcal = num(item.total_calories_kcal) ?? num(item.calories_total_kcal);
        const activeKcal = num(item.active_calories_kcal);
        const valid = energyInput.parse({
          day,
          source,
          totalKcal,
          activeKcal: totalKcal != null && activeKcal != null && activeKcal > totalKcal ? null : activeKcal,
          steps: intOrNull(item.steps),
          activeZoneMinutes: azm,
          distanceMeters: num(item.distance_meters),
          floors: intOrNull(item.floors_climbed),
          weightKg: day === to && bodySource === source ? bodyWeightKg : null,
          complete: day < today && totalKcal != null,
        });

        await tx
          .insert(dailyEnergy)
          .values({ userId, ...valid, syncedAt: new Date() })
          .onConflictDoUpdate({
            target: [dailyEnergy.userId, dailyEnergy.source, dailyEnergy.day],
            set: {
              totalKcal: valid.totalKcal ?? null,
              activeKcal: valid.activeKcal ?? null,
              steps: valid.steps ?? null,
              activeZoneMinutes: valid.activeZoneMinutes ?? null,
              distanceMeters: valid.distanceMeters ?? null,
              floors: valid.floors ?? null,
              ...(valid.weightKg != null ? { weightKg: valid.weightKg } : {}),
              complete: valid.complete,
              syncedAt: new Date(),
            },
          });

        if (valid.weightKg != null) {
          await upsertSyncedWeight(tx, userId, day, valid.weightKg, `Synced from ${formatSourceLabel(source)}`);
        }
        touchedDays.add(day);
        syncedDays += 1;
      }

      // If body weight arrived for a source without an activity row today, still log weight safely
      if (bodyWeightKg != null && bodySource && !(hasDirectGoogle && bodySource === "google")) {
        activeProviders.add(bodySource);
        await upsertSyncedWeight(tx, userId, to, bodyWeightKg, `Synced from ${formatSourceLabel(bodySource)}`);
      }

      if (bodyHeightCm != null && bodyHeightCm > 50 && bodyHeightCm < 280) {
        const [prof] = await tx.select({ heightCm: profile.heightCm }).from(profile).where(eq(profile.userId, userId));
        if (!prof) {
          await tx.insert(profile).values({ userId, heightCm: bodyHeightCm, units: "metric", goals: "" });
        } else if (prof.heightCm == null) {
          await tx.update(profile).set({ heightCm: bodyHeightCm }).where(eq(profile.userId, userId));
        }
      }

      // 2. Sleep Events -> sleepSession + dailySleep (fallback to SleepSummary when events absent)
      const sleepDaysHandledByEvents = new Set<string>();
      for (const ev of sleepEventItems) {
        const source = extractSource(ev);
        if (hasDirectGoogle && source === "google") continue;
        const startStr = typeof ev.start_time === "string" ? ev.start_time : null;
        const endStr = typeof ev.end_time === "string" ? ev.end_time : null;
        const day = endStr ? localDay(endStr, tz) : startStr ? localDay(startStr, tz) : null;
        if (!day || day < from || day > to) continue;
        const durSec = num(ev.sleep_duration_seconds) ?? num(ev.duration_seconds);
        const minutesAsleep = durSec != null ? Math.round(durSec / 60) : null;
        if (minutesAsleep == null || minutesAsleep <= 0) continue;

        const stagesObj = ev.stages && typeof ev.stages === "object" ? (ev.stages as Record<string, unknown>) : null;
        const deepMinutes = intOrNull(stagesObj?.deep_minutes);
        const remMinutes = intOrNull(stagesObj?.rem_minutes);
        const lightMinutes = intOrNull(stagesObj?.light_minutes);
        const awakeMinutes = intOrNull(stagesObj?.awake_minutes);
        const stagesJson: { stage: "AWAKE" | "LIGHT" | "DEEP" | "REM"; minutes: number }[] = [];
        if (awakeMinutes != null) stagesJson.push({ stage: "AWAKE", minutes: awakeMinutes });
        if (lightMinutes != null) stagesJson.push({ stage: "LIGHT", minutes: lightMinutes });
        if (deepMinutes != null) stagesJson.push({ stage: "DEEP", minutes: deepMinutes });
        if (remMinutes != null) stagesJson.push({ stage: "REM", minutes: remMinutes });

        activeProviders.add(source);
        await saveSleepSession(tx, userId, {
          day,
          source,
          sessionId: typeof ev.id === "string" ? ev.id : null,
          sleepStart: startStr,
          sleepEnd: endStr,
          minutesAsleep,
          minutesAwake: awakeMinutes,
          deepMinutes,
          remMinutes,
          lightMinutes,
          stagesJson,
          isMainSleep: ev.is_nap === true ? false : minutesAsleep >= 90,
          classificationMethod: "provider",
        });
        sleepDaysHandledByEvents.add(`${source}:${day}`);
        touchedDays.add(day);
        syncedSleepDays += 1;
      }

      // Overlay any sleep summary data for days not covered by sleep events
      const extraSleepVitals = new Map<string, { hrv?: number | null; spo2?: number | null; resp?: number | null }>();
      for (const sm of sleepSummaryItems) {
        const day = typeof sm.date === "string" ? sm.date.slice(0, 10) : null;
        if (!day || day < from || day > to) continue;
        const source = extractSource(sm);
        if (hasDirectGoogle && source === "google") continue;
        activeProviders.add(source);

        const hrv = num(sm.avg_hrv_sdnn_ms);
        const spo2 = num(sm.avg_spo2_percent);
        const resp = num(sm.avg_respiratory_rate);
        if (hrv != null || spo2 != null || resp != null) {
          extraSleepVitals.set(`${source}:${day}`, { hrv, spo2, resp });
        }

        if (!sleepDaysHandledByEvents.has(`${source}:${day}`)) {
          const minutesAsleep = intOrNull(sm.duration_minutes);
          if (minutesAsleep != null && minutesAsleep > 0) {
            const stagesObj = sm.stages && typeof sm.stages === "object" ? (sm.stages as Record<string, unknown>) : null;
            const deepMinutes = intOrNull(stagesObj?.deep_minutes);
            const remMinutes = intOrNull(stagesObj?.rem_minutes);
            const lightMinutes = intOrNull(stagesObj?.light_minutes);
            const awakeMinutes = intOrNull(stagesObj?.awake_minutes);
            const stagesJson: { stage: "AWAKE" | "LIGHT" | "DEEP" | "REM"; minutes: number }[] = [];
            if (awakeMinutes != null) stagesJson.push({ stage: "AWAKE", minutes: awakeMinutes });
            if (lightMinutes != null) stagesJson.push({ stage: "LIGHT", minutes: lightMinutes });
            if (deepMinutes != null) stagesJson.push({ stage: "DEEP", minutes: deepMinutes });
            if (remMinutes != null) stagesJson.push({ stage: "REM", minutes: remMinutes });

            await saveSleepSession(tx, userId, {
              day,
              source,
              sleepStart: typeof sm.start_time === "string" ? sm.start_time : null,
              sleepEnd: typeof sm.end_time === "string" ? sm.end_time : null,
              minutesAsleep,
              minutesAwake: awakeMinutes,
              deepMinutes,
              remMinutes,
              lightMinutes,
              stagesJson,
              isMainSleep: true,
              classificationMethod: "legacy",
            });
            touchedDays.add(day);
            syncedSleepDays += 1;
          }
        }
      }

      // 3. Recovery Summaries -> dailyRecovery (merge respiratory rate & body fat if available)
      for (const rec of recoveryItems) {
        const day = typeof rec.date === "string" ? rec.date.slice(0, 10) : null;
        if (!day || day < from || day > to) continue;
        const source = extractSource(rec);
        if (hasDirectGoogle && source === "google") continue;
        activeProviders.add(source);

        const vitals = extraSleepVitals.get(`${source}:${day}`);
        const valid = recoveryInput.parse({
          day,
          source,
          restingHrBpm: num(rec.resting_heart_rate_bpm),
          hrvRmssdMs: num(rec.avg_hrv_rmssd_ms) ?? num(rec.avg_hrv_sdnn_ms) ?? vitals?.hrv ?? null,
          spo2Pct: num(rec.avg_spo2_percent) ?? vitals?.spo2 ?? null,
          respiratoryRate: vitals?.resp ?? null,
          bodyFatPct: day === to && bodySource === source ? bodyFatPct : null,
        });

        await tx
          .insert(dailyRecovery)
          .values({
            userId,
            day: valid.day,
            source: valid.source,
            restingHrBpm: valid.restingHrBpm ?? null,
            hrvRmssdMs: valid.hrvRmssdMs ?? null,
            spo2Pct: valid.spo2Pct ?? null,
            respiratoryRate: valid.respiratoryRate ?? null,
            skinTempDeltaC: valid.skinTempDeltaC ?? null,
            vo2Max: valid.vo2Max ?? null,
            bodyFatPct: valid.bodyFatPct ?? null,
            syncedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [dailyRecovery.userId, dailyRecovery.source, dailyRecovery.day],
            set: {
              restingHrBpm: valid.restingHrBpm ?? null,
              hrvRmssdMs: valid.hrvRmssdMs ?? null,
              spo2Pct: valid.spo2Pct ?? null,
              respiratoryRate: valid.respiratoryRate ?? null,
              ...(valid.bodyFatPct != null ? { bodyFatPct: valid.bodyFatPct } : {}),
              syncedAt: new Date(),
            },
          });
        touchedDays.add(day);
        syncedRecoveryDays += 1;
      }

      // 4. Workouts -> dailyWorkout
      for (const w of workoutItems) {
        const source = extractSource(w);
        if (hasDirectGoogle && source === "google") continue;
        const startStr = typeof w.start_time === "string" ? w.start_time : null;
        const endStr = typeof w.end_time === "string" ? w.end_time : null;
        const day = startStr ? localDay(startStr, tz) : endStr ? localDay(endStr, tz) : null;
        if (!day || day < from || day > to) continue;
        const id = typeof w.id === "string" ? w.id : `${day}:${startStr ?? Math.random()}`;
        const exType = typeof w.type === "string" ? w.type : "";
        const title = (typeof w.name === "string" && w.name.trim()) ? w.name.trim() : exType || "Workout";

        activeProviders.add(source);
        const valid = workoutInput.parse({
          day,
          source,
          sessionId: id,
          title,
          exerciseType: exType,
          startTime: startStr,
          endTime: endStr,
          durationSeconds: intOrNull(w.duration_seconds),
          caloriesKcal: num(w.calories_kcal),
          distanceMeters: num(w.distance_meters),
          avgHrBpm: num(w.avg_heart_rate_bpm),
        });

        await tx
          .insert(dailyWorkout)
          .values({
            userId,
            source: valid.source,
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
              syncedAt: new Date(),
            },
          });
        touchedDays.add(day);
        syncedWorkouts += 1;
      }

      // 5. Heart Rate Timeseries -> heartRateSample
      const hrBatch: {
        userId: string;
        source: string;
        recordedAt: Date;
        bpm: number;
        day: string;
        dataSource: string;
        syncedAt: Date;
      }[] = [];
      for (const sample of hrItems) {
        const ts = typeof sample.timestamp === "string" ? sample.timestamp : null;
        const val = num(sample.value);
        if (!ts || val == null || val <= 20 || val > 260) continue;
        const source = extractSource(sample);
        if (hasDirectGoogle && source === "google") continue;
        const recordedAt = new Date(ts);
        if (Number.isNaN(recordedAt.getTime())) continue;
        const day = localDay(recordedAt, tz);
        if (day < from || day > to) continue;
        activeProviders.add(source);
        hrBatch.push({
          userId,
          source,
          recordedAt,
          bpm: val,
          day,
          dataSource: "open_wearables",
          syncedAt: new Date(),
        });
      }
      for (let i = 0; i < hrBatch.length; i += 500) {
        await tx.insert(heartRateSample).values(hrBatch.slice(i, i + 500)).onConflictDoNothing();
      }
      syncedHeartRateSamples = hrBatch.length;

      // 6. Step Timeseries -> stepInterval
      const stepBatch: {
        userId: string;
        source: string;
        startTime: Date;
        endTime: Date;
        steps: number;
        day: string;
        dataSource: string;
        syncedAt: Date;
      }[] = [];
      for (const item of stepItems) {
        if (item.is_daily_total === true) continue;
        const ts = typeof item.timestamp === "string" ? item.timestamp : null;
        const stepsVal = intOrNull(item.value);
        if (!ts || stepsVal == null || stepsVal < 0) continue;
        const source = extractSource(item);
        if (hasDirectGoogle && source === "google") continue;
        const start = new Date(ts);
        if (Number.isNaN(start.getTime())) continue;
        const winSec = intOrNull(item.window_seconds) ?? 60;
        const end =
          typeof item.period_end === "string"
            ? new Date(item.period_end)
            : new Date(start.getTime() + Math.max(60, winSec) * 1000);
        if (Number.isNaN(end.getTime()) || end <= start) continue;
        const day = localDay(start, tz);
        if (day < from || day > to) continue;
        activeProviders.add(source);
        stepBatch.push({
          userId,
          source,
          startTime: start,
          endTime: end,
          steps: stepsVal,
          day,
          dataSource: "open_wearables",
          syncedAt: new Date(),
        });
      }
      for (let i = 0; i < stepBatch.length; i += 500) {
        await tx.insert(stepInterval).values(stepBatch.slice(i, i + 500)).onConflictDoNothing();
      }
      syncedStepIntervals = stepBatch.length;

      const providersList = [...activeProviders];
      const isConnected = providersList.length > 0 || syncedDays > 0 || syncedWorkouts > 0 || syncedSleepDays > 0;
      const label = providersList.length > 0 ? providersList.map(formatSourceLabel).join(", ") : "Awaiting device link";

      await tx
        .update(healthIntegration)
        .set({
          status: isConnected ? "connected" : "pending",
          accountLabel: label,
          lastSync: new Date(),
          lastError: null,
          diagnosticsJson: {
            providers: providersList,
            syncedAt: new Date().toISOString(),
            from,
            to,
          },
        })
        .where(ownOw(userId));

      // If user has active Open Wearables data and has no explicit tracking preference yet, enable wearable mode cleanly
      if (isConnected) {
        const [pref] = await tx
          .select({ trackingMode: nutritionPreference.trackingMode })
          .from(nutritionPreference)
          .where(eq(nutritionPreference.userId, userId));
        if (!pref) {
          await tx.insert(nutritionPreference).values({
            userId,
            timezone: tz,
            trackingMode: "fitbit",
            preferredEnergySource: "google",
            googleTwoWaySync: false,
            sleepRolloverEnabled: true,
          });
        }
      }
    });

    // Recompute strain for affected days outside the transaction
    const strainSvc = strainData(db, userId);
    for (const day of touchedDays) {
      await strainSvc.computeDay(day).catch(() => null);
    }

    return {
      syncedDays,
      syncedSleepDays,
      syncedRecoveryDays,
      syncedWorkouts,
      syncedHeartRateSamples,
      syncedStepIntervals,
      providers: [...activeProviders],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Open Wearables sync failed.";
    await db
      .update(healthIntegration)
      .set({ status: "sync_failed", lastError: message.slice(0, 240) })
      .where(ownOw(userId));
    throw error;
  }
}

export function verifySvixSignature(
  rawBody: string,
  headers: {
    svixId?: string | null;
    svixTimestamp?: string | null;
    svixSignature?: string | null;
  },
  secret = process.env.OPEN_WEARABLES_WEBHOOK_SECRET,
  nowSec = Math.floor(Date.now() / 1000),
): { ok: boolean; reason?: string } {
  if (!secret || !secret.trim()) {
    return { ok: false, reason: "missing_secret" };
  }
  const svixId = headers.svixId?.trim();
  const svixTimestamp = headers.svixTimestamp?.trim();
  const svixSignature = headers.svixSignature?.trim();
  if (!svixId || !svixTimestamp || !svixSignature) {
    return { ok: false, reason: "missing_headers" };
  }

  const ts = Number.parseInt(svixTimestamp, 10);
  if (!Number.isFinite(ts) || String(ts) !== svixTimestamp) {
    return { ok: false, reason: "invalid_timestamp" };
  }
  if (Math.abs(nowSec - ts) > 300) {
    return { ok: false, reason: "timestamp_expired" };
  }

  const rawKey = secret.trim().startsWith("whsec_") ? secret.trim().slice(6) : secret.trim();
  const keyBytes = Buffer.from(rawKey, "base64");
  if (keyBytes.length === 0) {
    return { ok: false, reason: "invalid_secret" };
  }

  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expectedB64 = createHmac("sha256", keyBytes).update(signedContent, "utf8").digest("base64");
  const expectedBuf = Buffer.from(expectedB64, "utf8");

  const candidates = svixSignature.split(/\s+/).filter(Boolean);
  for (const part of candidates) {
    const commaIdx = part.indexOf(",");
    if (commaIdx <= 0) continue;
    const version = part.slice(0, commaIdx);
    const sig = part.slice(commaIdx + 1);
    if (version !== "v1" || !sig) continue;
    const sigBuf = Buffer.from(sig, "utf8");
    if (sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf)) {
      return { ok: true };
    }
  }

  return { ok: false, reason: "signature_mismatch" };
}

export async function handleOpenWearablesWebhookEvent(
  db: AuthDatabase,
  payload: unknown,
): Promise<{ handled: boolean; reason?: string; userId?: string }> {
  if (!payload || typeof payload !== "object") {
    return { handled: false, reason: "invalid_payload" };
  }
  const event = payload as Record<string, unknown>;
  const data = event.data && typeof event.data === "object" ? (event.data as Record<string, unknown>) : {};
  const owUserIdRaw = data.user_id ?? event.user_id;
  const owUserId = typeof owUserIdRaw === "string" && owUserIdRaw.trim() ? owUserIdRaw.trim() : null;
  if (!owUserId) {
    return { handled: false, reason: "no_user_id" };
  }

  const [row] = await db
    .select({ userId: healthIntegration.userId })
    .from(healthIntegration)
    .where(and(eq(healthIntegration.provider, OPEN_WEARABLES_PROVIDER), eq(healthIntegration.externalUserId, owUserId)));

  if (!row) {
    return { handled: false, reason: "unknown_user" };
  }

  const settings = await nutritionData(db, row.userId).settings();
  const tz = settings.timezone;
  const today = localDay(new Date(), tz);

  let from = addDays(today, -2);
  let to = today;
  const startRaw = typeof data.start_time === "string" ? data.start_time : null;
  const endRaw = typeof data.end_time === "string" ? data.end_time : null;
  if (startRaw && !Number.isNaN(Date.parse(startRaw))) {
    from = addDays(localDay(startRaw, tz), -1);
  }
  if (endRaw && !Number.isNaN(Date.parse(endRaw))) {
    const endDay = addDays(localDay(endRaw, tz), 1);
    to = endDay <= today ? endDay : today;
  }
  if (addDays(from, 7) < to) from = addDays(to, -7);

  await syncOpenWearables(db, row.userId, { from, to });
  return { handled: true, userId: row.userId };
}

export async function disconnectOpenWearables(db: AuthDatabase, userId: string) {
  const wearableSources = [
    "apple",
    "health_connect",
    "samsung",
    "garmin",
    "whoop",
    "oura",
    "polar",
    "suunto",
    "strava",
    "withings",
  ];
  await db.transaction(async (tx) => {
    await tx.delete(healthIntegration).where(ownOw(userId));
    await tx.delete(dailyEnergy).where(and(eq(dailyEnergy.userId, userId), inArray(dailyEnergy.source, wearableSources)));
    await tx.delete(dailySleep).where(and(eq(dailySleep.userId, userId), inArray(dailySleep.source, wearableSources)));
    await tx.delete(sleepSession).where(and(eq(sleepSession.userId, userId), inArray(sleepSession.source, wearableSources)));
    await tx.delete(dailyRecovery).where(and(eq(dailyRecovery.userId, userId), inArray(dailyRecovery.source, wearableSources)));
    await tx.delete(dailyWorkout).where(and(eq(dailyWorkout.userId, userId), inArray(dailyWorkout.source, wearableSources)));
    await tx.delete(heartRateSample).where(and(eq(heartRateSample.userId, userId), inArray(heartRateSample.source, wearableSources)));
    await tx.delete(stepInterval).where(and(eq(stepInterval.userId, userId), inArray(stepInterval.source, wearableSources)));

    const [googleStillConnected] = await tx
      .select({ userId: healthIntegration.userId })
      .from(healthIntegration)
      .where(and(eq(healthIntegration.userId, userId), eq(healthIntegration.provider, "google")));

    if (!googleStillConnected) {
      await tx
        .update(nutritionPreference)
        .set({ trackingMode: "manual", preferredEnergySource: "manual" })
        .where(and(eq(nutritionPreference.userId, userId), ne(nutritionPreference.trackingMode, "manual")));
    }
  });
  return { removed: true };
}
