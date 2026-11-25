import { addDays } from "./nutrition-model";

// ---------------------------------------------------------------------------
// 1. Winsorized EWMA Personal Baselines (from Pulse scoring/baselines.ts)
// ---------------------------------------------------------------------------

export type BaselineStatus = "calibrating" | "provisional" | "trusted" | "stale";

export interface BaselineState {
  baseline: number;
  spread: number;
  nValid: number;
  nightsSinceUpdate: number;
  status: BaselineStatus;
}

export interface MetricCfg {
  minVal: number;
  maxVal: number;
  floorSpread: number;
  halfLifeB: number;
  halfLifeS: number;
}

const cfg = (minVal: number, maxVal: number, floorSpread: number): MetricCfg => ({
  minVal,
  maxVal,
  floorSpread,
  halfLifeB: 14.0,
  halfLifeS: 21.0,
});

export const PULSE_METRIC_CFG = {
  hrv: cfg(5.0, 250.0, 5.0),
  restingHr: cfg(30.0, 120.0, 2.0),
  resp: cfg(4.0, 40.0, 0.5),
  skinTempDev: cfg(-5.0, 5.0, 0.3),
  strain: cfg(0.0, 100.0, 5.0),
  readinessHrvLn: cfg(Math.log(5), Math.log(250), 0.08),
  daytimeHr: cfg(35.0, 160.0, 3.0),
} satisfies Record<string, MetricCfg>;

const WINSOR_K = 3.0;
const HARD_OUTLIER_K = 5.0;
const MIN_NIGHTS_SEED = 4;
const MIN_NIGHTS_TRUST = 14;
const STALE_DAYS = 14;
const EARLY_ADAPT_NIGHTS = 8;
const EARLY_HALF_LIFE_B = 3.0;
const EARLY_SPREAD_INFLATE = 2.5;

const lambda = (halfLife: number) => 1.0 - 0.5 ** (1.0 / halfLife);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

function baselineStatus(nValid: number, nightsSinceUpdate: number): BaselineStatus {
  if (nightsSinceUpdate > STALE_DAYS && nValid >= MIN_NIGHTS_SEED) return "stale";
  if (nValid < MIN_NIGHTS_SEED) return "calibrating";
  if (nValid < MIN_NIGHTS_TRUST) return "provisional";
  return "trusted";
}

export function updateBaseline(
  prev: BaselineState | null,
  value: number | null,
  metricCfg: MetricCfg,
  rejectHardOutliers = true,
): BaselineState {
  const valid = value != null && Number.isFinite(value) && value >= metricCfg.minVal && value <= metricCfg.maxVal;
  if (prev == null) {
    if (valid) {
      return { baseline: value, spread: metricCfg.floorSpread, nValid: 1, nightsSinceUpdate: 0, status: "calibrating" };
    }
    return {
      baseline: (metricCfg.minVal + metricCfg.maxVal) / 2,
      spread: metricCfg.floorSpread,
      nValid: 0,
      nightsSinceUpdate: 1,
      status: "calibrating",
    };
  }

  if (!valid) {
    const nextNights = prev.nightsSinceUpdate + 1;
    return { ...prev, nightsSinceUpdate: nextNights, status: baselineStatus(prev.nValid, nextNights) };
  }

  if (prev.nValid === 0) {
    return { baseline: value, spread: metricCfg.floorSpread, nValid: 1, nightsSinceUpdate: 0, status: "calibrating" };
  }

  const isYoung = prev.nValid < EARLY_ADAPT_NIGHTS;
  if (rejectHardOutliers && prev.nValid >= MIN_NIGHTS_SEED && !isYoung) {
    if (Math.abs(value - prev.baseline) > HARD_OUTLIER_K * prev.spread) {
      const missed = prev.nightsSinceUpdate + 1;
      return { ...prev, nightsSinceUpdate: missed, status: baselineStatus(prev.nValid, missed) };
    }
  }

  const effSpread = isYoung ? prev.spread * EARLY_SPREAD_INFLATE : prev.spread;
  const effLb = isYoung ? lambda(EARLY_HALF_LIFE_B) : lambda(metricCfg.halfLifeB);
  const ls = lambda(metricCfg.halfLifeS);
  const clamped = clamp(value, prev.baseline - WINSOR_K * effSpread, prev.baseline + WINSOR_K * effSpread);
  const nextBaseline = effLb * clamped + (1 - effLb) * prev.baseline;
  const nextSpread = Math.max(metricCfg.floorSpread, ls * Math.abs(value - nextBaseline) + (1 - ls) * prev.spread);
  const nextValid = prev.nValid + 1;

  return {
    baseline: nextBaseline,
    spread: nextSpread,
    nValid: nextValid,
    nightsSinceUpdate: 0,
    status: baselineStatus(nextValid, 0),
  };
}

export function foldBaselineSeries(
  values: (number | null | undefined)[],
  metricCfg: MetricCfg,
  rejectHardOutliers = true,
): BaselineState | null {
  let state: BaselineState | null = null;
  for (const v of values) {
    state = updateBaseline(state, v ?? null, metricCfg, rejectHardOutliers);
  }
  return state;
}

// ---------------------------------------------------------------------------
// 2. Pulse Recovery Engine & Drivers (scoring/recovery.ts)
// ---------------------------------------------------------------------------

export interface PulseRecoveryDriver {
  key: "hrv" | "rhr" | "sleep" | "resp" | "skinTemp";
  label: string;
  valueText: string;
  baselineText: string | null;
  zScore: number | null;
  impactPts: number;
  tone: "good" | "warn" | "bad" | "neutral";
}

export interface PulseRecoveryResult {
  score: number | null;
  band: "optimal" | "moderate" | "strained" | "unavailable";
  baselineStatus: BaselineStatus | "unavailable";
  availability: "waiting_for_sleep" | "partial" | "calibrating" | "stale" | "available";
  algorithmVersion: "readiness-v2-experimental";
  drivers: PulseRecoveryDriver[];
  summary: string;
}

export interface PulseRecoveryDayInput {
  hrvRmssdMs: number | null;
  restingHrBpm: number | null;
  respiratoryRate: number | null;
  skinTempDeltaC: number | null;
  sleepHours: number | null;
  source?: string;
}

export function computePulseRecovery(
  today: PulseRecoveryDayInput,
  priorDays: PulseRecoveryDayInput[],
  sleepNeedHours = 8.0,
): PulseRecoveryResult {
  priorDays = priorDays.map((d) => today.source && d.source !== today.source ? { ...d, hrvRmssdMs: null, restingHrBpm: null, respiratoryRate: null, skinTempDeltaC: null } : d);
  const hrvBase = foldBaselineSeries(
    priorDays.map((d) => (d.sleepHours != null && d.sleepHours > 0 && d.hrvRmssdMs != null && d.hrvRmssdMs > 0 ? Math.log(d.hrvRmssdMs) : null)),
    PULSE_METRIC_CFG.readinessHrvLn,
    false,
  );
  const rhrBase = foldBaselineSeries(priorDays.map((d) => d.sleepHours != null && d.sleepHours > 0 ? d.restingHrBpm : null), PULSE_METRIC_CFG.restingHr);
  const respBase = foldBaselineSeries(priorDays.map((d) => d.respiratoryRate), PULSE_METRIC_CFG.resp);
  const tempBase = foldBaselineSeries(priorDays.map((d) => d.skinTempDeltaC), PULSE_METRIC_CFG.skinTempDev);

  const valid = (value: number | null, config: MetricCfg) => value != null && Number.isFinite(value) && value >= config.minVal && value <= config.maxVal;
  const baselineState: BaselineStatus = hrvBase?.status === "stale" || rhrBase?.status === "stale" ? "stale"
    : hrvBase?.status === "trusted" && rhrBase?.status === "trusted" ? "trusted"
    : (hrvBase?.nValid ?? 0) >= MIN_NIGHTS_SEED && (rhrBase?.nValid ?? 0) >= MIN_NIGHTS_SEED ? "provisional" : "calibrating";
  const availability: PulseRecoveryResult["availability"] = !(today.sleepHours != null && Number.isFinite(today.sleepHours) && today.sleepHours > 0 && today.sleepHours <= 24) ? "waiting_for_sleep"
    : !valid(today.hrvRmssdMs, PULSE_METRIC_CFG.hrv) || !valid(today.restingHrBpm, PULSE_METRIC_CFG.restingHr) ? "partial"
    : baselineState === "stale" ? "stale" : baselineState === "calibrating" ? "calibrating" : "available";
  if (availability !== "available") return {
    score: null, band: "unavailable", baselineStatus: baselineState, availability,
    algorithmVersion: "readiness-v2-experimental", drivers: [],
    summary: availability === "waiting_for_sleep" ? "Waiting for a completed main sleep session."
      : availability === "partial" ? "Sleep, valid RMSSD HRV and resting heart rate are all required."
      : availability === "stale" ? "Personal HRV or resting heart rate baseline is stale."
      : "Calibrating: at least four accepted prior HRV and resting heart rate observations are required.",
  };

  const parts: Array<{ key: PulseRecoveryDriver["key"]; label: string; weight: number; z: number | null; score: number; valueText: string; baselineText: string | null }> = [];

  if (today.hrvRmssdMs != null && today.hrvRmssdMs > 0) {
    const lnHrv = Math.log(today.hrvRmssdMs);
    const hasBase = hrvBase != null && hrvBase.nValid >= MIN_NIGHTS_SEED && hrvBase.status !== "stale";
    const z = hasBase ? clamp((lnHrv - hrvBase!.baseline) / Math.max(0.08, hrvBase!.spread), -3, 3) : null;
    const sub = z != null ? clamp(72 + z * 18, 10, 100) : 0;
    parts.push({
      key: "hrv",
      label: "HRV",
      weight: 0.55,
      z,
      score: sub,
      valueText: `${Math.round(today.hrvRmssdMs)} ms`,
      baselineText: hasBase ? `${Math.round(Math.exp(hrvBase!.baseline))} ms` : null,
    });
  }

  if (today.restingHrBpm != null && today.restingHrBpm > 0) {
    const hasBase = rhrBase != null && rhrBase.nValid >= MIN_NIGHTS_SEED && rhrBase.status !== "stale";
    // Lower RHR than baseline is positive z
    const z = hasBase ? clamp((rhrBase!.baseline - today.restingHrBpm) / Math.max(2.0, rhrBase!.spread), -3, 3) : null;
    const sub = z != null ? clamp(72 + z * 16, 10, 100) : 0;
    parts.push({
      key: "rhr",
      label: "Resting HR",
      weight: 0.2,
      z,
      score: sub,
      valueText: `${Math.round(today.restingHrBpm)} bpm`,
      baselineText: hasBase ? `${Math.round(rhrBase!.baseline)} bpm` : null,
    });
  }

  if (today.sleepHours != null && today.sleepHours > 0) {
    const goal = Number.isFinite(sleepNeedHours) && sleepNeedHours >= 4 && sleepNeedHours <= 12 ? sleepNeedHours : 8;
    const ratio = today.sleepHours / goal;
    const z = clamp((ratio - 0.92) / 0.14, -2.5, 2.5);
    const sub = clamp(ratio * 92, 18, 100);
    const h = Math.floor(today.sleepHours);
    const m = Math.round((today.sleepHours - h) * 60);
    parts.push({
      key: "sleep",
      label: "Sleep",
      weight: 0.15,
      z,
      score: sub,
      valueText: `${h}h ${m}m`,
      baselineText: `${sleepNeedHours.toFixed(1)}h need`,
    });
  }

  if (valid(today.respiratoryRate, PULSE_METRIC_CFG.resp) && respBase != null && respBase.nValid >= MIN_NIGHTS_SEED && respBase.status !== "stale") {
    const hasBase = respBase != null && respBase.nValid >= MIN_NIGHTS_SEED;
    const z = hasBase ? clamp((respBase!.baseline - today.respiratoryRate) / Math.max(0.5, respBase!.spread), -3, 3) : null;
    const sub = z != null ? clamp(75 + z * 12, 20, 100) : 75;
    parts.push({
      key: "resp",
      label: "Resp Rate",
      weight: 0.05,
      z,
      score: sub,
      valueText: `${today.respiratoryRate!.toFixed(1)} rpm`,
      baselineText: hasBase ? `${respBase!.baseline.toFixed(1)} rpm` : null,
    });
  }

  if (today.skinTempDeltaC != null && valid(today.skinTempDeltaC, PULSE_METRIC_CFG.skinTempDev) && tempBase != null && tempBase.nValid >= MIN_NIGHTS_SEED && tempBase.status !== "stale") {
    const hasBase = tempBase != null && tempBase.nValid >= MIN_NIGHTS_SEED;
    const dev = hasBase ? Math.abs(today.skinTempDeltaC - tempBase!.baseline) : Math.abs(today.skinTempDeltaC);
    const z = hasBase ? clamp(-(dev / Math.max(0.3, tempBase!.spread)), -3, 0) : null;
    const sub = clamp(85 - dev * 18, 25, 95);
    parts.push({
      key: "skinTemp",
      label: "Skin Temp",
      weight: 0.05,
      z,
      score: sub,
      valueText: `${today.skinTempDeltaC >= 0 ? "+" : ""}${today.skinTempDeltaC.toFixed(1)}°C`,
      baselineText: hasBase ? `${tempBase!.baseline >= 0 ? "+" : ""}${tempBase!.baseline.toFixed(1)}°C` : null,
    });
  }

  if (parts.length === 0) {
    return {
      score: null,
      band: "unavailable",
      baselineStatus: "unavailable",
      availability: "partial", algorithmVersion: "readiness-v2-experimental",
      drivers: [],
      summary: "Sync Google Health (Fitbit) to compute Pulse Recovery.",
    };
  }

  const totalW = parts.reduce((s, p) => s + p.weight, 0);
  const rawScore = parts.reduce((s, p) => s + p.score * p.weight, 0) / Math.max(0.01, totalW);
  const score = Math.round(clamp(rawScore, 1, 100));
  const band = score >= 67 ? "optimal" : score >= 34 ? "moderate" : "strained";

  const drivers: PulseRecoveryDriver[] = parts.map((p) => {
    const impactPts = Math.round(((p.score - 70) * p.weight) / Math.max(0.01, totalW));
    const tone: PulseRecoveryDriver["tone"] =
      p.z != null ? (p.z >= 0.4 ? "good" : p.z <= -0.6 ? "bad" : p.z < 0 ? "warn" : "neutral") : p.score >= 70 ? "good" : p.score < 50 ? "warn" : "neutral";
    return {
      key: p.key,
      label: p.label,
      valueText: p.valueText,
      baselineText: p.baselineText,
      zScore: p.z != null ? round2(p.z) : null,
      impactPts,
      tone,
    };
  });


  return {
    score,
    band,
    baselineStatus: baselineState,
    availability, algorithmVersion: "readiness-v2-experimental",
    drivers,
    summary: `Experimental readiness index ${score}/100 (${band}) · ${drivers.map((d) => `${d.label} ${d.valueText}`).slice(0, 3).join(" · ")}`,
  };
}

// ---------------------------------------------------------------------------
// 3. Sleep Score, Sleep Regularity Index (SRI) & Sleep Planner
// ---------------------------------------------------------------------------

export interface SleepNightRecord {
  day: string;
  sleepStart: Date | null;
  sleepEnd: Date | null;
  minutesAsleep: number;
  minutesAwake: number | null;
  deepMinutes: number | null;
  remMinutes: number | null;
  lightMinutes?: number | null;
  isMainSleep?: boolean;
  coverageComplete?: boolean;
}

export interface PulseSleepResult {
  score: number | null;
  durationPct: number | null;
  efficiencyPct: number | null;
  restorativePct: number | null;
  deepPct: number | null;
  remPct: number | null;
  sri: number | null;
  scheduleVariabilityMinutes: number | null;
  sleepNeedHours: number;
  sleepDebtHours: number | null;
  observedDays: number;
  debtCoverage: "complete" | "partial" | "unavailable";
  scoreCoverage: string[];
  algorithmVersion: "sleep-v2-experimental";
  recommendedBedtime: string | null;
  recommendedWakeTime: string | null;
}

/** Session endpoints cannot establish minute-by-minute sleep/wake coverage for SRI. */
export function computeSleepRegularity(_nights: SleepNightRecord[], _anchorDay: string): number | null {
  return null;
}

function minuteOfDayLocal(d: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  return Number(parts.find((p) => p.type === "hour")!.value) * 60 + Number(parts.find((p) => p.type === "minute")!.value);
}
function circularDistance(a: number, b: number) { return Math.min(Math.abs(a - b), 1440 - Math.abs(a - b)); }
function circularMedian(values: number[]): number | null {
  return values.length ? [...values].sort((a, b) => values.reduce((s, v) => s + circularDistance(a, v), 0) - values.reduce((s, v) => s + circularDistance(b, v), 0) || a - b)[0] : null;
}
function fmtMinutesHHMM(mins: number): string {
  const norm = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(norm / 60)).padStart(2, "0")}:${String(norm % 60).padStart(2, "0")}`;
}

/** Drop overlapping provider sessions rather than double-crediting their durations. */
export function selectNonOverlappingSleepSessions(nights: SleepNightRecord[], now = new Date()): SleepNightRecord[] {
  const candidates = nights.filter((n) => n.sleepStart && n.sleepEnd && n.sleepEnd > n.sleepStart && n.sleepEnd <= now
    && Number.isFinite(n.minutesAsleep) && n.minutesAsleep > 0 && n.minutesAsleep <= (n.sleepEnd.getTime() - n.sleepStart.getTime()) / 60000 + 1)
    .sort((a, b) => Number(b.isMainSleep !== false) - Number(a.isMainSleep !== false) || b.minutesAsleep - a.minutesAsleep || a.sleepStart!.getTime() - b.sleepStart!.getTime());
  const kept: SleepNightRecord[] = [];
  for (const n of candidates) {
    if (kept.some((k) => n.sleepStart! < k.sleepEnd! && n.sleepEnd! > k.sleepStart!)) continue;
    kept.push(n);
  }
  return kept.sort((a, b) => a.sleepStart!.getTime() - b.sleepStart!.getTime());
}

export function computeSleepInsights(
  todaySleep: SleepNightRecord | null,
  recentNights: SleepNightRecord[],
  anchorDay: string,
  _yesterdayStrain: number | null,
  options: { timezone?: string; goalHours?: number; goalForDay?: (day: string) => number; now?: Date } = {},
): PulseSleepResult {
  const goalForDay = (day: string) => {
    const g = options.goalForDay?.(day) ?? options.goalHours ?? 8;
    return Number.isFinite(g) && g >= 4 && g <= 12 ? g : 8;
  };
  const sleepNeedHours = goalForDay(anchorDay);
  const last7 = selectNonOverlappingSleepSessions(recentNights, options.now).filter((n) => n.day >= addDays(anchorDay, -6) && n.day <= anchorDay);
  const days = new Map<string, { minutes: number; complete: boolean }>();
  // A nap does not establish that the main night was observed. Never treat that missing night as zero sleep.
  const observedMainDays = new Set(last7.filter((n) => n.isMainSleep !== false).map((n) => n.day));
  for (const n of last7) {
    if (!observedMainDays.has(n.day)) continue;
    const previous = days.get(n.day);
    days.set(n.day, { minutes: (previous?.minutes ?? 0) + n.minutesAsleep, complete: (previous?.complete ?? true) && n.coverageComplete === true });
  }
  const observedDays = days.size;
  const debtCoverage: PulseSleepResult["debtCoverage"] = !observedDays ? "unavailable" : observedDays === 7 && [...days.values()].every((d) => d.complete) ? "complete" : "partial";
  // An observed shortfall, never a claim of zero debt on unobserved days. Naps count once.
  const debt = observedDays ? round1(Math.max(0, [...days].reduce((sum, [day, d]) => sum + goalForDay(day) - d.minutes / 60, 0))) : null;
  const wakeMins = last7.filter((n) => n.isMainSleep !== false).map((n) => minuteOfDayLocal(n.sleepEnd!, options.timezone ?? "Europe/London"));
  const medianWake = circularMedian(wakeMins);
  const scheduleVariabilityMinutes = wakeMins.length >= 3 && medianWake != null ? Math.round(wakeMins.reduce((s, m) => s + circularDistance(m, medianWake), 0) / wakeMins.length) : null;
  const common = {
    sri: null, scheduleVariabilityMinutes, sleepNeedHours, sleepDebtHours: debt, observedDays, debtCoverage,
    algorithmVersion: "sleep-v2-experimental" as const,
    recommendedWakeTime: medianWake == null ? null : fmtMinutesHHMM(medianWake),
    recommendedBedtime: medianWake == null ? null : fmtMinutesHHMM(medianWake - sleepNeedHours * 60),
  };
  const validToday = todaySleep && todaySleep.day === anchorDay && todaySleep.isMainSleep !== false && selectNonOverlappingSleepSessions([todaySleep], options.now).length > 0;
  if (!validToday) return { ...common, score: null, durationPct: null, efficiencyPct: null, restorativePct: null, deepPct: null, remPct: null, scoreCoverage: [] };
  const asleepMin = todaySleep.minutesAsleep;
  const durationPct = Math.round(clamp(asleepMin / (sleepNeedHours * 60) * 100, 0, 100));
  const awake = todaySleep.minutesAwake;
  const intervalMinutes = (todaySleep.sleepEnd!.getTime() - todaySleep.sleepStart!.getTime()) / 60000;
  const efficiencyPct = awake != null && Number.isFinite(awake) && awake >= 0 && asleepMin + awake <= intervalMinutes + 1 ? Math.round(asleepMin / (asleepMin + awake) * 100) : null;
  const stagePct = (minutes: number | null) => minutes != null && Number.isFinite(minutes) && minutes >= 0 && minutes <= asleepMin ? round1(minutes / asleepMin * 100) : null;
  let deepPct = stagePct(todaySleep.deepMinutes), remPct = stagePct(todaySleep.remMinutes);
  const reportedStages = [todaySleep.deepMinutes, todaySleep.remMinutes, todaySleep.lightMinutes].filter((m): m is number => m != null);
  if (reportedStages.some((m) => !Number.isFinite(m) || m < 0) || reportedStages.reduce((sum, m) => sum + m, 0) > asleepMin + 1) { deepPct = null; remPct = null; }
  const restorativePct = deepPct != null && remPct != null ? round1(deepPct + remPct) : null;
  // Stages are reported as wearable estimates; no universal ideal deep/REM ratio is assumed.
  const score = Math.round(efficiencyPct == null ? durationPct : (durationPct * .8 + efficiencyPct * .2));
  return { ...common, score, durationPct, efficiencyPct, restorativePct, deepPct, remPct,
    scoreCoverage: efficiencyPct == null ? ["duration"] : ["duration", "efficiency"] };
}

// ---------------------------------------------------------------------------
// 4. 5-Vital Health Monitor & Illness Radar (scoring/illness.ts + healthMonitor.ts)
// ---------------------------------------------------------------------------

export interface VitalCheckItem {
  key: "restingHr" | "hrv" | "resp" | "spo2" | "skinTempDev";
  label: string;
  valueText: string;
  rangeText: string | null;
  status: "in_range" | "high" | "low" | "no_data" | "calibrating";
}

export interface PulseHealthMonitorResult {
  status: "nominal" | "watch" | "elevated" | "unavailable" | "calibrating";
  inRangeCount: number;
  availableCount: number;
  illnessRiskScore: number | null;
  vitals: VitalCheckItem[];
  note: string;
}

export function computeHealthMonitor(
  today: {
    restingHrBpm: number | null;
    hrvRmssdMs: number | null;
    respiratoryRate: number | null;
    spo2Pct: number | null;
    skinTempDeltaC: number | null;
  },
  history: Array<{
    restingHrBpm: number | null;
    hrvRmssdMs: number | null;
    respiratoryRate: number | null;
    skinTempDeltaC: number | null;
  }>,
): PulseHealthMonitorResult {
  const rhrBase = foldBaselineSeries(history.map((d) => d.restingHrBpm), PULSE_METRIC_CFG.restingHr);
  const hrvBase = foldBaselineSeries(history.map((d) => d.hrvRmssdMs), PULSE_METRIC_CFG.hrv);
  const respBase = foldBaselineSeries(history.map((d) => d.respiratoryRate), PULSE_METRIC_CFG.resp);
  const tempBase = foldBaselineSeries(history.map((d) => d.skinTempDeltaC), PULSE_METRIC_CFG.skinTempDev);

  const vitals: VitalCheckItem[] = [];
  let corroborating = 0;

  const evalBand = (
    key: VitalCheckItem["key"],
    label: string,
    val: number | null,
    unit: string,
    base: BaselineState | null,
    badDirection: "high" | "low" | "both",
    fixedRange?: [number, number],
  ) => {
    if (val == null || !Number.isFinite(val)) {
      vitals.push({ key, label, valueText: "—", rangeText: null, status: "no_data" });
      return;
    }
    const usable = base != null && base.nValid >= MIN_NIGHTS_SEED && base.status !== "stale";
    const lo = fixedRange ? fixedRange[0] : usable ? base!.baseline - 2.0 * base!.spread : null;
    const hi = fixedRange ? fixedRange[1] : usable ? base!.baseline + 2.0 * base!.spread : null;

    let status: VitalCheckItem["status"] = lo == null ? "calibrating" : "in_range";
    if (lo != null && val < lo) status = "low";
    else if (hi != null && val > hi) status = "high";

    if (status === "high" || status === "low") {
      const isBadDir =
        badDirection === "both" || (badDirection === "high" && status === "high") || (badDirection === "low" && status === "low");
      if (isBadDir) {
        corroborating += 1;

      }
    }

    vitals.push({
      key,
      label,
      valueText: `${key === "skinTempDev" && val >= 0 ? "+" : ""}${round1(val)}${unit}`,
      rangeText: lo != null && hi != null ? `${round1(lo)}–${round1(hi)}${unit}` : null,
      status,
    });
  };

  evalBand("restingHr", "Resting HR", today.restingHrBpm, " bpm", rhrBase, "high");
  evalBand("hrv", "HRV", today.hrvRmssdMs, " ms", hrvBase, "low");
  evalBand("resp", "Resp Rate", today.respiratoryRate, " rpm", respBase, "high");
  evalBand("spo2", "SpO2", today.spo2Pct, "%", null, "low", [94, 100]);
  evalBand("skinTempDev", "Skin Temp", today.skinTempDeltaC, "°C", tempBase, "both");

  const availableCount = vitals.filter((v) => v.status !== "no_data").length;
  const inRangeCount = vitals.filter((v) => v.status === "in_range").length;
  const illnessRiskScore = null; // No validated illness probability model.

  if (availableCount === 0) {
    return { status: "unavailable", inRangeCount: 0, availableCount: 0, illnessRiskScore: null, vitals, note: "Awaiting vitals sync." };
  }

  const status: PulseHealthMonitorResult["status"] =
    corroborating >= 2
      ? "elevated"
      : corroborating === 1
        ? "watch"
        : vitals.some((v) => v.status === "calibrating") ? "calibrating" : "nominal";

  const note =
    status === "elevated"
      ? `${corroborating} vitals drifted outside personal range — consider prioritizing rest.`
      : status === "watch"
        ? "1 vital slightly outside your personal baseline."
        : status === "calibrating" ? "Building personal ranges; unassessed readings are not marked normal." : `All ${availableCount} tracked vitals are within your personal range.`;

  return { status, inRangeCount, availableCount, illnessRiskScore, vitals, note };
}

// ---------------------------------------------------------------------------
// 5. Next-Day Recovery Forecast (scoring/forecast.ts)
// ---------------------------------------------------------------------------

export interface PulseForecastResult {
  predictedScore: number | null;
  low: number | null;
  high: number | null;
  confidence: "solid" | "building" | "unavailable";
  summary: string;
}

export function computeRecoveryForecast(
  recentRecoveries: (number | null)[],
  todayStrain: number | null,
  plannedSleepHours: number | null,
  sleepNeedHours: number,
): PulseForecastResult {
  void recentRecoveries; void todayStrain; void plannedSleepHours; void sleepNeedHours;
  return { predictedScore: null, low: null, high: null, confidence: "unavailable",
    summary: "Recovery prediction is unavailable: the previous heuristic and confidence bands were not validated." };
}

// ---------------------------------------------------------------------------
// 6. Biological Age ("Healthspan Age") & VO2 Max Percentile (fitnessLevel.ts + healthspan.ts)
// ---------------------------------------------------------------------------

export type BiologicalSex = "male" | "female";
export type FitnessCategory = "poor" | "fair" | "good" | "excellent" | "superior";

const FRIEND_PERCENTILES = [5, 10, 25, 50, 75, 90, 95] as const;
const FRIEND_TREADMILL: Record<BiologicalSex, readonly (readonly number[])[]> = {
  male: [
    [29.0, 32.1, 40.1, 48.0, 55.2, 61.8, 66.3],
    [27.2, 30.2, 35.9, 42.4, 49.2, 56.5, 59.8],
    [24.2, 26.8, 31.9, 37.8, 45.0, 52.1, 55.6],
    [20.9, 22.8, 27.1, 32.6, 39.7, 45.6, 50.7],
    [17.4, 19.8, 23.7, 28.2, 34.5, 40.3, 43.0],
    [16.3, 17.1, 20.4, 24.4, 30.4, 36.6, 39.7],
  ],
  female: [
    [21.7, 23.9, 30.5, 37.6, 44.7, 51.3, 56.0],
    [19.0, 20.9, 25.3, 30.2, 36.1, 41.4, 45.8],
    [17.0, 18.8, 22.1, 26.7, 32.4, 38.4, 41.7],
    [16.0, 17.3, 19.9, 23.4, 27.6, 32.0, 35.9],
    [13.4, 14.6, 17.2, 20.0, 23.8, 27.0, 29.4],
    [13.1, 13.6, 15.6, 18.3, 20.8, 23.1, 24.1],
  ],
};

function piecewiseLinear(knots: readonly (readonly [number, number])[], x: number): number {
  if (x <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [x1, y1] = knots[i];
    if (x <= x1) {
      const [x0, y0] = knots[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return knots[knots.length - 1][1];
}

export function computeFitnessLevel(
  vo2max: number | null,
  age: number | null,
  sex: BiologicalSex | null,
): { vo2max: number | null; percentile: number | null; category: FitnessCategory | null } {
  if (vo2max == null || !Number.isFinite(vo2max) || age == null || !Number.isFinite(age) || age < 20 || age >= 80 || sex == null || vo2max <= 0) {
    return { vo2max, percentile: null, category: null };
  }
  const row = FRIEND_TREADMILL[sex][Math.min(5, Math.max(0, Math.floor(age / 10) - 2))];
  const percentile = Math.round(
    piecewiseLinear(
      row.map((v, i) => [v, FRIEND_PERCENTILES[i]] as const),
      vo2max,
    ),
  );
  const category: FitnessCategory =
    percentile >= 80
      ? "superior"
      : percentile >= 60
        ? "excellent"
        : percentile >= 40
          ? "good"
          : percentile >= 20
            ? "fair"
            : "poor";
  return { vo2max: round1(vo2max), percentile, category };
}

export interface HealthspanDayInput {
  day: string;
  sleepHours?: number | null;
  sri?: number | null;
  zone13Min?: number | null;
  zone45Min?: number | null;
  strengthMin?: number | null;
  steps?: number | null;
  vo2max?: number | null;
  restingHr?: number | null;
  weightKg?: number | null;
  bodyFatPct?: number | null;
}

export interface BiologicalAgeContributor {
  key: "vo2max" | "restingHr" | "steps" | "sleepHours" | "sri" | "zone13" | "zone45" | "strength" | "leanMass";
  label: string;
  valueText: string;
  deltaYears: number;
}

export interface BiologicalAgeResult {
  status: "ready" | "provisional" | "needs_profile" | "unvalidated";
  chronologicalAge: number | null;
  biologicalAge: number | null;
  deltaYears: number | null;
  paceOfAging: number | null;
  activeDays: number;
  contributors: BiologicalAgeContributor[];
}

export function computeBiologicalAge(
  days: HealthspanDayInput[],
  profile: { age: number | null; sex: BiologicalSex | null; heightCm?: number | null },
  anchorDay: string,
): BiologicalAgeResult {
  return {
    status: profile.age == null ? "needs_profile" : "unvalidated",
    chronologicalAge: profile.age, biologicalAge: null, deltaYears: null, paceOfAging: null,
    activeDays: new Set(days.filter((d) => d.day <= anchorDay && d.day >= addDays(anchorDay, -179) && Object.entries(d).some(([k, v]) => k !== "day" && typeof v === "number" && Number.isFinite(v))).map((d) => d.day)).size,
    contributors: [],
  };
}

// ---------------------------------------------------------------------------
// 7. Energy Bank (0–100% Body Battery) & Daytime Stress (0–3)
// ---------------------------------------------------------------------------

export interface EnergyBankResult {
  currentPct: number | null;
  peakPct: number | null;
  drainedPct: number;
  status: "charged" | "steady" | "low" | "unavailable";
}

export interface DaytimeStressResult {
  avgStress: number | null;
  lowMinutes: number;
  mediumMinutes: number;
  highMinutes: number;
  band: "low" | "moderate" | "high" | "unavailable";
  observedMinutes: number;
}

export function computeEnergyBankAndStress(
  hrSamples: Array<{ recordedAt: string; bpm: number }>,
  restingHrBpm: number | null,
  maxHrBpm: number,
  recoveryScore: number | null,
  sleepScore: number | null,
  workoutIntervals: Array<{ startMs: number; endMs: number }>,
  sleepIntervals: Array<{ startMs: number; endMs: number }> = [],
): { energyBank: EnergyBankResult; stress: DaytimeStressResult } {
  recoveryScore = recoveryScore != null && Number.isFinite(recoveryScore) && recoveryScore >= 0 && recoveryScore <= 100 ? recoveryScore : null;
  sleepScore = sleepScore != null && Number.isFinite(sleepScore) && sleepScore >= 0 && sleepScore <= 100 ? sleepScore : null;
  const seed =
    recoveryScore != null && sleepScore != null
      ? Math.round(0.6 * recoveryScore + 0.4 * sleepScore)
      : recoveryScore ?? sleepScore;

  if (hrSamples.length === 0 || restingHrBpm == null || !Number.isFinite(restingHrBpm) || restingHrBpm <= 0) {
    return {
      energyBank: {
        currentPct: seed,
        peakPct: seed,
        drainedPct: 0,
        status: seed == null ? "unavailable" : seed >= 65 ? "charged" : seed >= 35 ? "steady" : "low",
      },
      stress: { avgStress: null, lowMinutes: 0, mediumMinutes: 0, highMinutes: 0, band: "unavailable", observedMinutes: 0 },
    };
  }

  const rhr = Math.max(35, Math.min(110, restingHrBpm));
  const maxHr = Math.max(rhr + 40, maxHrBpm || 190);
  const reserve = maxHr - rhr;
  const sorted = [...new Map(hrSamples.map((s) => [s.recordedAt, s])).values()]
    .map((s) => ({ ms: new Date(s.recordedAt).getTime(), bpm: s.bpm }))
    .filter((s) => Number.isFinite(s.ms) && Number.isFinite(s.bpm) && s.bpm >= 30 && s.bpm <= 240)
    .sort((a, b) => a.ms - b.ms);

  // Minute-level drain & non-workout daytime stress
  let totalDrain = 0;
  let lowMinutes = 0;
  let mediumMinutes = 0;
  let highMinutes = 0;
  let stressSum = 0;
  let stressCount = 0;

  for (let i = 1; i < sorted.length; i++) {
    const dtMin = (sorted[i].ms - sorted[i - 1].ms) / 60000;
    if (dtMin <= 0 || dtMin > 1.5) continue;
    if (sleepIntervals.some((w) => sorted[i - 1].ms < w.endMs && sorted[i].ms > w.startMs)) continue;
    const hrrFrac = Math.max(0, (sorted[i].bpm - rhr) / reserve);
    totalDrain += (0.015 + 0.14 * hrrFrac * hrrFrac + 0.04 * hrrFrac) * dtMin;

    const inWorkout = workoutIntervals.some((w) => sorted[i - 1].ms < w.endMs && sorted[i].ms > w.startMs);
    if (!inWorkout) {
      const z = (sorted[i].bpm - (rhr + 6)) / 10;
      const lvl = clamp(3 / (1 + Math.exp(-1.1 * (z - 0.5))), 0, 3);
      stressSum += lvl * dtMin;
      stressCount += dtMin;
      if (lvl < 1.0) lowMinutes += dtMin;
      else if (lvl < 2.0) mediumMinutes += dtMin;
      else highMinutes += dtMin;
    }
  }

  const peakPct = seed;
  const drainedPct = seed == null ? 0 : Math.round(clamp(totalDrain, 0, seed));
  const currentPct = seed == null ? null : Math.round(clamp(seed - drainedPct, 0, 100));

  const avgStress = stressCount > 0 ? round2(stressSum / stressCount) : null;
  const band: DaytimeStressResult["band"] =
    avgStress == null ? "unavailable" : avgStress >= 1.8 ? "high" : avgStress >= 1.0 ? "moderate" : "low";

  return {
    energyBank: {
      currentPct,
      peakPct,
      drainedPct,
      status: currentPct == null ? "unavailable" : currentPct >= 65 ? "charged" : currentPct >= 35 ? "steady" : "low",
    },
    stress: {
      avgStress,
      observedMinutes: round1(stressCount),
      lowMinutes: Math.round(lowMinutes),
      mediumMinutes: Math.round(mediumMinutes),
      highMinutes: Math.round(highMinutes),
      band,
    },
  };
}

// ---------------------------------------------------------------------------
// 8. Post-Workout Heart Rate Recovery (scoring/hrRecovery.ts)
// ---------------------------------------------------------------------------

export interface HrRecoveryResult {
  endHr: number;
  after1Minute: number | null;
  after2Minutes: number | null;
  after5Minutes: number | null;
}

export function computeHrRecovery(
  samples: Array<{ recordedAt: string; bpm: number }>,
  workoutStartMs: number,
  workoutEndMs: number,
  maxHr: number,
): HrRecoveryResult | null {
  if (workoutStartMs <= 0 || workoutEndMs <= workoutStartMs || maxHr <= 0) return null;
  const lower = Math.max(workoutStartMs, workoutEndMs - 300_000);
  const upper = workoutEndMs + 325_000;
  const sorted = [...new Map(samples.map((s) => [s.recordedAt, s])).values()]
    .map((s) => ({ ms: new Date(s.recordedAt).getTime(), bpm: s.bpm }))
    .filter((s) => Number.isFinite(s.ms) && s.ms >= lower && s.ms <= upper && s.bpm >= 30 && s.bpm <= 250)
    .sort((a, b) => a.ms - b.ms);
  if (sorted.length < 3) return null;

  const beforeEnd = sorted.filter((s) => s.ms <= workoutEndMs);
  const threshold = maxHr * 0.7;
  // Support both high-rate (<=10s) and Fitbit 1-min (<=65s) HR sampling cadences
  let runSec = 0;
  let longestSec = 0;
  for (let i = 0; i < beforeEnd.length - 1; i++) {
    const gapSec = (beforeEnd[i + 1].ms - beforeEnd[i].ms) / 1000;
    if (gapSec <= 0 || gapSec > 65 || beforeEnd[i].bpm < threshold) {
      runSec = 0;
      continue;
    }
    runSec += gapSec;
    longestSec = Math.max(longestSec, runSec);
  }
  if (longestSec < 120) return null;

  // Use the nearest measured endpoint, not the largest HR in the final minute.
  const cessation = beforeEnd[beforeEnd.length - 1];
  if (!cessation || workoutEndMs - cessation.ms > 35_000) return null;
  const endHr = Math.round(cessation.bpm);

  const readAt = (minutes: number): number | null => {
    const targetMs = workoutEndMs + minutes * 60_000;
    const closest = sorted.filter((s) => s.ms > workoutEndMs && Math.abs(s.ms - targetMs) <= 30_000)
      .sort((a, b) => Math.abs(a.ms - targetMs) - Math.abs(b.ms - targetMs))[0];
    return closest ? endHr - Math.round(closest.bpm) : null;
  };

  const after1Minute = readAt(1);
  const after2Minutes = readAt(2);
  const after5Minutes = readAt(5);
  if (after1Minute == null && after2Minutes == null && after5Minutes == null) return null;
  return { endHr, after1Minute, after2Minutes, after5Minutes };
}

// ---------------------------------------------------------------------------
// 9. Auto Behavior Impact on Next-Day Recovery (algorithms/journalImpact.ts)
// ---------------------------------------------------------------------------

export interface BehaviorImpactItem {
  key: string;
  label: string;
  deltaRecovery: number;
  withCount: number;
  withoutCount: number;
  avgWith: number;
  avgWithout: number;
}

export interface BehaviorDayObservation {
  day: string;
  nextDayRecovery: number | null;
  proteinGoalHit: boolean | null;
  calorieTargetMet: boolean | null;
  strengthWorkout: boolean | null;
  cardioWorkout: boolean | null;
  tenKSteps: boolean | null;
  goodSleep: boolean | null;
}

export function computeBehaviorImpacts(observations: BehaviorDayObservation[]): BehaviorImpactItem[] {
  const defs: Array<{ key: string; label: string; flag: (o: BehaviorDayObservation) => boolean | null }> = [
    { key: "protein", label: "Protein Goal Hit", flag: (o) => o.proteinGoalHit },
    { key: "calories", label: "Calorie Target Met", flag: (o) => o.calorieTargetMet },
    { key: "strength", label: "Strength Training", flag: (o) => o.strengthWorkout },
    { key: "cardio", label: "Cardio Session", flag: (o) => o.cardioWorkout },
    { key: "steps", label: "10k+ Steps", flag: (o) => o.tenKSteps },
    { key: "sleep", label: "Sleep Goal Met", flag: (o) => o.goodSleep },
  ];

  const items: BehaviorImpactItem[] = [];
  for (const d of defs) {
    const withVals: number[] = [];
    const withoutVals: number[] = [];
    for (const o of observations) {
      if (o.nextDayRecovery == null || !Number.isFinite(o.nextDayRecovery)) continue;
      const f = d.flag(o);
      if (f === true) withVals.push(o.nextDayRecovery);
      else if (f === false) withoutVals.push(o.nextDayRecovery);
    }
    if (withVals.length < 7 || withoutVals.length < 7) continue;
    const avgWith = withVals.reduce((a, b) => a + b, 0) / withVals.length;
    const avgWithout = withoutVals.reduce((a, b) => a + b, 0) / withoutVals.length;
    items.push({
      key: d.key,
      label: d.label,
      deltaRecovery: round1(avgWith - avgWithout),
      withCount: withVals.length,
      withoutCount: withoutVals.length,
      avgWith: Math.round(avgWith),
      avgWithout: Math.round(avgWithout),
    });
  }
  return items.sort((a, b) => Math.abs(b.deltaRecovery) - Math.abs(a.deltaRecovery));
}
