import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import type { AuthDatabase } from "./auth";
import { analyzeHeartRateCoverage, googleConfigured, seal, unseal } from "./google-health";
import { NutritionError, nutritionData } from "./nutrition-data";
import { DEFAULT_TIMEZONE, localDay } from "./nutrition-model";
import { workoutCategory } from "./source-priority";
import { dailyStrain, dailyWorkout, healthIntegration, heartRateSample, hevySet, hevyWorkout } from "./schema";

const HEVY_API_BASE = "https://api.hevyapp.com/v1";
const HEVY_AUTHORIZE_URL = process.env.HEVY_AUTHORIZE_URL ?? "https://hevy.com/oauth/authorize";
const HEVY_TOKEN_URL = process.env.HEVY_TOKEN_URL ?? "https://hevy.com/api/token";
const DEFAULT_HEVY_SCOPES = ["read-workout", "read-exercise", "read-profile"];

const hevyTokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional().default(""),
  expiresAt: z.number(),
  scopes: z.array(z.string()).default(DEFAULT_HEVY_SCOPES),
  hevyUserId: z.string().optional(),
  username: z.string().optional(),
  profilePic: z.string().nullable().optional(),
});
export type HevyTokens = z.infer<typeof hevyTokensSchema>;

export const HEVY_SET_TYPES = ["warmup", "normal", "failure", "dropset"] as const;
export type HevySetType = (typeof HEVY_SET_TYPES)[number];

export interface ParsedHevySet {
  exerciseIndex: number;
  exerciseTitle: string;
  exerciseTemplateId: string | null;
  supersetId: number | null;
  setIndex: number;
  setType: HevySetType;
  weightKg: number | null;
  reps: number | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  rpe: number | null;
  notes: string;
}

export interface ParsedHevyWorkout {
  hevyId: string;
  day: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  source: "hevy_oauth" | "hevy_csv" | "hevy_json";
  sets: ParsedHevySet[];
}

export function hevyOAuthConfigured(): boolean {
  return Boolean(
    process.env.HEVY_CLIENT_ID &&
      process.env.HEVY_CLIENT_SECRET &&
      /^[a-f0-9]{64}$/i.test(process.env.FITNESS_INTEGRATION_KEY ?? ""),
  );
}

export function hevyConsentUrl(callback: string, state: string): URL {
  if (!hevyOAuthConfigured()) {
    throw new NutritionError("Hevy OAuth is not configured on this server.", 503);
  }
  const url = new URL(HEVY_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: process.env.HEVY_CLIENT_ID!,
    redirect_uri: callback,
    state,
  }).toString();
  return url;
}

export async function exchangeHevyToken(params: Record<string, string>, previous?: HevyTokens): Promise<HevyTokens> {
  if (!hevyOAuthConfigured()) {
    throw new NutritionError("Hevy OAuth is not configured on this server.", 503);
  }
  const body = new URLSearchParams({
    ...params,
    client_id: process.env.HEVY_CLIENT_ID!,
    client_secret: process.env.HEVY_CLIENT_SECRET!,
  });

  const response = await fetch(HEVY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
    body,
  });
  if (!response.ok) {
    throw new NutritionError(`Hevy rejected the authorization (HTTP ${response.status}). Reconnect Hevy.`, 422);
  }
  const wire = z
    .object({
      access_token: z.string(),
      token_type: z.string().optional(),
      expires_in: z.number().optional().default(3600),
      refresh_token: z.string().optional(),
      scope: z.string().optional(),
      user_id: z.string().optional(),
      username: z.string().optional(),
      profile_pic: z.string().nullable().optional(),
    })
    .parse(await response.json());

  return {
    accessToken: wire.access_token,
    refreshToken: wire.refresh_token ?? previous?.refreshToken ?? "",
    expiresAt: Date.now() + wire.expires_in * 1000,
    scopes: wire.scope ? wire.scope.split(/\s+/).filter(Boolean) : previous?.scopes ?? DEFAULT_HEVY_SCOPES,
    hevyUserId: wire.user_id ?? previous?.hevyUserId,
    username: wire.username ?? previous?.username,
    profilePic: wire.profile_pic !== undefined ? wire.profile_pic : previous?.profilePic,
  };
}

function normalizeSetType(raw: unknown): HevySetType {
  const s = String(raw ?? "normal").trim().toLowerCase();
  if (s === "warmup" || s === "warm_up" || s === "warm-up") return "warmup";
  if (s === "failure" || s === "to_failure") return "failure";
  if (s === "dropset" || s === "drop_set" || s === "drop") return "dropset";
  return "normal";
}

function parseHevyDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const s = raw.trim();
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  // Support "23 Nov 2026, 13:42" or "2026-11-23 13:42:00"
  const normalized = s.replace(",", "");
  const d2 = new Date(normalized);
  if (!Number.isNaN(d2.getTime())) return d2.toISOString();
  return null;
}

function splitCsvRow(line: string): string[] {
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

export function parseHevyJson(
  payload: unknown,
  timezone = DEFAULT_TIMEZONE,
  source: "hevy_oauth" | "hevy_json" = "hevy_json",
): { workouts: ParsedHevyWorkout[]; pageCount?: number } {
  const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const list = Array.isArray(payload)
    ? payload
    : obj && Array.isArray(obj.workouts)
      ? obj.workouts
      : obj && obj.workout && typeof obj.workout === "object"
        ? [obj.workout]
        : obj && (obj.start_time || obj.startTime) && Array.isArray(obj.exercises)
          ? [obj]
          : [];
  const pageCount =
    obj && typeof obj.page_count === "number"
      ? obj.page_count
      : undefined;

  const workouts: ParsedHevyWorkout[] = [];

  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const w = raw as Record<string, unknown>;
    const startTime = parseHevyDate(w.start_time ?? w.startTime);
    const endTime = parseHevyDate(w.end_time ?? w.endTime) ?? startTime;
    if (!startTime || !endTime) continue;

    const title = String(w.title ?? "Strength Workout").trim().slice(0, 200) || "Strength Workout";
    const description = String(w.description ?? "").trim().slice(0, 1000);
    const hevyIdRaw = typeof w.id === "string" && w.id.trim() ? w.id.trim() : "";
    const hevyId = (
      hevyIdRaw ||
      `json:${createHash("sha256").update(`${startTime}|${endTime}|${title}`).digest("hex").slice(0, 24)}`
    ).slice(0, 160);
    const durationSeconds = Math.max(
      0,
      Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000),
    );
    const day = localDay(startTime, timezone);

    const rawExercises = Array.isArray(w.exercises) ? w.exercises : [];
    const sets: ParsedHevySet[] = [];
    rawExercises.forEach((exRaw, exIdx) => {
      if (!exRaw || typeof exRaw !== "object") return;
      const ex = exRaw as Record<string, unknown>;
      const exTitle = String(ex.title ?? ex.exercise_title ?? `Exercise ${exIdx + 1}`).trim().slice(0, 160);
      const exTemplateId =
        typeof ex.exercise_template_id === "string" && ex.exercise_template_id.trim()
          ? ex.exercise_template_id.trim().slice(0, 120)
          : null;
      const supersetId =
        typeof ex.superset_id === "number" && Number.isFinite(ex.superset_id)
          ? Math.round(ex.superset_id)
          : null;
      const notes = String(ex.notes ?? ex.exercise_notes ?? "").trim().slice(0, 500);
      const rawSets = Array.isArray(ex.sets) ? ex.sets : [];

      rawSets.forEach((sRaw, sIdx) => {
        if (!sRaw || typeof sRaw !== "object") return;
        const s = sRaw as Record<string, unknown>;
        const numOrNull = (val: unknown) => {
          if (val == null || val === "") return null;
          const n = Number(val);
          return Number.isFinite(n) && n >= 0 ? n : null;
        };
        const weightKg = numOrNull(s.weight_kg ?? s.weightKg);
        const repsRaw = numOrNull(s.reps);
        const distanceMeters = numOrNull(s.distance_meters ?? s.distanceMeters);
        const durSec = numOrNull(s.duration_seconds ?? s.durationSeconds);
        const rpeRaw = numOrNull(s.rpe);

        sets.push({
          exerciseIndex: typeof ex.index === "number" ? Math.round(ex.index) : exIdx,
          exerciseTitle: exTitle,
          exerciseTemplateId: exTemplateId,
          supersetId,
          setIndex: typeof s.index === "number" ? Math.round(s.index) : sIdx,
          setType: normalizeSetType(s.type ?? s.set_type),
          weightKg: weightKg != null ? Math.round(weightKg * 100) / 100 : null,
          reps: repsRaw != null ? Math.round(repsRaw) : null,
          distanceMeters: distanceMeters != null ? Math.round(distanceMeters * 10) / 10 : null,
          durationSeconds: durSec != null ? Math.round(durSec) : null,
          rpe: rpeRaw != null && rpeRaw >= 1 && rpeRaw <= 10 ? Math.round(rpeRaw * 10) / 10 : null,
          notes,
        });
      });
    });

    workouts.push({
      hevyId,
      day,
      title,
      description,
      startTime,
      endTime,
      durationSeconds,
      source,
      sets,
    });
  }

  return { workouts, pageCount };
}

export function parseHevyCsv(rawText: string, timezone = DEFAULT_TIMEZONE): ParsedHevyWorkout[] {
  const lines = rawText.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new NutritionError("Hevy CSV must include a header row and at least one set row.");
  }
  const headers = splitCsvRow(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
  const col = (...candidates: string[]) => headers.findIndex((h) => candidates.some((c) => h === c || h.includes(c)));

  const iTitle = col("title", "workout");
  const iStart = col("starttime");
  const iEnd = col("endtime");
  const iDesc = col("description");
  const iEx = col("exercisetitle", "exercise");
  const iSuperset = col("supersetid");
  const iNotes = col("exercisenotes", "notes");
  const iSetIdx = col("setindex");
  const iSetType = col("settype");
  const iWeightKg = col("weightkg");
  const iWeightLbs = iWeightKg === -1 ? col("weightlbs", "weightlb") : -1;
  const iReps = col("reps");
  const iDistKm = col("distancekm");
  const iDistMi = iDistKm === -1 ? col("distancemiles") : -1;
  const iDur = col("durationseconds");
  const iRpe = col("rpe");

  if (iStart === -1 || iEx === -1) {
    throw new NutritionError("Hevy CSV must include start_time and exercise_title columns.");
  }

  const grouped = new Map<
    string,
    {
      workout: Omit<ParsedHevyWorkout, "sets">;
      exerciseOrder: Map<string, number>;
      sets: ParsedHevySet[];
    }
  >();

  for (const line of lines.slice(1)) {
    const cells = splitCsvRow(line);
    const startTime = parseHevyDate(cells[iStart]);
    if (!startTime) continue;
    const endTime = (iEnd !== -1 ? parseHevyDate(cells[iEnd]) : null) ?? startTime;
    const title = (iTitle !== -1 && cells[iTitle] ? cells[iTitle] : "Strength Workout").slice(0, 200);
    const description = iDesc !== -1 && cells[iDesc] ? cells[iDesc].slice(0, 1000) : "";
    const exerciseTitle = (cells[iEx] ?? "").trim().slice(0, 160);
    if (!exerciseTitle) continue;

    const key = `${startTime}|${endTime}|${title}`;
    let bucket = grouped.get(key);
    if (!bucket) {
      const hevyId = `csv:${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
      bucket = {
        workout: {
          hevyId,
          day: localDay(startTime, timezone),
          title,
          description,
          startTime,
          endTime,
          durationSeconds: Math.max(0, Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000)),
          source: "hevy_csv",
        },
        exerciseOrder: new Map(),
        sets: [],
      };
      grouped.set(key, bucket);
    }

    let exIdx = bucket.exerciseOrder.get(exerciseTitle);
    if (exIdx === undefined) {
      exIdx = bucket.exerciseOrder.size;
      bucket.exerciseOrder.set(exerciseTitle, exIdx);
    }

    const numCell = (idx: number) => {
      if (idx === -1 || !cells[idx]) return null;
      const n = Number(cells[idx].replace(/,/g, "").trim());
      return Number.isFinite(n) && n >= 0 ? n : null;
    };

    const weightKgRaw = iWeightKg !== -1 ? numCell(iWeightKg) : null;
    const weightLbsRaw = iWeightLbs !== -1 ? numCell(iWeightLbs) : null;
    const weightKg =
      weightKgRaw != null
        ? Math.round(weightKgRaw * 100) / 100
        : weightLbsRaw != null
          ? Math.round(weightLbsRaw * 0.45359237 * 100) / 100
          : null;

    const distKm = iDistKm !== -1 ? numCell(iDistKm) : null;
    const distMi = iDistMi !== -1 ? numCell(iDistMi) : null;
    const distanceMeters =
      distKm != null
        ? Math.round(distKm * 1000 * 10) / 10
        : distMi != null
          ? Math.round(distMi * 1609.344 * 10) / 10
          : null;

    const repsRaw = numCell(iReps);
    const durRaw = numCell(iDur);
    const rpeRaw = numCell(iRpe);
    const supersetRaw = numCell(iSuperset);
    const setIndexRaw = numCell(iSetIdx);

    bucket.sets.push({
      exerciseIndex: exIdx,
      exerciseTitle,
      exerciseTemplateId: null,
      supersetId: supersetRaw != null ? Math.round(supersetRaw) : null,
      setIndex: setIndexRaw != null ? Math.round(setIndexRaw) : bucket.sets.length,
      setType: normalizeSetType(iSetType !== -1 ? cells[iSetType] : "normal"),
      weightKg,
      reps: repsRaw != null ? Math.round(repsRaw) : null,
      distanceMeters,
      durationSeconds: durRaw != null ? Math.round(durRaw) : null,
      rpe: rpeRaw != null && rpeRaw >= 1 && rpeRaw <= 10 ? Math.round(rpeRaw * 10) / 10 : null,
      notes: iNotes !== -1 && cells[iNotes] ? cells[iNotes].slice(0, 500) : "",
    });
  }

  return [...grouped.values()].map((b) => ({
    ...b.workout,
    sets: b.sets,
  }));
}

export function parseHevyImport(rawText: string, timezone = DEFAULT_TIMEZONE): ParsedHevyWorkout[] {
  const trimmed = rawText.trim();
  if (!trimmed) throw new NutritionError("Paste or upload a Hevy CSV or JSON export.");
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new NutritionError("Invalid JSON in Hevy export.");
    }
    const res = parseHevyJson(parsed, timezone, "hevy_json");
    if (res.workouts.length === 0) throw new NutritionError("No valid workouts found in that Hevy JSON export.");
    return res.workouts;
  }
  const workouts = parseHevyCsv(trimmed, timezone);
  if (workouts.length === 0) throw new NutritionError("No valid workouts found in that Hevy CSV export.");
  return workouts;
}

export function findMatchingGoogleWorkout<T extends {
  sessionId: string; startTime: Date | null; endTime: Date | null; avgHrBpm: number | null;
  title?: string; exerciseType?: string; durationSeconds?: number | null;
}>(hevyStartIso: string, hevyEndIso: string, candidates: T[]): T | null {
  const hStart = new Date(hevyStartIso).getTime();
  const hEnd = Math.max(hStart + 60_000, new Date(hevyEndIso).getTime());

  let best: { row: T; score: number } | null = null;
  for (const cand of candidates) {
    if (!cand.startTime) continue;
    const category = workoutCategory(cand);
    if (category && category !== "strength") continue;
    const gStart = cand.startTime.getTime();
    const gEnd = cand.endTime?.getTime() ?? gStart + (cand.durationSeconds ?? 0) * 1000;

    const overlapMs = Math.max(0, Math.min(hEnd, gEnd) - Math.max(hStart, gStart));
    const minDurMs = Math.max(60_000, hEnd - hStart, gEnd - gStart);
    const startDiffMs = Math.abs(hStart - gStart);

    if (overlapMs >= minDurMs * 0.6 && startDiffMs <= 15 * 60_000) {
      const score = overlapMs - startDiffMs * 0.25;
      if (!best || score > best.score) {
        best = { row: cand, score };
      }
    }
  }
  return best?.row ?? null;
}

/** CSV exports use synthetic IDs. Keep the richer provider record when an export matches it. */
export function dedupeHevyWorkouts<T extends { day: string; source: string; title: string; startTime: Date; endTime: Date }>(rows: T[]): T[] {
  const directByDay = new Map<string, T[]>();
  for (const row of rows) {
    if (row.source === "hevy_csv" || row.source === "hevy_json") continue;
    const day = directByDay.get(row.day) ?? [];
    day.push(row);
    directByDay.set(row.day, day);
  }
  const titleKey = (title: string) => title.trim().toLowerCase().replace(/\s+/g, " ");
  return rows.filter((row) => {
    if (row.source !== "hevy_csv" && row.source !== "hevy_json") return true;
    return !directByDay.get(row.day)?.some((other) =>
      titleKey(row.title) === titleKey(other.title)
      && Math.abs(row.startTime.getTime() - other.startTime.getTime()) <= 90_000
      && Math.abs(row.endTime.getTime() - other.endTime.getTime()) <= 90_000);
  });
}

export async function importHevyWorkouts(
  db: AuthDatabase,
  userId: string,
  workouts: ParsedHevyWorkout[],
  options: { deletedIds?: string[] } = {},
) {
  const deletedIds = options.deletedIds ?? [];
  const days = [...new Set(workouts.map((w) => w.day))].sort();
  const minDay = days[0];
  const maxDay = days[days.length - 1];

  const [googleWorkouts, hrRows] = days.length
    ? await Promise.all([
        db
          .select({
            sessionId: dailyWorkout.sessionId,
            startTime: dailyWorkout.startTime,
            endTime: dailyWorkout.endTime,
            avgHrBpm: dailyWorkout.avgHrBpm,
            title: dailyWorkout.title,
            exerciseType: dailyWorkout.exerciseType,
            durationSeconds: dailyWorkout.durationSeconds,
            day: dailyWorkout.day,
          })
          .from(dailyWorkout)
          .where(and(eq(dailyWorkout.userId, userId), eq(dailyWorkout.source, "google"), gte(dailyWorkout.day, minDay), lte(dailyWorkout.day, maxDay))),
        db
          .select({
            recordedAt: heartRateSample.recordedAt,
            bpm: heartRateSample.bpm,
            dataSource: heartRateSample.dataSource,
            day: heartRateSample.day,
          })
          .from(heartRateSample)
          .where(and(eq(heartRateSample.userId, userId), gte(heartRateSample.day, minDay), lte(heartRateSample.day, maxDay))),
      ])
    : [[], []];

  const hrList = hrRows.map((r) => ({
    recordedAt: r.recordedAt.toISOString(),
    bpm: r.bpm,
    dataSource: r.dataSource,
  }));

  let matchedCount = 0;
  let hrAssociatedCount = 0;

  await db.transaction(async (tx) => {
    if (deletedIds.length > 0) {
      const removed = await tx.select({ day: hevyWorkout.day }).from(hevyWorkout)
        .where(and(eq(hevyWorkout.userId, userId), inArray(hevyWorkout.hevyId, deletedIds)));
      if (removed.length) await tx.delete(dailyStrain)
        .where(and(eq(dailyStrain.userId, userId), inArray(dailyStrain.day, removed.map((row) => row.day))));
      await tx.delete(hevySet).where(and(eq(hevySet.userId, userId), inArray(hevySet.hevyId, deletedIds)));
      await tx.delete(hevyWorkout).where(and(eq(hevyWorkout.userId, userId), inArray(hevyWorkout.hevyId, deletedIds)));
    }

    for (const w of workouts) {
      const matched = findMatchingGoogleWorkout(w.startTime, w.endTime, googleWorkouts);
      if (matched) matchedCount += 1;

      const cov = analyzeHeartRateCoverage(hrList, w.startTime, w.endTime);
      const avgHrBpm = cov.avgBpm ?? matched?.avgHrBpm ?? null;
      if (cov.sampleCount > 0 || avgHrBpm != null) hrAssociatedCount += 1;

      await tx
        .insert(hevyWorkout)
        .values({
          userId,
          hevyId: w.hevyId,
          day: w.day,
          title: w.title,
          description: w.description,
          startTime: new Date(w.startTime),
          endTime: new Date(w.endTime),
          durationSeconds: w.durationSeconds,
          source: w.source,
          matchedGoogleSessionId: matched?.sessionId ?? null,
          avgHrBpm,
          hrSampleCount: cov.sampleCount,
          hrCoveragePct: cov.sampleCount > 0 ? cov.coveragePct : null,
          updatedAt: new Date(),
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [hevyWorkout.userId, hevyWorkout.hevyId],
          set: {
            day: w.day,
            title: w.title,
            description: w.description,
            startTime: new Date(w.startTime),
            endTime: new Date(w.endTime),
            durationSeconds: w.durationSeconds,
            source: w.source,
            matchedGoogleSessionId: matched?.sessionId ?? null,
            avgHrBpm,
            hrSampleCount: cov.sampleCount,
            hrCoveragePct: cov.sampleCount > 0 ? cov.coveragePct : null,
            updatedAt: new Date(),
            syncedAt: new Date(),
          },
        });

      await tx.delete(hevySet).where(and(eq(hevySet.userId, userId), eq(hevySet.hevyId, w.hevyId)));
      if (w.sets.length > 0) {
        await tx.insert(hevySet).values(
          w.sets.map((s) => ({
            id: randomUUID(),
            userId,
            hevyId: w.hevyId,
            exerciseIndex: s.exerciseIndex,
            exerciseTitle: s.exerciseTitle,
            exerciseTemplateId: s.exerciseTemplateId,
            supersetId: s.supersetId,
            setIndex: s.setIndex,
            setType: s.setType,
            weightKg: s.weightKg,
            reps: s.reps,
            distanceMeters: s.distanceMeters,
            durationSeconds: s.durationSeconds,
            rpe: s.rpe,
            notes: s.notes,
          })),
        );
      }
    }
  });

  return {
    importedWorkouts: workouts.length,
    deletedWorkouts: deletedIds.length,
    matchedGoogleWorkouts: matchedCount,
    hrAssociatedWorkouts: hrAssociatedCount,
    affectedDays: [...new Set(workouts.map((w) => w.day))],
  };
}

const ownHevy = (userId: string) => and(eq(healthIntegration.userId, userId), eq(healthIntegration.provider, "hevy"));

export async function hevyStatus(db: AuthDatabase, userId: string) {
  const [row] = await db
    .select({
      status: healthIntegration.status,
      accountLabel: healthIntegration.accountLabel,
      lastSync: healthIntegration.lastSync,
      lastError: healthIntegration.lastError,
    })
    .from(healthIntegration)
    .where(ownHevy(userId));

  const workoutCountRows = await db
    .select({ hevyId: hevyWorkout.hevyId })
    .from(hevyWorkout)
    .where(eq(hevyWorkout.userId, userId));

  return {
    oauthAvailable: hevyOAuthConfigured(),
    connected: Boolean(row),
    accountLabel: row?.accountLabel ?? null,
    status: row?.status ?? (workoutCountRows.length > 0 ? "imported" : null),
    lastSync: row?.lastSync?.toISOString() ?? null,
    lastError: row?.lastError ?? null,
    workoutCount: workoutCountRows.length,
  };
}

export async function connectHevy(db: AuthDatabase, userId: string, grant: HevyTokens, accountLabel = "Hevy") {
  const resolvedLabel = grant.username ? `@${grant.username}` : accountLabel;
  await db
    .insert(healthIntegration)
    .values({
      userId,
      provider: "hevy",
      credential: seal(grant, userId),
      accountLabel: resolvedLabel,
      status: "connected",
      lastError: null,
    })
    .onConflictDoUpdate({
      target: [healthIntegration.userId, healthIntegration.provider],
      set: {
        credential: seal(grant, userId),
        accountLabel: resolvedLabel,
        status: "connected",
        lastError: null,
      },
    });
}

export async function disconnectHevy(db: AuthDatabase, userId: string, deleteWorkouts = false) {
  await db.transaction(async (tx) => {
    await tx.delete(healthIntegration).where(ownHevy(userId));
    if (deleteWorkouts) {
      await tx.delete(dailyStrain).where(eq(dailyStrain.userId, userId));
      await tx.delete(hevySet).where(eq(hevySet.userId, userId));
      await tx.delete(hevyWorkout).where(eq(hevyWorkout.userId, userId));
    }
  });
  return { disconnected: true };
}

export async function syncHevyOAuth(db: AuthDatabase, userId: string, maxPages = 10, singleWorkoutId?: string) {
  const [linked] = await db.select().from(healthIntegration).where(ownHevy(userId));
  if (!linked) throw new NutritionError("Connect Hevy first or import a Hevy CSV/JSON export.", 409);

  try {
    let grant = hevyTokensSchema.parse(unseal(linked.credential, userId));
    if (grant.expiresAt < Date.now() + 60_000 && grant.refreshToken) {
      grant = await exchangeHevyToken({ grant_type: "refresh_token", refresh_token: grant.refreshToken }, grant);
      // Hevy refresh tokens are single-use: persist the rotated refresh token immediately before making API requests.
      await db
        .update(healthIntegration)
        .set({ credential: seal(grant, userId) })
        .where(ownHevy(userId));
    }

    const tz = (await nutritionData(db, userId).settings()).timezone;
    const allWorkouts: ParsedHevyWorkout[] = [];

    if (singleWorkoutId) {
      const response = await fetch(`${HEVY_API_BASE}/workouts/${encodeURIComponent(singleWorkoutId)}`, {
        headers: { Authorization: `Bearer ${grant.accessToken}` },
        signal: AbortSignal.timeout(9000),
        cache: "no-store",
      });
      if (!response.ok) {
        throw new NutritionError(`Hevy API returned HTTP ${response.status}.`, 502);
      }
      const parsed = parseHevyJson(await response.json(), tz, "hevy_oauth");
      allWorkouts.push(...parsed.workouts);
    } else {
      for (let page = 1; page <= maxPages; page++) {
        const url = new URL(`${HEVY_API_BASE}/workouts`);
        url.searchParams.set("page", String(page));
        url.searchParams.set("pageSize", "10");

        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${grant.accessToken}` },
          signal: AbortSignal.timeout(9000),
          cache: "no-store",
        });
        if (!response.ok) {
          throw new NutritionError(`Hevy API returned HTTP ${response.status}.`, 502);
        }
        const parsed = parseHevyJson(await response.json(), tz, "hevy_oauth");
        allWorkouts.push(...parsed.workouts);
        if (!parsed.pageCount || page >= parsed.pageCount) break;
      }
    }

    const result = await importHevyWorkouts(db, userId, allWorkouts);

    await db
      .update(healthIntegration)
      .set({ credential: seal(grant, userId), lastSync: new Date(), status: "connected", lastError: null })
      .where(ownHevy(userId));

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hevy sync failed.";
    await db
      .update(healthIntegration)
      .set({ status: "sync_failed", lastError: message.slice(0, 240) })
      .where(ownHevy(userId));
    throw error;
  }
}

export async function findUsersForHevyWebhook(db: AuthDatabase, hevyUserId?: string): Promise<string[]> {
  const rows = await db
    .select({ userId: healthIntegration.userId, credential: healthIntegration.credential })
    .from(healthIntegration)
    .where(eq(healthIntegration.provider, "hevy"));

  if (!hevyUserId) return rows.map((r) => r.userId);

  const matched: string[] = [];
  for (const r of rows) {
    try {
      const parsed = hevyTokensSchema.parse(unseal(r.credential, r.userId));
      if (parsed.hevyUserId === hevyUserId) matched.push(r.userId);
    } catch {
      // ignore unseal failures
    }
  }
  return matched.length > 0 ? matched : rows.map((r) => r.userId);
}

export async function listHevyWorkoutsForRange(db: AuthDatabase, userId: string, from: string, to: string) {
  const [workouts, sets] = await Promise.all([
    db
      .select()
      .from(hevyWorkout)
      .where(and(eq(hevyWorkout.userId, userId), gte(hevyWorkout.day, from), lte(hevyWorkout.day, to)))
      .orderBy(desc(hevyWorkout.day), asc(hevyWorkout.startTime)),
    db
      .select()
      .from(hevySet)
      .where(eq(hevySet.userId, userId))
      .orderBy(asc(hevySet.exerciseIndex), asc(hevySet.setIndex)),
  ]);

  const setsByWorkout = new Map<string, (typeof sets)[number][]>();
  for (const s of sets) {
    const list = setsByWorkout.get(s.hevyId) ?? [];
    list.push(s);
    setsByWorkout.set(s.hevyId, list);
  }

  return workouts.map((w) => ({
    ...w,
    startTime: w.startTime.toISOString(),
    endTime: w.endTime.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
    syncedAt: w.syncedAt.toISOString(),
    sets: setsByWorkout.get(w.hevyId) ?? [],
  }));
}

export { googleConfigured };
