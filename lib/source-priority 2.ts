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
};

export function formatSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function rankSources(preferred: string | null | undefined, defaults: readonly string[]): string[] {
  const cleanPref = preferred && preferred !== "auto" ? preferred.trim().toLowerCase() : null;
  const order: string[] = [];
  if (cleanPref) order.push(cleanPref);
  for (const s of defaults) {
    if (!order.includes(s)) order.push(s);
  }
  return order;
}

function sourceRankIndex(source: string, order: string[]): number {
  const idx = order.indexOf(source);
  return idx >= 0 ? idx : order.length + 1;
}

function sessionBoundsMs(w: { startTime: Date | null; endTime: Date | null; durationSeconds: number | null }): { start: number; end: number } | null {
  if (!w.startTime) return null;
  const start = w.startTime.getTime();
  const end = w.endTime ? w.endTime.getTime() : start + Math.max(0, w.durationSeconds ?? 0) * 1000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

export function workoutsOverlap(
  a: { startTime: Date | null; endTime: Date | null; durationSeconds: number | null },
  b: { startTime: Date | null; endTime: Date | null; durationSeconds: number | null },
): boolean {
  const ba = sessionBoundsMs(a);
  const bb = sessionBoundsMs(b);
  if (!ba || !bb) return false;
  const overlap = Math.min(ba.end, bb.end) - Math.max(ba.start, bb.start);
  if (overlap <= 0) return false;
  const shorter = Math.min(ba.end - ba.start, bb.end - bb.start);
  if (shorter <= 0) return false;
  if (overlap / shorter >= 0.5) return true;
  return Math.abs(ba.start - bb.start) <= 10 * 60 * 1000;
}

/**
 * Deduplicates simultaneous workouts logged by multiple wearables (e.g. Apple Watch + Fitbit)
 * while preserving separate non-overlapping workouts (e.g. Fitbit off for Apple Watch run).
 */
export function dedupeWorkoutsAcrossSources<
  T extends { source: string; sessionId: string; startTime: Date | null; endTime: Date | null; durationSeconds: number | null },
>(workouts: T[], primaryWorkoutSource?: string | null): T[] {
  if (workouts.length <= 1) return workouts;
  const order = rankSources(primaryWorkoutSource, DEFAULT_WORKOUT_PRIORITY);
  const ranked = [...workouts].sort((a, b) => {
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
  preferredSource?: string | null,
): T[] {
  const inside = samples.filter((s) => {
    const t = toMs(s.recordedAt);
    return t >= startMs && t <= endMs;
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

  if (preferredSource && preferredSource !== "auto") {
    const pref = bySource.get(preferredSource);
    if (pref && pref.length > 0) return pref;
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
  primarySource?: string | null,
): T[] {
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
>(rows: T[], primaryRecoverySource?: string | null): Map<string, T> {
  const order = rankSources(primaryRecoverySource, DEFAULT_RECOVERY_PRIORITY);
  const byDay = new Map<string, T>();

  const sorted = [...rows].sort((a, b) => {
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
  primarySource?: string | null,
): T | null {
  if (rows.length === 0) return null;
  const order = rankSources(primarySource, DEFAULT_ENERGY_PRIORITY);
  return [...rows].sort((a, b) => {
    const ra = sourceRankIndex(a.source, order);
    const rb = sourceRankIndex(b.source, order);
    if (ra !== rb) return ra - rb;
    const aCompleteness = (a.totalKcal != null ? 2 : 0) + (a.steps != null ? 1 : 0);
    const bCompleteness = (b.totalKcal != null ? 2 : 0) + (b.steps != null ? 1 : 0);
    return bCompleteness - aCompleteness;
  })[0] ?? null;
}
