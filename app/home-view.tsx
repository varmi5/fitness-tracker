"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, TrendingUp } from "lucide-react";
import { BevelScoreRing, CalorieSlider } from "../components/bevel-widgets";
import { MealCategoryIcon } from "../components/icons";
import type { DailyNutritionView, MealRecord } from "../lib/nutrition-data";
import { addDays, isCalorieGoalMet } from "../lib/nutrition-model";
import { computeTargetStrain } from "../lib/strain-engine";
import { metrics, readingsFor, summary } from "../lib/metrics";
import type { TrendMetricKind } from "./metric-trends-modal";
import {
  CATEGORY_LABELS,
  fmtGram,
  recoveryAvailabilityLabel,
  sleepAttribution,
  fmtKcal,
  type AppTab,
  type DailyStrainView,
  type GoogleIntegrationStatus,
  type NutritionHistory,
  type NutritionSettings,
  type PulseInsightsView,
  type RecoveryInsightView,
  type TrackerSnapshot,
} from "./types";

interface HomeViewProps {
  calendarToday: string;
  activeDay: string;
  viewDay: string;
  showSleep: boolean;
  daily: DailyNutritionView;
  history30: NutritionHistory;
  tracker: TrackerSnapshot;
  google: GoogleIntegrationStatus;
  settings: NutritionSettings;
  strain?: DailyStrainView;
  recoveryInsights?: RecoveryInsightView;
  pulseInsights?: PulseInsightsView | null;
  busy: boolean;
  onSelectHomeDay: (day: string) => void;
  onOpenTraining?: (day: string) => void;
  onOpenTrends: (metric: TrendMetricKind) => void;
  onEditMeal: (meal: MealRecord) => void;
  onSyncGoogle: () => void;
  onNavigate: (tab: AppTab) => void;
}

function formatDurationMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDurationSeconds(seconds: number | null): string | null {
  if (seconds == null || seconds <= 0) return null;
  return formatDurationMinutes(Math.round(seconds / 60));
}

function buildSparklinePoints(values: number[], width = 104, height = 28): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 4) + 2;
      const y = height - 3 - ((v - min) / span) * (height - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export function HomeView({
  calendarToday,
  activeDay,
  viewDay,
  daily,
  history30,
  tracker,
  google,
  settings,
  strain,
  recoveryInsights,
  pulseInsights,
  busy,
  onSelectHomeDay,
  onOpenTraining,
  onOpenTrends,
  onEditMeal,
  onSyncGoogle,
  onNavigate,
}: HomeViewProps) {
  const [sleepDetailOpen, setSleepDetailOpen] = useState(false);

  const isFitbitMode = settings.trackingMode === "fitbit";
  const isBulkMode = Boolean(settings.bulkMode);

  const intake = daily.totals.calories;
  const target = daily.target;
  const calPct = intake == null || target <= 0 ? 0 : Math.round((intake / target) * 100);
  const goalMet = isCalorieGoalMet(intake, target, isBulkMode);

  const remainingLabel =
    intake == null
      ? isBulkMode
        ? `${fmtKcal(target)} to target`
        : `${fmtKcal(target)} left`
      : isBulkMode
        ? daily.remaining != null && daily.remaining > 0
          ? `${fmtKcal(daily.remaining)} under`
          : `${fmtKcal(Math.abs(daily.remaining ?? 0))} over · met`
        : daily.remaining != null && daily.remaining >= 0
          ? `${fmtKcal(daily.remaining)} left`
          : `${fmtKcal(Math.abs(daily.remaining ?? 0))} over`;

  const macroBars = [
    {
      label: "Protein",
      valueText: fmtGram(daily.totals.proteinG),
      pct:
        daily.totals.proteinG != null && daily.macroTargets.proteinG > 0
          ? Math.round((daily.totals.proteinG / daily.macroTargets.proteinG) * 100)
          : 0,
      color: "var(--macro-protein)",
    },
    {
      label: "Fibre",
      valueText: fmtGram(daily.totals.fibreG),
      pct:
        daily.totals.fibreG != null && daily.macroTargets.fibreG > 0
          ? Math.round((daily.totals.fibreG / daily.macroTargets.fibreG) * 100)
          : 0,
      color: "var(--macro-fibre)",
    },
    {
      label: "Carbs",
      valueText: fmtGram(daily.totals.carbsG),
      pct:
        daily.totals.carbsG != null && daily.macroTargets.carbsG > 0
          ? Math.round((daily.totals.carbsG / daily.macroTargets.carbsG) * 100)
          : 0,
      color: "var(--macro-carbs)",
    },
    {
      label: "Fat",
      valueText: fmtGram(daily.totals.fatG),
      pct:
        daily.totals.fatG != null && daily.macroTargets.fatG > 0
          ? Math.round((daily.totals.fatG / daily.macroTargets.fatG) * 100)
          : 0,
      color: "var(--macro-fat)",
    },
  ];

  // Weight resolution & 14-day sparkline scoped strictly to viewDay
  const weightMetric = metrics.find((m) => m.key === "weight")!;
  const weightReadings = readingsFor(tracker.readings, weightMetric);
  const weightSummary = summary(weightReadings, viewDay);
  const latestEnergyWeightUpToViewDay =
    [...history30.days]
      .filter((d) => d.day <= viewDay && d.energy?.weightKg != null)
      .pop()?.energy?.weightKg ?? null;
  const displayWeight =
    daily.energy?.weightKg ?? weightSummary.latest?.value ?? latestEnergyWeightUpToViewDay;
  const weightChange7d = weightSummary.change;

  const weightSparkPoints = useMemo(() => {
    const from14 = addDays(viewDay, -13);
    const byDay = new Map<string, number>();
    for (const d of history30.days) {
      if (d.day >= from14 && d.day <= viewDay && d.energy?.weightKg != null) {
        byDay.set(d.day, d.energy.weightKg);
      }
    }
    for (const r of weightReadings) {
      if (r.date >= from14 && r.date <= viewDay) byDay.set(r.date, r.value);
    }
    const vals = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
    return buildSparklinePoints(vals);
  }, [history30.days, weightReadings, viewDay]);

  const viewDateDisplay = new Date(`${viewDay}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  const yesterday = addDays(calendarToday, -1);
  const viewTitle =
    viewDay === calendarToday
      ? "Today"
      : viewDay === yesterday
        ? "Yesterday"
        : viewDateDisplay;

  const dayPulse = pulseInsights?.day === viewDay ? pulseInsights : null;
  const dayRecovery = recoveryInsights?.day === viewDay ? recoveryInsights : null;
  const daySleep = daily.day === viewDay && daily.sleep?.day === viewDay ? daily.sleep : null;
  const dayStrain = strain?.day === viewDay ? strain : null;
  const effectiveRecoveryScore = dayPulse ? dayPulse.recovery.score : (dayRecovery?.score ?? null);
  const effectiveRecoveryBand = dayPulse?.recovery.band ?? dayRecovery?.band ?? "unavailable";
  const strainTarget = dayPulse?.strainTarget ?? computeTargetStrain(effectiveRecoveryScore);
  const overallStrain = dayStrain?.overallStrain ?? null;
  const recoveryScore = effectiveRecoveryScore;
  const sleepMinutes = daySleep?.minutesAsleep ?? dayRecovery?.metrics.sleepMinutes ?? null;
  const sleepScore = dayPulse?.sleep.score ?? null;
  const sleepPct = sleepScore;
  const recoveryStateLabel = recoveryAvailabilityLabel(dayPulse?.recovery.availability);
  const vitalsPending = isFitbitMode && recoveryScore == null && sleepMinutes == null;

  const sameDayWorkouts = (dayStrain?.activities ?? [])
    .filter((a) => a.kind === "strength" || a.kind === "cardio")
    .slice(0, 2);
  const cappedMeals = daily.meals.slice(0, 3);

  const openTrainingView = () => (onOpenTraining ? onOpenTraining(viewDay) : onNavigate("Training"));

  return (
    <>
      <div className="home-date-nav" style={{ justifyContent: "space-between", paddingInline: ".1rem" }}>
        <button
          type="button"
          className="secondary compact home-step-btn"
          aria-label="Previous day"
          onClick={() => onSelectHomeDay(addDays(viewDay, -1))}
        >
          <ChevronLeft size={18} />
        </button>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: "1.4rem", letterSpacing: "-0.03em", margin: 0 }}>{viewTitle}</h1>
          <div style={{ fontSize: ".75rem", color: "var(--muted)" }}>{viewDateDisplay}</div>
        </div>
        <button
          type="button"
          className="secondary compact home-step-btn"
          aria-label="Next day"
          disabled={viewDay >= calendarToday}
          onClick={() => onSelectHomeDay(addDays(viewDay, 1))}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {viewDay !== activeDay && (
        <div style={{ display: "flex", justifyContent: "center" }}>
          <button
            type="button"
            className="secondary compact"
            style={{ minHeight: "30px", padding: ".18rem .65rem", fontSize: ".74rem" }}
            onClick={() => onSelectHomeDay(activeDay)}
          >
            Back to {activeDay === calendarToday ? "today" : "active day"}
          </button>
        </div>
      )}

      {/* Silk Triple-Ring Hero (Strain · Recovery · Sleep) */}
      <section className="card triple-ring-card" aria-label="Daily score rings">
        <div className="split-row">
          <span className="eyebrow">Daily estimates</span>
          <button
            type="button"
            className="silk-chip-btn"
            onClick={() => onOpenTrends("strain")}
            aria-label="Open strain trends"
          >
            <TrendingUp size={12} /> Trends <ChevronRight size={12} />
          </button>
        </div>

        {isFitbitMode ? (
          <div className="triple-ring-grid">
            <BevelScoreRing
              label="Strain"
              value={overallStrain}
              displayText={overallStrain == null ? "—" : Math.round(overallStrain).toString()}
              pct={overallStrain ?? 0}
              color="var(--strain-color)"
              targetRange={recoveryScore == null ? null : [strainTarget.min, strainTarget.max]}
              sublabel={recoveryScore == null ? "Readiness not available" : `Guide ${strainTarget.min}–${strainTarget.max}`}
              onClick={openTrainingView}
            />
            <BevelScoreRing
              label="Recovery"
              value={recoveryScore}
              displayText={recoveryScore == null ? "—" : `${recoveryScore}%`}
              pct={recoveryScore ?? 0}
              color="var(--recovery-color)"
              sublabel={
                effectiveRecoveryBand === "optimal"
                  ? "Higher readiness"
                  : effectiveRecoveryBand === "moderate"
                    ? "Moderate"
                    : effectiveRecoveryBand === "strained"
                      ? "Strained"
                      : recoveryStateLabel
              }
              onClick={openTrainingView}
            />
            <BevelScoreRing
              label="Sleep"
              value={sleepScore ?? sleepMinutes}
              displayText={
                sleepScore != null
                  ? `${sleepScore}%`
                  : sleepMinutes == null
                    ? "—"
                    : formatDurationMinutes(sleepMinutes)
              }
              pct={sleepPct ?? 0}
              color="var(--sleep-color)"
              sublabel={
                sleepMinutes == null
                  ? "Pending"
                  : `${formatDurationMinutes(sleepMinutes)} · ${sleepScore == null ? "Duration only" : "Estimate"}`
              }
              onClick={() => setSleepDetailOpen((v) => !v)}
            />
          </div>
        ) : (
          <button
            type="button"
            className="compact-row-btn"
            aria-label="Overall Strain summary"
            onClick={openTrainingView}
            style={{ padding: 0, borderTop: 0 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: ".9rem" }}>
              <BevelScoreRing
                label=""
                value={overallStrain}
                displayText={overallStrain == null ? "—" : Math.round(overallStrain).toString()}
                pct={overallStrain ?? 0}
                color="var(--strain-color)"
                size={76}
                strokeWidth={7.5}
              />
              <div>
                <span className="eyebrow">Overall Strain</span>
                <div style={{ fontSize: ".84rem", color: "var(--muted)", marginTop: ".15rem" }}>
                  {dayStrain?.muscularStrain != null
                    ? `Muscular ${Math.round(dayStrain.muscularStrain)} · Cardio ${dayStrain.cardioStrain != null ? Math.round(dayStrain.cardioStrain) : "—"}`
                    : "Tap to view Training & Strain"}
                </div>
              </div>
            </div>
            <ChevronRight size={18} style={{ color: "var(--muted)" }} />
          </button>
        )}

        {isFitbitMode && (
          <button
            type="button"
            className="sr-only"
            aria-label="Overall Strain summary"
            onClick={openTrainingView}
          >
            Open Training &amp; Strain
          </button>
        )}

        {vitalsPending && (
          <div className="bevel-awaiting-strip">
            <span>{recoveryStateLabel}</span>
            {google.connected && (
              <button
                type="button"
                className="secondary compact"
                style={{ minHeight: "28px", padding: ".15rem .5rem", fontSize: ".72rem" }}
                disabled={busy}
                onClick={onSyncGoogle}
              >
                <RefreshCw size={11} /> Refresh
              </button>
            )}
          </div>
        )}

        {isFitbitMode && <p className="metric-provenance">{sleepAttribution(daySleep, daily.timezone, calendarToday)}. Scores are estimates.</p>}

        {isFitbitMode && sleepDetailOpen && daySleep && (
          <div className="muscle-detail-bar" style={{ marginTop: ".1rem" }}>
            <div className="split-row" style={{ fontSize: ".8rem" }}>
              <strong>{sleepScore != null ? `Sleep estimate ${sleepScore}%` : "Sleep duration"}</strong>
              <span className="num">{formatDurationMinutes(daySleep.minutesAsleep)}</span>
            </div>
            <div className="split-row" style={{ fontSize: ".75rem", color: "var(--muted)" }}>
              <span>Deep {daySleep.deepMinutes != null ? formatDurationMinutes(daySleep.deepMinutes) : "—"}</span>
              <span>REM {daySleep.remMinutes != null ? formatDurationMinutes(daySleep.remMinutes) : "—"}</span>
              <span>Light {daySleep.lightMinutes != null ? formatDurationMinutes(daySleep.lightMinutes) : "—"}</span>
            </div>
            {dayPulse?.sleep && <p className="metric-provenance">Score uses {dayPulse.sleep.scoreCoverage.join(" and ") || "no available components"}. Deep/REM are wearable estimates. {dayPulse.sleep.scheduleVariabilityMinutes != null ? `Wake-time variability ${dayPulse.sleep.scheduleVariabilityMinutes} min.` : "Schedule variability needs more sleep sessions."}</p>}
            {dayPulse?.sleep && (
              <div className="split-row" style={{ fontSize: ".73rem", color: "var(--muted)" }}>
                <span>Efficiency {dayPulse.sleep.efficiencyPct != null ? `${dayPulse.sleep.efficiencyPct}%` : "unknown"} · Debt {dayPulse.sleep.sleepDebtHours != null ? `${dayPulse.sleep.sleepDebtHours}h` : "unknown"}</span>
                <span>
                  {dayPulse.sleep.recommendedBedtime
                    ? `Bedtime ~${dayPulse.sleep.recommendedBedtime}`
                    : `Need ${dayPulse.sleep.sleepNeedHours}h`}
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Silk Energy Bank & HR elevation Card */}
      {isFitbitMode && dayPulse && (
        <button
          type="button"
          className="card card-interactive"
          onClick={openTrainingView}
          style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: ".55rem" }}
          aria-label="Pulse Telemetry summary"
        >
          <div className="split-row">
            <span className="eyebrow">Experimental energy &amp; HR elevation</span>
            <span
              className={`pill ${
                dayPulse.stress.band === "high"
                  ? "danger-soft"
                  : dayPulse.stress.band === "moderate"
                    ? "amber-soft"
                    : "teal-soft"
              }`}
              style={{ fontSize: ".68rem" }}
            >
              {dayPulse.stress.avgStress != null
                ? `HR index ${dayPulse.stress.avgStress.toFixed(1)} · ${dayPulse.stress.band === "high" ? "High" : dayPulse.stress.band === "moderate" ? "Moderate" : "Low"}`
                : "Insufficient observations"}
            </span>
          </div>
          <div className="pulse-strip-grid">
            <div className="energy-cell">
              <span>Energy index</span>
              <strong className="num" style={{ color: "var(--recovery-color)" }}>
                {dayPulse.energyBank.currentPct != null ? `${dayPulse.energyBank.currentPct}%` : "—"}
              </strong>
              <div className="energy-bank-bar" aria-hidden="true">
                <div
                  className="energy-bank-fill"
                  style={{ width: `${Math.max(0, Math.min(100, dayPulse.energyBank.currentPct ?? 0))}%` }}
                />
              </div>
              <span style={{ fontSize: ".68rem", color: "var(--muted)" }}>
                {dayPulse.energyBank.peakPct != null
                  ? `Peak ${dayPulse.energyBank.peakPct}% · -${dayPulse.energyBank.drainedPct}%`
                  : "Needs sleep, baseline and HR"}
              </span>
            </div>
            <div className="energy-cell">
              <span>HR elevation</span>
              <strong className="num">
                {dayPulse.stress.avgStress != null ? dayPulse.stress.avgStress.toFixed(1) : "—"}
              </strong>
              <span style={{ fontSize: ".68rem", color: "var(--muted)", marginTop: ".15rem" }}>
                {dayPulse.stress.avgStress != null
                  ? `${dayPulse.stress.lowMinutes}m low · ${dayPulse.stress.mediumMinutes + dayPulse.stress.highMinutes}m load`
                  : "No eligible HR coverage"}
              </span>
            </div>
            <div className="energy-cell">
              <span>Future scenario</span>
              <strong className="num" style={{ color: "var(--accent)" }}>
                {dayPulse.forecast.predictedScore != null ? `${dayPulse.forecast.predictedScore}%` : "—"}
              </strong>
              <span className="metric-provenance">Unavailable pending validation</span>
            </div>
            <div className="energy-cell">
              <span>Estimated sleep debt</span>
              <strong className="num">
                {dayPulse.sleep.sleepDebtHours != null ? `${dayPulse.sleep.sleepDebtHours}h` : "—"}
              </strong>
              <span className="metric-provenance">{dayPulse.sleep.observedDays}/7 days · {dayPulse.sleep.debtCoverage}</span>
            </div>
          </div>
        </button>
      )}

      {/* Silk Health Monitor 5-Vital Baseline Strip */}
      {isFitbitMode && dayPulse && dayPulse.healthMonitor.availableCount > 0 && (
        <button
          type="button"
          className="card card-interactive"
          onClick={openTrainingView}
          style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: ".5rem" }}
          aria-label="Health Monitor 5-vital baseline"
        >
          <div className="split-row">
            <span className="eyebrow">Health Monitor</span>
            <span
              className={`pill ${
                dayPulse.healthMonitor.status === "elevated"
                  ? "danger-soft"
                  : dayPulse.healthMonitor.status === "watch"
                    ? "amber-soft"
                    : dayPulse.healthMonitor.status === "nominal" ? "teal-soft" : ""
              }`}
              style={{ fontSize: ".68rem" }}
            >
              {dayPulse.healthMonitor.status === "calibrating" ? "Calibrating" : `${dayPulse.healthMonitor.inRangeCount}/${dayPulse.healthMonitor.vitals.filter((vital) => vital.status !== "no_data" && vital.status !== "calibrating").length} assessed in range`}
            </span>
          </div>
          <div className="health-monitor-grid">
            {dayPulse.healthMonitor.vitals.map((v) => {
              const shortLabel =
                v.key === "restingHr"
                  ? "RHR"
                  : v.key === "hrv"
                    ? "HRV"
                    : v.key === "resp"
                      ? "RR"
                      : v.key === "spo2"
                        ? "SpO₂"
                        : "Temp";
              const shortVal = v.valueText.replace(/ (bpm|ms|rpm)$/, "");
              return (
                <div key={v.key} className="health-vital-cell">
                  <span className="health-vital-label">{shortLabel}</span>
                  <span className="health-vital-val num">{shortVal}</span>
                  <span className={`health-vital-dot is-${v.status}`} aria-label={`${shortLabel} ${v.status}`} />
                </div>
              );
            })}
          </div>
        </button>
      )}

      {/* Silk Sleep Needed Formula Card */}
      {isFitbitMode && dayPulse && (
        <section
          className="card"
          style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: ".45rem" }}
          aria-label="Sleep Needed"
        >
          <div className="split-row">
            <span className="eyebrow">Sleep planning goal</span>
            <div style={{ display: "inline-flex", alignItems: "center", gap: ".4rem" }}>
              {dayPulse.sleep.recommendedBedtime && (
                <span className="pill" style={{ fontSize: ".68rem" }}>
                  Bed ~{dayPulse.sleep.recommendedBedtime}
                </span>
              )}
              <strong className="num" style={{ fontSize: "1rem", color: "var(--sleep-color)" }}>
                {formatDurationMinutes(Math.round(dayPulse.sleep.sleepNeedHours * 60))}
              </strong>
            </div>
          </div>
          <p className="metric-provenance">
            Planning goal in {daily.timezone}. This is your configured goal, not a measured biological sleep requirement.
            {dayPulse.sleep.sleepDebtHours == null ? " Sleep debt is unknown until sleep history is recorded." : ` Estimated debt ${dayPulse.sleep.sleepDebtHours}h from ${dayPulse.sleep.observedDays}/7 days (${dayPulse.sleep.debtCoverage}); missing nights remain unknown.`}
          </p>
        </section>
      )}

      {/* Calorie Intake Linear Slider */}
      <CalorieSlider
        title="Calorie Intake"
        consumedText={fmtKcal(intake)}
        targetText={`${fmtKcal(target)} kcal`}
        statusText={remainingLabel}
        fillPct={calPct}
        isOnTarget={goalMet}
        isBulkMode={isBulkMode}
        macros={macroBars}
        onClick={() => onNavigate("Nutrition")}
      />

      {/* Weight Sparkline + Steps + Energy Balance Trends */}
      <section
        className="card"
        style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: ".15rem" }}
        aria-label="Weight and steps snapshot"
      >
        <button
          type="button"
          className="compact-row-btn"
          onClick={() => onOpenTrends("weight")}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: ".92rem" }}>Body Weight</strong>
            <div style={{ fontSize: ".76rem", color: "var(--muted)", marginTop: ".1rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <span className="num">{displayWeight != null ? `${displayWeight.toFixed(1)} kg` : "No weight logged"}</span>
              {weightChange7d != null ? ` · ${weightChange7d > 0 ? "+" : ""}${weightChange7d.toFixed(1)} kg (7d)` : ""}
            </div>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: ".5rem", flexShrink: 0 }}>
            {weightSparkPoints && (
              <svg width="104" height="28" viewBox="0 0 104 28" aria-hidden="true">
                <polyline
                  fill="none"
                  stroke="var(--accent-2)"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={weightSparkPoints}
                />
              </svg>
            )}
            <ChevronRight size={16} style={{ color: "var(--muted)" }} />
          </div>
        </button>

        <button
          type="button"
          className="compact-row-btn"
          onClick={() => onOpenTrends("energy")}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ fontSize: ".92rem" }}>Energy Balance Trend</strong>
            <div style={{ fontSize: ".76rem", color: "var(--muted)", marginTop: ".1rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {daily.energy?.totalKcal != null
                ? `Burn ${fmtKcal(daily.energy.totalKcal)} kcal · 7D/30D/90D chart`
                : "7D / 30D / 90D intake vs expenditure"}
            </div>
          </div>
          <ChevronRight size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
        </button>

        {isFitbitMode && daily.energy?.steps != null && (
          <button
            type="button"
            className="compact-row-btn"
            onClick={openTrainingView}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: ".92rem" }}>Daily Steps</strong>
              <div style={{ fontSize: ".76rem", color: "var(--muted)", marginTop: ".1rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                <span className="num">{daily.energy.steps.toLocaleString("en-GB")}</span> steps
                {daily.energy.totalKcal != null ? ` · ${fmtKcal(daily.energy.totalKcal)} kcal burn` : ""}
              </div>
            </div>
            <ChevronRight size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
          </button>
        )}
      </section>

      {/* Capped Fuel (max 3 meals) & Same-Day Workouts (max 2) */}
      <section
        className="card"
        style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: ".45rem" }}
        aria-label="Fuel and workouts"
      >
        <div className="split-row">
          <span className="eyebrow">Fuel Today</span>
          {daily.nutritionScore.grade && (
            <span className={`pill score-pill-${daily.nutritionScore.grade}`} style={{ fontSize: ".7rem" }}>
              Food heuristic {daily.nutritionScore.grade}
            </span>
          )}
        </div>

        {cappedMeals.length === 0 ? (
          <p className="empty" style={{ padding: ".45rem 0", fontSize: ".8rem" }}>
            Tap + below to quick-log a meal or scan a barcode.
          </p>
        ) : (
          <div className="fuel-meal-list">
            {cappedMeals.map((meal) => (
              <button
                key={meal.id}
                type="button"
                className="fuel-meal-row"
                onClick={() => onEditMeal(meal)}
              >
                <div className="fuel-meal-main">
                  <span className="fuel-meal-icon" aria-hidden="true">
                    <MealCategoryIcon category={meal.category} size={15} />
                  </span>
                  <div className="fuel-meal-text">
                    <div className="fuel-meal-title">{meal.name}</div>
                    <div className="fuel-meal-meta">
                      {CATEGORY_LABELS[meal.category]} · {meal.localTime}
                    </div>
                  </div>
                </div>
                <div className="fuel-meal-right">
                  {meal.qualityScore.grade && (
                    <span className={`pill score-pill-${meal.qualityScore.grade}`} style={{ fontSize: ".68rem", padding: ".05rem .4rem", minHeight: "20px" }}>
                      {meal.qualityScore.grade}
                    </span>
                  )}
                  <strong className="num" style={{ fontSize: ".84rem" }}>
                    {fmtKcal(meal.totals.calories)}{" "}
                    <span style={{ fontSize: ".7rem", fontWeight: 500, color: "var(--muted)" }}>kcal</span>
                  </strong>
                </div>
              </button>
            ))}
          </div>
        )}

        {daily.meals.length > 3 && (
          <button
            type="button"
            className="secondary compact"
            style={{ width: "100%", fontSize: ".76rem", minHeight: "34px" }}
            onClick={() => onNavigate("Nutrition")}
          >
            See all {daily.meals.length} meals in Nutrition <ChevronRight size={14} />
          </button>
        )}

        {sameDayWorkouts.length > 0 && (
          <div className="fuel-workouts-section">
            <div className="split-row fuel-workouts-header">
              <span className="eyebrow">Workouts Today</span>
              <span style={{ fontSize: ".72rem", color: "var(--muted)" }}>
                {sameDayWorkouts.length} {sameDayWorkouts.length === 1 ? "session" : "sessions"}
              </span>
            </div>
            {sameDayWorkouts.map((workout) => (
              <button
                key={workout.id}
                type="button"
                className="compact-row-btn"
                onClick={openTrainingView}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: ".45rem", minWidth: 0 }}>
                    <strong style={{ fontSize: ".9rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {workout.title}
                    </strong>
                    <span className="pill" style={{ fontSize: ".68rem", padding: ".1rem .45rem", flexShrink: 0 }}>
                      {workout.source}
                    </span>
                  </div>
                  <div style={{ fontSize: ".75rem", color: "var(--muted)", marginTop: ".12rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {formatDurationSeconds(workout.durationSeconds) ?? "—"}
                    {workout.mRaw > 0 ? ` · Muscular ${dayStrain?.muscularStrain != null ? Math.round(dayStrain.muscularStrain) : "—"}` : ""}
                    {workout.cRaw > 0 ? ` · Cardio ${dayStrain?.cardioStrain != null ? Math.round(dayStrain.cardioStrain) : "—"}` : ""}
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
              </button>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
