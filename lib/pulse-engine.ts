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
  readinessHrvLn: cfg(2.079, 5.521, 0.08),
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
      return { ...prev, nightsSinceUpdate: 0, status: baselineStatus(prev.nValid, 0) };
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
  drivers: PulseRecoveryDriver[];
  summary: string;
}

export interface PulseRecoveryDayInput {
  hrvRmssdMs: number | null;
  restingHrBpm: number | null;
  respiratoryRate: number | null;
  skinTempDeltaC: number | null;
  sleepHours: number | null;
}

export function computePulseRecovery(
  today: PulseRecoveryDayInput,
  priorDays: PulseRecoveryDayInput[],
  sleepNeedHours = 8.0,
): PulseRecoveryResult {
  const hrvBase = foldBaselineSeries(
    priorDays.map((d) => (d.hrvRmssdMs != null && d.hrvRmssdMs > 0 ? Math.log(d.hrvRmssdMs) : null)),
    PULSE_METRIC_CFG.readinessHrvLn,
    false,
  );
  const rhrBase = foldBaselineSeries(priorDays.map((d) => d.restingHrBpm), PULSE_METRIC_CFG.restingHr);
  const respBase = foldBaselineSeries(priorDays.map((d) => d.respiratoryRate), PULSE_METRIC_CFG.resp);
  const tempBase = foldBaselineSeries(priorDays.map((d) => d.skinTempDeltaC), PULSE_METRIC_CFG.skinTempDev);

  const parts: Array<{ key: PulseRecoveryDriver["key"]; label: string; weight: number; z: number | null; score: number; valueText: string; baselineText: string | null }> = [];

  if (today.hrvRmssdMs != null && today.hrvRmssdMs > 0) {
    const lnHrv = Math.log(today.hrvRmssdMs);
    const hasBase = hrvBase != null && hrvBase.nValid >= MIN_NIGHTS_SEED;
    const z = hasBase ? clamp((lnHrv - hrvBase!.baseline) / Math.max(0.08, hrvBase!.spread), -3, 3) : null;
    const sub = z != null ? clamp(72 + z * 18, 10, 100) : clamp(45 + (today.hrvRmssdMs - 25) * 0.85, 25, 95);
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
    const hasBase = rhrBase != null && rhrBase.nValid >= MIN_NIGHTS_SEED;
    // Lower RHR than baseline is positive z
    const z = hasBase ? clamp((rhrBase!.baseline - today.restingHrBpm) / Math.max(2.0, rhrBase!.spread), -3, 3) : null;
    const sub = z != null ? clamp(72 + z * 16, 10, 100) : clamp(95 - (today.restingHrBpm - 48) * 1.1, 30, 95);
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
    const ratio = today.sleepHours / Math.max(5.5, sleepNeedHours);
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

  if (today.respiratoryRate != null && today.respiratoryRate > 0) {
    const hasBase = respBase != null && respBase.nValid >= MIN_NIGHTS_SEED;
    const z = hasBase ? clamp((respBase!.baseline - today.respiratoryRate) / Math.max(0.5, respBase!.spread), -3, 3) : null;
    const sub = z != null ? clamp(75 + z * 12, 20, 100) : 75;
    parts.push({
      key: "resp",
      label: "Resp Rate",
      weight: 0.05,
      z,
      score: sub,
      valueText: `${today.respiratoryRate.toFixed(1)} rpm`,
      baselineText: hasBase ? `${respBase!.baseline.toFixed(1)} rpm` : null,
    });
  }

  if (today.skinTempDeltaC != null) {
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

  const baseStat: BaselineStatus =
    hrvBase?.status === "trusted" || rhrBase?.status === "trusted"
      ? "trusted"
      : hrvBase?.status === "provisional" || rhrBase?.status === "provisional"
        ? "provisional"
        : "calibrating";

  return {
    score,
    band,
    baselineStatus: baseStat,
    drivers,
    summary: `Pulse Recovery ${score}% (${band}) · ${drivers.map((d) => `${d.label} ${d.valueText}`).slice(0, 3).join(" · ")}`,
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
}

export interface PulseSleepResult {
  score: number | null;
  durationPct: number | null;
  efficiencyPct: number | null;
  restorativePct: number | null;
  sri: number | null;
  sleepNeedHours: number;
  sleepDebtHours: number;
  recommendedBedtime: string | null;
  recommendedWakeTime: string | null;
}

export function computeSleepRegularity(nights: SleepNightRecord[], anchorDay: string): number | null {
  const MIN_PER_DAY = 1440;
  const days = 7;
  const startDay = addDays(anchorDay, -(days - 1));
  const windowStartSec = Math.floor(new Date(`${startDay}T00:00:00Z`).getTime() / 1000) - 12 * 3600;
  const totalMins = (days + 1) * MIN_PER_DAY;
  const asleep = new Uint8Array(totalMins);
  const covered = new Array<boolean>(days + 1).fill(false);

  const validSessions = nights.filter(
    (n) => n.sleepStart && n.sleepEnd && n.sleepEnd.getTime() > n.sleepStart.getTime(),
  );
  if (validSessions.length < 2) return null;

  for (const s of validSessions) {
    const startSec = Math.floor(s.sleepStart!.getTime() / 1000);
    const endSec = Math.floor(s.sleepEnd!.getTime() / 1000);
    const m0 = Math.max(0, Math.floor((startSec - windowStartSec) / 60));
    const m1 = Math.min(totalMins, Math.ceil((endSec - windowStartSec) / 60));
    if (m1 <= m0) continue;
    asleep.fill(1, m0, m1);
    const dIdx = Math.floor(m1 / MIN_PER_DAY);
    if (dIdx >= 0 && dIdx < covered.length) covered[dIdx] = true;
    if (dIdx - 1 >= 0 && dIdx - 1 < covered.length) covered[dIdx - 1] = true;
  }

  let same = 0;
  let pairs = 0;
  for (let d = 0; d + 1 < covered.length; d++) {
    if (!covered[d] || !covered[d + 1]) continue;
    for (let m = d * MIN_PER_DAY; m < (d + 1) * MIN_PER_DAY; m++) {
      pairs++;
      if (asleep[m] === asleep[m + MIN_PER_DAY]) same++;
    }
  }
  if (pairs === 0) return null;
  const rawSri = -100 + (200 * same) / pairs;
  return Math.round(clamp(rawSri, 0, 100));
}

function minuteOfDayLocal(d: Date): number {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function fmtMinutesHHMM(mins: number): string {
  const norm = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(norm / 60)).padStart(2, "0")}:${String(norm % 60).padStart(2, "0")}`;
}

export function computeSleepInsights(
  todaySleep: SleepNightRecord | null,
  recentNights: SleepNightRecord[],
  anchorDay: string,
  yesterdayStrain: number | null,
): PulseSleepResult {
  const baseNeed = 8.0;
  const strainBump = yesterdayStrain != null && yesterdayStrain > 45 ? clamp((yesterdayStrain - 45) / 55, 0, 1) * 0.6 : 0;

  // Rolling 7d sleep debt
  const last7 = recentNights.filter((n) => n.day >= addDays(anchorDay, -6) && n.day <= anchorDay && n.minutesAsleep > 0);
  const debtHours =
    last7.length > 0
      ? round1(clamp(last7.reduce((s, n) => s + (baseNeed - n.minutesAsleep / 60), 0), 0, 6))
      : 0;
  const sleepNeedHours = round1(clamp(baseNeed + strainBump + Math.min(1.0, debtHours * 0.25), 7.0, 9.8));

  const sri = computeSleepRegularity(recentNights, anchorDay);

  // Recommended bedtime from median wake time of last 7 nights
  const wakeMins = last7
    .filter((n) => n.sleepEnd != null)
    .map((n) => minuteOfDayLocal(n.sleepEnd!))
    .sort((a, b) => a - b);
  const medianWake = wakeMins.length > 0 ? wakeMins[Math.floor(wakeMins.length / 2)] : null;
  const recommendedWakeTime = medianWake != null ? fmtMinutesHHMM(medianWake) : null;
  const recommendedBedtime = medianWake != null ? fmtMinutesHHMM(medianWake - sleepNeedHours * 60) : null;

  if (!todaySleep || todaySleep.minutesAsleep <= 0) {
    return {
      score: null,
      durationPct: null,
      efficiencyPct: null,
      restorativePct: null,
      sri,
      sleepNeedHours,
      sleepDebtHours: debtHours,
      recommendedBedtime,
      recommendedWakeTime,
    };
  }

  const asleepMin = todaySleep.minutesAsleep;
  const awakeMin = todaySleep.minutesAwake ?? 0;
  const durationScore = clamp((asleepMin / (sleepNeedHours * 60)) * 100, 0, 100);
  const efficiencyPct = Math.round(clamp((asleepMin / Math.max(1, asleepMin + awakeMin)) * 100, 50, 100));
  const effScore = clamp(((efficiencyPct - 70) / 26) * 100, 20, 100);

  const hasStages = todaySleep.deepMinutes != null && todaySleep.remMinutes != null;
  const restorativeRatio = hasStages ? (todaySleep.deepMinutes! + todaySleep.remMinutes!) / Math.max(1, asleepMin) : null;
  const restorativePct = restorativeRatio != null ? Math.round(restorativeRatio * 100) : null;
  const restScore = restorativeRatio != null ? clamp((restorativeRatio / 0.42) * 100, 20, 100) : 78;
  const consistencyScore = sri != null ? sri : 75;

  const score = Math.round(
    clamp(0.5 * durationScore + 0.2 * effScore + 0.2 * restScore + 0.1 * consistencyScore, 1, 100),
  );

  return {
    score,
    durationPct: Math.round(durationScore),
    efficiencyPct,
    restorativePct,
    sri,
    sleepNeedHours,
    sleepDebtHours: debtHours,
    recommendedBedtime,
    recommendedWakeTime,
  };
}

// ---------------------------------------------------------------------------
// 4. 5-Vital Health Monitor & Illness Radar (scoring/illness.ts + healthMonitor.ts)
// ---------------------------------------------------------------------------

export interface VitalCheckItem {
  key: "restingHr" | "hrv" | "resp" | "spo2" | "skinTempDev";
  label: string;
  valueText: string;
  rangeText: string | null;
  status: "in_range" | "high" | "low" | "no_data";
}

export interface PulseHealthMonitorResult {
  status: "nominal" | "watch" | "elevated" | "unavailable";
  inRangeCount: number;
  availableCount: number;
  illnessRiskScore: number;
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
  let riskScore = 0;

  const evalBand = (
    key: VitalCheckItem["key"],
    label: string,
    val: number | null,
    unit: string,
    base: BaselineState | null,
    badDirection: "high" | "low" | "both",
    fixedRange?: [number, number],
  ) => {
    if (val == null) {
      vitals.push({ key, label, valueText: "—", rangeText: null, status: "no_data" });
      return;
    }
    const usable = base != null && base.nValid >= MIN_NIGHTS_SEED;
    const lo = fixedRange ? fixedRange[0] : usable ? base!.baseline - 2.0 * base!.spread : null;
    const hi = fixedRange ? fixedRange[1] : usable ? base!.baseline + 2.0 * base!.spread : null;

    let status: VitalCheckItem["status"] = "in_range";
    if (lo != null && val < lo) status = "low";
    else if (hi != null && val > hi) status = "high";

    if (status !== "in_range") {
      const isBadDir =
        badDirection === "both" || (badDirection === "high" && status === "high") || (badDirection === "low" && status === "low");
      if (isBadDir) {
        corroborating += 1;
        if (usable) {
          const z = Math.abs(val - base!.baseline) / Math.max(0.3, base!.spread);
          riskScore += Math.min(40, Math.max(10, (z - 1.5) * 22));
        } else {
          riskScore += 28;
        }
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
  const illnessRiskScore = Math.round(clamp(riskScore, 0, 100));

  if (availableCount === 0) {
    return { status: "unavailable", inRangeCount: 0, availableCount: 0, illnessRiskScore: 0, vitals, note: "Awaiting vitals sync." };
  }

  const status: PulseHealthMonitorResult["status"] =
    corroborating >= 2 || illnessRiskScore >= 50
      ? "elevated"
      : corroborating === 1 || inRangeCount < availableCount
        ? "watch"
        : "nominal";

  const note =
    status === "elevated"
      ? `${corroborating} vitals drifted outside personal range — consider prioritizing rest.`
      : status === "watch"
        ? "1 vital slightly outside your personal baseline."
        : `All ${availableCount} tracked vitals are within your personal range.`;

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
  const valid = recentRecoveries.filter((r): r is number => r != null && Number.isFinite(r));
  if (valid.length < 3) {
    return {
      predictedScore: null,
      low: null,
      high: null,
      confidence: "unavailable",
      summary: "Need at least 3 recovery days to forecast tomorrow.",
    };
  }
  const center = valid.reduce((s, v) => s + v, 0) / valid.length;
  const strainAdj = todayStrain != null ? clamp(((45 - todayStrain) / 45) * 9, -12, 8) : 0;
  const sleepHours = plannedSleepHours ?? sleepNeedHours;
  const sleepAdj = clamp((sleepHours - sleepNeedHours) * 6.5, -10, 8);
  const pred = Math.round(clamp(center + strainAdj + sleepAdj, 5, 99));
  const band = valid.length >= 10 ? 9 : 14;
  return {
    predictedScore: pred,
    low: Math.max(1, pred - band),
    high: Math.min(100, pred + band),
    confidence: valid.length >= 10 ? "solid" : "building",
    summary: `Projected ${pred}% (${Math.max(1, pred - band)}–${Math.min(100, pred + band)}%) given today's strain & sleep target.`,
  };
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
  if (vo2max == null || age == null || sex == null || vo2max <= 0) {
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

function referenceVo2max(age: number, sex: BiologicalSex): number {
  const col75 = FRIEND_PERCENTILES.indexOf(75);
  return piecewiseLinear(
    FRIEND_TREADMILL[sex].map((row, i) => [25 + 10 * i, row[col75]] as const),
    age,
  );
}

const lnHr = (rows: [number, number][]) => rows.map(([x, hr]) => [x, Math.log(hr)] as const);

const HEALTHSPAN_CURVES = {
  vo2max: lnHr([[10, 1], [80, 0.87 ** (70 / 3.5)]]),
  restingHr: lnHr([[45, 1], [105, 1.09 ** 6]]),
  steps: lnHr([[3553, 1], [5801, 0.6], [7842, 0.55], [10901, 0.47]]),
  sleepHours: lnHr([[5, 1.12], [7, 1], [8, 1], [9, 1.3]]),
  sri: lnHr([[65.1, 1], [75.62, 0.8], [80.99, 0.75], [85.22, 0.72], [89.8, 0.7]]),
  zone13: lnHr(
    [[0, 1], [2, 0.89], [4, 0.79], [6, 0.7], [8, 0.62], [10, 0.56], [12, 0.5], [14, 0.46], [16, 0.43], [18, 0.41], [20, 0.4], [22, 0.4], [24, 0.39]].map(
      ([d, hr]): [number, number] => [d * 7, hr],
    ),
  ),
  zone45: lnHr([[0, 1], [112, 0.81], [225, 0.81 * 0.97]]),
  strength: lnHr([[0, 1], [40, 0.83], [140, 1]]),
  leanMass: lnHr([[16.1, 1], [21.9, 0.7]]),
};

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
  key: keyof typeof HEALTHSPAN_CURVES;
  label: string;
  valueText: string;
  deltaYears: number;
}

export interface BiologicalAgeResult {
  status: "ready" | "provisional" | "needs_profile";
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
  if (profile.age == null || profile.sex == null) {
    return {
      status: "needs_profile",
      chronologicalAge: profile.age,
      biologicalAge: null,
      deltaYears: null,
      paceOfAging: null,
      activeDays: 0,
      contributors: [],
    };
  }

  const age = profile.age;
  const sex = profile.sex;
  const DOUBLING_YEARS = 8;
  const OVERLAP_SHRINK = 0.75;
  const CLAMP_YEARS = 15;
  const LN2 = Math.LN2;

  const evalWindow = (fromDay: string) => {
    const slice = days.filter((d) => d.day >= fromDay && d.day <= anchorDay);
    const meanOf = (fn: (d: HealthspanDayInput) => number | null | undefined) => {
      const vals = slice.map(fn).filter((v): v is number => v != null && Number.isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const weeklyOf = (fn: (d: HealthspanDayInput) => number | null | undefined) => {
      const vals = slice.map(fn).filter((v): v is number => v != null && Number.isFinite(v));
      return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length) * 7 : null;
    };

    const ref = {
      vo2max: referenceVo2max(age, sex),
      restingHr: 58,
      steps: 8000,
      sleepHours: 7.5,
      sri: 80,
      zone13: 150,
      zone45: 45,
      strength: 45,
      leanMass: sex === "male" ? 19.5 : 16.5,
    };

    const obs: Partial<Record<keyof typeof HEALTHSPAN_CURVES, { val: number; label: string; fmt: (v: number) => string }>> = {};
    const vVo2 = meanOf((d) => d.vo2max);
    if (vVo2 != null) obs.vo2max = { val: vVo2, label: "VO2 Max", fmt: (v) => `${v.toFixed(1)}` };
    const vRhr = meanOf((d) => d.restingHr);
    if (vRhr != null) obs.restingHr = { val: vRhr, label: "Resting HR", fmt: (v) => `${Math.round(v)} bpm` };
    const vSteps = meanOf((d) => d.steps);
    if (vSteps != null) obs.steps = { val: vSteps, label: "Daily Steps", fmt: (v) => `${Math.round(v).toLocaleString("en-GB")}` };
    const vSleep = meanOf((d) => d.sleepHours);
    if (vSleep != null) obs.sleepHours = { val: vSleep, label: "Sleep Duration", fmt: (v) => `${v.toFixed(1)} h` };
    const vSri = meanOf((d) => d.sri);
    if (vSri != null) obs.sri = { val: vSri, label: "Sleep Regularity", fmt: (v) => `${Math.round(v)}%` };
    const vZ13 = weeklyOf((d) => d.zone13Min);
    if (vZ13 != null && vZ13 > 0) obs.zone13 = { val: vZ13, label: "Moderate Cardio", fmt: (v) => `${Math.round(v)} min/wk` };
    const vZ45 = weeklyOf((d) => d.zone45Min);
    if (vZ45 != null && vZ45 > 0) obs.zone45 = { val: vZ45, label: "Vigorous Cardio", fmt: (v) => `${Math.round(v)} min/wk` };
    const vStr = weeklyOf((d) => d.strengthMin);
    if (vStr != null) obs.strength = { val: vStr, label: "Strength Training", fmt: (v) => `${Math.round(v)} min/wk` };

    if (profile.heightCm && profile.heightCm > 0) {
      const hM = profile.heightCm / 100;
      const w = meanOf((d) => d.weightKg);
      const bf = meanOf((d) => d.bodyFatPct);
      if (w != null && bf != null) {
        const ffmi = (w * (1 - bf / 100)) / (hM * hM);
        obs.leanMass = { val: ffmi, label: "Lean Mass (FFMI)", fmt: (v) => `${v.toFixed(1)}` };
      }
    }

    let sumLnHr = 0;
    const contributors: BiologicalAgeContributor[] = [];
    for (const key of Object.keys(obs) as (keyof typeof HEALTHSPAN_CURVES)[]) {
      const entry = obs[key]!;
      const curve = HEALTHSPAN_CURVES[key];
      const deltaLn = piecewiseLinear(curve, entry.val) - piecewiseLinear(curve, ref[key]);
      sumLnHr += deltaLn;
      const yrs = ((OVERLAP_SHRINK * deltaLn) / LN2) * DOUBLING_YEARS;
      contributors.push({
        key,
        label: entry.label,
        valueText: entry.fmt(entry.val),
        deltaYears: round1(yrs),
      });
    }

    const deltaYears = clamp(((OVERLAP_SHRINK * sumLnHr) / LN2) * DOUBLING_YEARS, -CLAMP_YEARS, CLAMP_YEARS);
    return {
      activeDays: slice.length,
      deltaYears: round1(deltaYears),
      contributors: contributors.sort((a, b) => a.deltaYears - b.deltaYears),
    };
  };

  const w180 = evalWindow(addDays(anchorDay, -179));
  const w30 = evalWindow(addDays(anchorDay, -29));
  const paceOfAging = w30.activeDays >= 5 && w180.activeDays >= 10
    ? round2(clamp(1.0 + (w30.deltaYears - w180.deltaYears) / 5.0, -1, 3))
    : 1.0;

  return {
    status: w180.activeDays >= 20 ? "ready" : "provisional",
    chronologicalAge: round1(age),
    biologicalAge: round1(age + w180.deltaYears),
    deltaYears: w180.deltaYears,
    paceOfAging,
    activeDays: w180.activeDays,
    contributors: w180.contributors,
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
}

export function computeEnergyBankAndStress(
  hrSamples: Array<{ recordedAt: string; bpm: number }>,
  restingHrBpm: number | null,
  maxHrBpm: number,
  recoveryScore: number | null,
  sleepScore: number | null,
  workoutIntervals: Array<{ startMs: number; endMs: number }>,
): { energyBank: EnergyBankResult; stress: DaytimeStressResult } {
  const seed =
    recoveryScore != null && sleepScore != null
      ? Math.round(0.6 * recoveryScore + 0.4 * sleepScore)
      : recoveryScore ?? sleepScore;

  if (hrSamples.length === 0 || restingHrBpm == null || restingHrBpm <= 0) {
    return {
      energyBank: {
        currentPct: seed,
        peakPct: seed,
        drainedPct: 0,
        status: seed == null ? "unavailable" : seed >= 65 ? "charged" : seed >= 35 ? "steady" : "low",
      },
      stress: { avgStress: null, lowMinutes: 0, mediumMinutes: 0, highMinutes: 0, band: "unavailable" },
    };
  }

  const rhr = Math.max(35, Math.min(110, restingHrBpm));
  const maxHr = Math.max(rhr + 40, maxHrBpm || 190);
  const reserve = maxHr - rhr;
  const sorted = hrSamples
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

  for (let i = 0; i < sorted.length; i++) {
    const dtMin = i > 0 ? clamp((sorted[i].ms - sorted[i - 1].ms) / 60000, 0.25, 5) : 1;
    const hrrFrac = Math.max(0, (sorted[i].bpm - rhr) / reserve);
    totalDrain += (0.015 + 0.14 * hrrFrac * hrrFrac + 0.04 * hrrFrac) * dtMin;

    const inWorkout = workoutIntervals.some((w) => sorted[i].ms >= w.startMs && sorted[i].ms <= w.endMs);
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

  const peakPct = seed ?? 75;
  const drainedPct = Math.round(clamp(totalDrain, 0, peakPct - 5));
  const currentPct = Math.round(clamp(peakPct - drainedPct, 5, 100));

  const avgStress = stressCount > 0 ? round2(stressSum / stressCount) : null;
  const band: DaytimeStressResult["band"] =
    avgStress == null ? "unavailable" : avgStress >= 1.8 ? "high" : avgStress >= 1.0 ? "moderate" : "low";

  return {
    energyBank: {
      currentPct,
      peakPct,
      drainedPct,
      status: currentPct >= 65 ? "charged" : currentPct >= 35 ? "steady" : "low",
    },
    stress: {
      avgStress,
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
  const sorted = samples
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

  const cessation = beforeEnd.filter((s) => s.ms >= workoutEndMs - 65_000).map((s) => s.bpm);
  if (cessation.length === 0) return null;
  const endHr = Math.round(Math.max(...cessation));

  const readAt = (minutes: number): number | null => {
    const targetMs = workoutEndMs + minutes * 60_000;
    const vals = sorted.filter((s) => Math.abs(s.ms - targetMs) <= 35_000).map((s) => s.bpm).sort((a, b) => a - b);
    if (vals.length === 0) return null;
    const mid = Math.floor(vals.length / 2);
    const med = vals.length % 2 === 0 ? Math.round((vals[mid - 1] + vals[mid]) / 2) : Math.round(vals[mid]);
    return endHr - med;
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
  strengthWorkout: boolean;
  cardioWorkout: boolean;
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
    { key: "sleep", label: "7.5h+ Sleep", flag: (o) => o.goodSleep },
  ];

  const items: BehaviorImpactItem[] = [];
  for (const d of defs) {
    const withVals: number[] = [];
    const withoutVals: number[] = [];
    for (const o of observations) {
      if (o.nextDayRecovery == null) continue;
      const f = d.flag(o);
      if (f === true) withVals.push(o.nextDayRecovery);
      else if (f === false) withoutVals.push(o.nextDayRecovery);
    }
    if (withVals.length < 3 || withoutVals.length < 3) continue;
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
