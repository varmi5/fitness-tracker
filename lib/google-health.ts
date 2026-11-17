import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import type { AuthDatabase } from "./auth";
import { NutritionError, nutritionData } from "./nutrition-data";
import { addDays, energyInput, historyInput, localDay } from "./nutrition-model";
import { dailyEnergy, healthIntegration } from "./schema";

const googleAPI = "https://health.googleapis.com/v4/users/me";
const activityScope = "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";
const measurementsScope = "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly";
const scopeValues = [activityScope, measurementsScope];

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

export function googleConsent(callback: string, state: string, challenge: string) {
  if (!googleConfigured()) throw new NutritionError("Google Health is not configured.", 503);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_HEALTH_CLIENT_ID!,
    response_type: "code",
    redirect_uri: callback,
    access_type: "offline",
    prompt: "consent",
    scope: scopeValues.join(" "),
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
  if (!identity.ok) {
    const missing = await identity.json().catch(() => null);
    const unlinked = missing?.error?.details?.some((value: { reason?: string }) => value.reason === "ACCOUNT_NOT_LINKED");
    throw new NutritionError(
      unlinked
        ? "Link your Fitbit / Google account in the Fitbit or Google Health app first."
        : "Google Health could not confirm this account is eligible.",
      422,
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(healthIntegration)
      .values({ userId, provider: "google", credential: seal(grant, userId), status: "connected", lastError: null })
      .onConflictDoUpdate({
        target: [healthIntegration.userId, healthIntegration.provider],
        set: { credential: seal(grant, userId), status: "connected", lastSync: null, lastError: null },
      });
    // Replacing a connection clears prior Google rows so two accounts never mix.
    await tx.delete(dailyEnergy).where(and(eq(dailyEnergy.userId, userId), eq(dailyEnergy.source, "google")));
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
    const value = (item[section] as Record<string, unknown> | undefined)?.[name];
    if (value == null || value === "") continue;
    const parsed = z.number().nonnegative().parse(typeof value === "string" ? Number(value) : value);
    rows.set(date, field === "weightKg" ? Math.round((parsed / 1000) * 100) / 100 : field === "steps" ? Math.round(parsed) : Math.round(parsed * 10) / 10);
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

const own = (userId: string) => and(eq(healthIntegration.userId, userId), eq(healthIntegration.provider, "google"));

export async function googleStatus(db: AuthDatabase, userId: string) {
  const [row] = await db
    .select({ status: healthIntegration.status, lastSync: healthIntegration.lastSync, lastError: healthIntegration.lastError })
    .from(healthIntegration)
    .where(own(userId));
  return {
    available: googleConfigured(),
    connected: Boolean(row),
    status: row?.status ?? null,
    lastSync: row?.lastSync?.toISOString() ?? null,
    lastError: row?.lastError ?? null,
  };
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
    const today = localDay(new Date(), (await nutritionData(db, userId).settings()).timezone);
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
      }

      await tx
        .update(healthIntegration)
        .set({ credential: seal(grant, userId), lastSync: new Date(), status: "connected", lastError: null })
        .where(own(userId));
    });

    return { syncedDays: readings.size };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sync failed.";
    await db
      .update(healthIntegration)
      .set({ status: "sync_failed", lastError: message.slice(0, 240) })
      .where(and(own(userId), eq(healthIntegration.credential, linked.credential)));
    throw error;
  }
}

export async function disconnectGoogle(db: AuthDatabase, userId: string) {
  const [row] = await db.transaction(async (tx) => {
    const removed = await tx
      .delete(healthIntegration)
      .where(own(userId))
      .returning({ credential: healthIntegration.credential });
    await tx.delete(dailyEnergy).where(and(eq(dailyEnergy.userId, userId), eq(dailyEnergy.source, "google")));
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
