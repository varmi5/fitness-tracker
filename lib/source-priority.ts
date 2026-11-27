import { metricPreference, RECOVERY_FIELDS, type SourcePreference, type SourceSettings } from "./data-source-settings";
type RecoveryField = (typeof RECOVERY_FIELDS)[number];

export const DEFAULT_RECOVERY_PRIORITY = [
  "google",
  "oura",
  "whoop",
  "apple",
  "garmin",
  "health_connect",
  "samsung",
  "polar",
  "suunto",
  "withings",
  "strava",
  "manual",
] as const;

export const DEFAULT_WORKOUT_PRIORITY = [
  "apple",
  "garmin",
  "polar",
  "suunto",
  "whoop",
  "google",
  "health_connect",
  "samsung",
  "oura",
  "strava",
  "withings",
  "manual",
] as const;

export const DEFAULT_ENERGY_PRIORITY = [
  "google",
  "apple",
  "health_connect",
  "garmin",
  "samsung",
  "oura",
  "whoop",
  "polar",
  "suunto",
  "withings",
  "strava",
  "manual",
] as const;

const SOURCE_LABELS: Record<string, string> = {
  google: "Google Health",
  apple: "Apple Health",
  health_connect: "Health Connect",
  samsung: "Samsung Health",
  garmin: "Garmin",
  whoop: "Whoop",
  oura: "Oura",
  polar: "Polar",
  suunto: "Suunto",
  strava: "Strava",
  withings: "Withings",
  manual: "Manual",
  hevy: "Hevy",
};

export function formatSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function linkedWearableProviders(connection?: { connected: boolean; providers: readonly string[] }) {
  const providers = connection?.connected ? new Set(connection.providers) : new Set<string>();
  return {
    apple: providers.has("apple"),
    other: [...providers].filter((provider) =>
      provider !== "apple" && provider !== "google" && provider !== "manual" && Object.hasOwn(SOURCE_LABELS, provider)),
  };
}

export function isSourceVisible(preference: SourcePreference, source: string) {
  return !preference || typeof preference === "string" || !preference.hidden.includes(source);
}

export function rankSources(preference: SourcePreference, defaults: readonly string[]): string[] {
  const preferred = typeof preference === "string" ? [preference.trim().toLowerCase()] : preference?.priority ?? [];
  return [...new Set([...preferred, ...defaults])].filter((source) => source !== "auto" && isSourceVisible(preference, source));
}

export function pickSourceRow<T extends { source: string }>(
  rows: readonly T[], preference: SourcePreference, defaults: readonly string[], hasData: (row: T) => boolean,
): T | null {
  const order = rankSources(preference, defaults);
  return rows.filter((row) => isSourceVisible(preference, row.source) && hasData(row))
    .sort((a, b) => sourceRankIndex(a.source, order) - sourceRankIndex(b.source, order))[0] ?? null;
}

function sourceRankIndex(source: string, order: string[]): number {
  const idx = order.indexOf(source);
  return idx >= 0 ? idx : order.length + 1;
}

export function sessionBoundsMs(w: { startTime: Date | null; endTime: Date | null; durationSeconds: number | null }): { start: number; end: number } | null {
  if (!w.startTime) return null;
  const start = w.startTime.getTime();
  const end = w.endTime ? w.endTime.getTime() : start + Math.max(0, w.durationSeconds ?? 0) * 1000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

type WorkoutWindow = {
  startTime: Date | null;
  endTime: Date | null;
  durationSeconds: number | null;
  exerciseType?: string;
  title?: string;
};

export function workoutCategory(workout: Pick<WorkoutWindow, "exerciseType" | "title">) {
  const type = workout.exerciseType?.trim().toLowerCase().replace(/[_-]/g, " ") ?? "";
  const title = workout.title?.trim().toLowerCase() ?? "";
  const category = (word: string) => {
    if (/strength|weightlifting|weight train|resistance|crossfit|calisthenic|weight lift/.test(word)) return "strength";
    if (/run|jog/.test(word)) return "run";
    if (/walk|hik/.test(word)) return "walk";
    if (/cycl|bike|bik/.test(word)) return "cycle";
    if (/swim/.test(word)) return "swim";
    if (/row(ing|er)?\b/.test(word)) return "row";
    return null;
  };
  return category(type) ?? category(title) ?? (type && !/^(workout|exercise|activity|other|unknown|generic|\d+)$/.test(type) ? type : null);
}

export function workoutsOverlap(a: WorkoutWindow, b: WorkoutWindow): boolean {
  const ba = sessionBoundsMs(a);
  const bb = sessionBoundsMs(b);
  if (!ba || !bb) return false;
  const aCategory = workoutCategory(a);
  const bCategory = workoutCategory(b);
  if (aCategory && bCategory && aCategory !== bCategory) return false;
  const overlap = Math.min(ba.end, bb.end) - Math.max(ba.start, bb.start);
  const longest = Math.max(ba.end - ba.start, bb.end - bb.start);
  return overlap >= longest * (aCategory && bCategory ? 0.7 : 0.8);
}

/**
 * Deduplicates simultaneous workouts logged by multiple wearables (e.g. Apple Watch + Fitbit)
 * while preserving separate non-overlapping workouts (e.g. Fitbit off for Apple Watch run).
 */
export function dedupeWorkoutsAcrossSources<
  T extends WorkoutWindow & { source: string; sessionId: string },
>(workouts: T[], primaryWorkoutSource?: SourcePreference): T[] {
  const visible = workouts.filter((row) => isSourceVisible(primaryWorkoutSource, row.source));
  if (visible.length <= 1) return visible;
  const order = rankSources(primaryWorkoutSource, DEFAULT_WORKOUT_PRIORITY);
  const ranked = visible.sort((a, b) => {
    const ra = sourceRankIndex(a.source, order);
    const rb = sourceRankIndex(b.source, order);
    if (ra !== rb) return ra - rb;
    const da = a.durationSeconds ?? 0;
    const db = b.durationSeconds ?? 0;
    if (da !== db) return db - da;
    return (a.startTime?.getTime() ?? 0) - (b.startTime?.getTime() ?? 0);
  });

  const kept: T[] = [];
  for (const w of ranked) {
    if (kept.some((k) => workoutsOverlap(k, w))) continue;
    kept.push(w);
  }
  return kept.sort((a, b) => (a.startTime?.getTime() ?? 0) - (b.startTime?.getTime() ?? 0));
}

function toMs(val: Date | string): number {
  return val instanceof Date ? val.getTime() : new Date(val).getTime();
}

/**
 * Selects HR samples inside [startMs, endMs] from one cohesive sensor source to prevent interleaving.
 */
export function selectHrSamplesForWindow<T extends { source?: string; recordedAt: Date | string; bpm: number }>(
  samples: T[],
  startMs: number,
  endMs: number,
  preferredSource?: SourcePreference,
): T[] {
  const inside = samples.filter((s) => {
    const t = toMs(s.recordedAt);
    return t >= startMs && t <= endMs && isSourceVisible(preferredSource, s.source ?? "unknown");
  });
  if (inside.length <= 1) return inside;

  const bySource = new Map<string, T[]>();
  for (const s of inside) {
    const key = s.source ?? "unknown";
    const list = bySource.get(key) ?? [];
    list.push(s);
    bySource.set(key, list);
  }
  if (bySource.size <= 1) return inside;

  const requested = rankSources(preferredSource, []);
  for (const source of requested) {
    const pref = bySource.get(source);
    if (pref?.length) return pref;
  }

  let best: T[] = inside;
  let bestCount = -1;
  for (const list of bySource.values()) {
    if (list.length > bestCount) {
      best = list;
      bestCount = list.length;
    }
  }
  return best;
}

/**
 * Buckets a full day's HR samples into 15-minute windows and takes one prioritized source per window
 * so swapping watches mid-day fills gaps cleanly without interleaving simultaneous streams.
 */
export function selectDailyHrStream<T extends { source?: string; recordedAt: Date | string; bpm: number }>(
  samples: T[],
  primarySource?: SourcePreference,
): T[] {
  samples = samples.filter((sample) => isSourceVisible(primarySource, sample.source ?? "unknown"));
  if (samples.length <= 1) return samples;
  const sources = new Set(samples.map((s) => s.source ?? "unknown"));
  if (sources.size <= 1) return samples;

  const order = rankSources(primarySource, DEFAULT_RECOVERY_PRIORITY);
  const bucketSizeMs = 15 * 60 * 1000;
  const buckets = new Map<number, Map<string, T[]>>();

  for (const s of samples) {
    const t = toMs(s.recordedAt);
    const bucket = Math.floor(t / bucketSizeMs);
    const src = s.source ?? "unknown";
    const srcMap = buckets.get(bucket) ?? new Map<string, T[]>();
    const list = srcMap.get(src) ?? [];
    list.push(s);
    srcMap.set(src, list);
    buckets.set(bucket, srcMap);
  }

  const out: T[] = [];
  for (const [, srcMap] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    let chosen: T[] = [];
    let chosenRank = Infinity;
    for (const [src, list] of srcMap.entries()) {
      const rank = sourceRankIndex(src, order);
      if (rank < chosenRank || (rank === chosenRank && list.length > chosen.length)) {
        chosen = list;
        chosenRank = rank;
      }
    }
    out.push(...chosen);
  }
  return out.sort((a, b) => toMs(a.recordedAt) - toMs(b.recordedAt));
}

export function selectStepIntervalsForEnergySource<T extends { source: string; startTime: Date; endTime: Date; steps: number }>(
  rows: T[],
  energySource: string | null | undefined,
): T[] {
  if (rows.length === 0) return [];
  if (energySource) {
    const matching = rows.filter((r) => r.source === energySource);
    if (matching.length > 0) return matching;
    // Prevent subtracting a secondary watch's steps from a primary watch's daily total that came from another device.
    return [];
  }
  const order = rankSources(null, DEFAULT_ENERGY_PRIORITY);
  const sorted = [...rows].sort((a, b) => sourceRankIndex(a.source, order) - sourceRankIndex(b.source, order));
  const primarySrc = sorted[0]?.source;
  return primarySrc ? rows.filter((r) => r.source === primarySrc) : rows;
}

function hasRecoveryVitals(row: {
  hrvRmssdMs?: number | null;
  restingHrBpm?: number | null;
  respiratoryRate?: number | null;
  skinTempDeltaC?: number | null;
}): boolean {
  return (
    row.hrvRmssdMs != null ||
    row.restingHrBpm != null ||
    row.respiratoryRate != null ||
    row.skinTempDeltaC != null
  );
}

/**
 * Picks one authoritative recovery row per day using configured source priority rather than latest syncedAt,
 * preventing secondary partial rows (e.g. VO2 max only) from clobbering primary sleep/HRV recovery and baselines.
 */
export function pickRecoveryRowForDay<
  T extends {
    source: string;
    day: string;
    syncedAt: Date;
    hrvRmssdMs?: number | null;
    restingHrBpm?: number | null;
    respiratoryRate?: number | null;
    skinTempDeltaC?: number | null;
  },
>(rows: T[], primaryRecoverySource?: SourcePreference): Map<string, T> {
  const order = rankSources(primaryRecoverySource, DEFAULT_RECOVERY_PRIORITY);
  const byDay = new Map<string, T>();

  const sorted = rows.filter((r) => isSourceVisible(primaryRecoverySource, r.source)).sort((a, b) => {
    const aHas = hasRecoveryVitals(a) ? 0 : 1;
    const bHas = hasRecoveryVitals(b) ? 0 : 1;
    if (aHas !== bHas) return aHas - bHas;
    const ra = sourceRankIndex(a.source, order);
    const rb = sourceRankIndex(b.source, order);
    if (ra !== rb) return ra - rb;
    return b.syncedAt.getTime() - a.syncedAt.getTime();
  });

  for (const row of sorted) {
    if (!byDay.has(row.day)) {
      byDay.set(row.day, row);
    }
  }
  return byDay;
}

export function pickDailyEnergyRow<T extends { source: string; totalKcal?: number | null; steps?: number | null }>(
  rows: T[],
  primarySource?: SourcePreference,
): T | null {
  if (rows.length === 0) return null;
  const order = rankSources(primarySource, DEFAULT_ENERGY_PRIORITY);
  return rows.filter((r) => isSourceVisible(primarySource, r.source)).sort((a, b) => {
    const ra = sourceRankIndex(a.source, order);
    const rb = sourceRankIndex(b.source, order);
    if (ra !== rb) return ra - rb;
    const aCompleteness = (a.totalKcal != null ? 2 : 0) + (a.steps != null ? 1 : 0);
    const bCompleteness = (b.totalKcal != null ? 2 : 0) + (b.steps != null ? 1 : 0);
    return bCompleteness - aCompleteness;
  })[0] ?? null;
}

/** Fill gaps field by field while retaining the origin of each recovery reading. */
export function applyRecoverySourceSettings<T extends { source: string } & Record<RecoveryField, number | null>>(
  rows: readonly T[], base: T | null, settings: SourceSettings, legacy?: string,
): (T & { metricSources?: Partial<Record<RecoveryField, string>> }) | null {
  const result = base ? { ...base } : rows[0] ? { ...rows[0] } : null;
  if (!result) return null;
  const metricSources: Partial<Record<RecoveryField, string>> = {};
  for (const field of RECOVERY_FIELDS) {
    const chosen = settings[field] || base?.[field] == null
      ? pickSourceRow(rows, metricPreference(settings, field, legacy), DEFAULT_RECOVERY_PRIORITY, (row) => row[field] != null)
      : base;
    result[field] = chosen?.[field] ?? null;
    if (chosen) metricSources[field] = chosen.source;
  }
  return Object.keys(metricSources).length ? { ...result, metricSources } : null;
}

export function selectRecoveryByDay<T extends { source: string; day: string; syncedAt: Date } & Record<RecoveryField, number | null>>(
  rows: T[], settings: SourceSettings, legacy?: string,
) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const day = groups.get(row.day) ?? [];
    day.push(row);
    groups.set(row.day, day);
  }
  const selected = pickRecoveryRowForDay(rows, legacy);
  return new Map([...groups].map(([day, items]) => [day, applyRecoverySourceSettings(items, selected.get(day) ?? null, settings, legacy)]));
}
