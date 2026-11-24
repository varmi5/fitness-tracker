"use client";

import { useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RefreshCw } from "lucide-react";
import { BevelScoreRing, CalorieSlider } from "../components/bevel-widgets";
import { McpBrandMark, MealCategoryIcon } from "../components/icons";
import type { DailyNutritionView, MealRecord } from "../lib/nutrition-data";
import { addDays, isCalorieGoalMet } from "../lib/nutrition-model";
import { computeTargetStrain } from "../lib/strain-engine";
import { metrics, readingsFor, summary } from "../lib/metrics";
import {
  CATEGORY_LABELS,
  fmtGram,
  fmtKcal,
  type AppTab,
  type DailyStrainView,
  type GoogleIntegrationStatus,
  type NutritionHistory,
  type NutritionSettings,
  type RecoveryInsightView,
  type ThemeMode,
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
  theme: ThemeMode;
  busy: boolean;
  onToggleTheme: () => void;
  onSelectHomeDay: (day: string) => void;
  onOpenTraining?: (day: string) => void;
  onLogMeal: () => void;
  onEditMeal: (meal: MealRecord) => void;
  onSyncGoogle: () => void;
  onPushGoogle: () => void;
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
  busy,
  onSelectHomeDay,
  onOpenTraining,
  onEditMeal,
  onSyncGoogle,
  onNavigate,
}: HomeViewProps) {
  const [mealsExpanded, setMealsExpanded] = useState(false);
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

  // Weight resolution scoped strictly to viewDay
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

  const strainTarget = computeTargetStrain(recoveryInsights?.score);
  const overallStrain = strain?.overallStrain ?? null;
  const recoveryScore = recoveryInsights?.score ?? null;
  const sleepMinutes = daily.sleep?.minutesAsleep ?? recoveryInsights?.metrics.sleepMinutes ?? null;
  const sleepPct = sleepMinutes != null ? Math.min(100, Math.round((sleepMinutes / 480) * 100)) : 0;
  const vitalsPending = isFitbitMode && recoveryScore == null && sleepMinutes == null;

  const primaryWorkout =
    strain?.activities.find((a) => a.kind === "strength" || a.kind === "cardio") ?? null;

  const openTrainingView = () => (onOpenTraining ? onOpenTraining(viewDay) : onNavigate("Training"));

  return (
    <>
      {/* Minimal Bevel Header */}
      <div className="page-header" style={{ marginBottom: ".15rem" }}>
        <div className="page-header-title" style={{ width: "100%" }}>
          <div className="split-row" style={{ alignItems: "center" }}>
            <div className="brand-lockup">
              <span className="brand-badge">
                <McpBrandMark size={15} />
              </span>
              <span style={{ fontSize: ".82rem", letterSpacing: "-0.01em" }}>FitnessTrackr</span>
            </div>
            {isFitbitMode && google.connected && (
              <button
                type="button"
                className="secondary compact"
                style={{ minHeight: "32px", padding: ".2rem .6rem", fontSize: ".74rem" }}
                disabled={busy}
                onClick={onSyncGoogle}
                aria-label="Sync Google Health"
              >
                <RefreshCw size={12} /> Sync
              </button>
            )}
          </div>

          <div className="home-date-nav" style={{ marginTop: ".25rem" }}>
            <button
              type="button"
              className="secondary compact home-step-btn"
              aria-label="Previous day"
              onClick={() => onSelectHomeDay(addDays(viewDay, -1))}
            >
              <ChevronLeft size={18} />
            </button>
            <div style={{ textAlign: "center" }}>
              <h1 style={{ fontSize: "1.45rem", letterSpacing: "-0.03em", margin: 0 }}>{viewTitle}</h1>
              <div style={{ fontSize: ".76rem", color: "var(--muted)" }}>{viewDateDisplay}</div>
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
            <div style={{ display: "flex", justifyContent: "center", marginTop: ".25rem" }}>
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
        </div>
      </div>

      {/* Bevel-Style Triple-Ring Hero (Strain · Recovery · Sleep) */}
      <section className="card triple-ring-card" aria-label="Daily score rings">
        {isFitbitMode ? (
          <div className="triple-ring-grid">
            <BevelScoreRing
              label="Strain"
              value={overallStrain}
              displayText={overallStrain == null ? "—" : Math.round(overallStrain).toString()}
              pct={overallStrain ?? 0}
              color="var(--strain-color)"
              targetRange={[strainTarget.min, strainTarget.max]}
              sublabel={`Target ${strainTarget.min}–${strainTarget.max}`}
              onClick={openTrainingView}
            />
            <BevelScoreRing
              label="Recovery"
              value={recoveryScore}
              displayText={recoveryScore == null ? "—" : `${recoveryScore}%`}
              pct={recoveryScore ?? 0}
              color="var(--recovery-color)"
              sublabel={
                recoveryInsights?.band === "optimal"
                  ? "Optimal"
                  : recoveryInsights?.band === "moderate"
                    ? "Moderate"
                    : recoveryInsights?.band === "strained"
                      ? "Strained"
                      : "Pending"
              }
              onClick={openTrainingView}
            />
            <BevelScoreRing
              label="Sleep"
              value={sleepMinutes}
              displayText={sleepMinutes == null ? "—" : formatDurationMinutes(sleepMinutes)}
              pct={sleepPct}
              color="var(--sleep-color)"
              sublabel={sleepMinutes == null ? "Pending" : `${sleepPct}% of 8h`}
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
                  {strain?.muscularStrain != null
                    ? `Muscular ${Math.round(strain.muscularStrain)} · Cardio ${Math.round(strain.cardioStrain ?? 0)}`
                    : "Tap to view Training & Strain"}
                </div>
              </div>
            </div>
            <ChevronRight size={18} style={{ color: "var(--muted)" }} />
          </button>
        )}

        {/* Hidden semantic hook for Fitbit mode so tapping Strain opens Training */}
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
            <span>Awaiting morning vitals sync</span>
            {google.connected && (
              <button
                type="button"
                className="secondary compact"
                style={{ minHeight: "28px", padding: ".15rem .5rem", fontSize: ".72rem" }}
                disabled={busy}
                onClick={onSyncGoogle}
              >
                Refresh
              </button>
            )}
          </div>
        )}

        {isFitbitMode && sleepDetailOpen && daily.sleep && (
          <div className="muscle-detail-bar" style={{ marginTop: ".1rem" }}>
            <div className="split-row" style={{ fontSize: ".8rem" }}>
              <strong>Sleep Breakdown</strong>
              <span className="num">{formatDurationMinutes(daily.sleep.minutesAsleep)}</span>
            </div>
            <div className="split-row" style={{ fontSize: ".75rem", color: "var(--muted)" }}>
              <span>Deep {daily.sleep.deepMinutes != null ? formatDurationMinutes(daily.sleep.deepMinutes) : "—"}</span>
              <span>REM {daily.sleep.remMinutes != null ? formatDurationMinutes(daily.sleep.remMinutes) : "—"}</span>
              <span>Light {daily.sleep.lightMinutes != null ? formatDurationMinutes(daily.sleep.lightMinutes) : "—"}</span>
            </div>
          </div>
        )}
      </section>

      {/* Bevel-Style Calorie Intake Linear Slider Card */}
      <CalorieSlider
        title="Calorie Intake"
        consumedText={intake == null ? "0" : fmtKcal(intake)}
        targetText={`${fmtKcal(target)} kcal`}
        statusText={remainingLabel}
        fillPct={calPct}
        isOnTarget={goalMet}
        isBulkMode={isBulkMode}
        macros={macroBars}
        onClick={() => onNavigate("Nutrition")}
      />

      {/* Compact Today's Activity & Snapshot Card (Click-to-Expand, Zero Bloat) */}
      <section className="card" style={{ display: "grid", gap: ".1rem" }} aria-label="Daily snapshot">
        {primaryWorkout && (
          <button type="button" className="compact-row-btn" onClick={openTrainingView}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: ".45rem" }}>
                <strong style={{ fontSize: ".92rem" }}>{primaryWorkout.title}</strong>
                <span className="pill" style={{ fontSize: ".68rem", padding: ".1rem .45rem" }}>
                  {primaryWorkout.source}
                </span>
              </div>
              <div style={{ fontSize: ".76rem", color: "var(--muted)", marginTop: ".15rem" }}>
                {formatDurationSeconds(primaryWorkout.durationSeconds) ?? "—"}
                {primaryWorkout.mRaw > 0 ? ` · Muscular ${Math.round(strain?.muscularStrain ?? 0)}` : ""}
                {primaryWorkout.cRaw > 0 ? ` · Cardio ${Math.round(strain?.cardioStrain ?? 0)}` : ""}
              </div>
            </div>
            <ChevronRight size={16} style={{ color: "var(--muted)" }} />
          </button>
        )}

        <button
          type="button"
          className="compact-row-btn"
          onClick={() => setMealsExpanded((v) => !v)}
          aria-expanded={mealsExpanded}
        >
          <div>
            <strong style={{ fontSize: ".92rem" }}>Meals</strong>
            <div style={{ fontSize: ".76rem", color: "var(--muted)", marginTop: ".1rem" }}>
              {daily.meals.length === 0
                ? "No meals logged yet"
                : `${daily.meals.length} ${daily.meals.length === 1 ? "meal" : "meals"} · ${fmtKcal(intake)} kcal`}
            </div>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: ".35rem", color: "var(--muted)" }}>
            {daily.nutritionScore.grade && (
              <span className={`pill score-pill-${daily.nutritionScore.grade}`} style={{ fontSize: ".7rem" }}>
                {daily.nutritionScore.grade}
              </span>
            )}
            {mealsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
        </button>

        {mealsExpanded && (
          <div style={{ display: "grid", gap: ".4rem", paddingBottom: ".5rem" }}>
            {daily.meals.length === 0 ? (
              <p className="empty" style={{ padding: ".4rem 0", fontSize: ".8rem" }}>
                Tap + below to log a meal or scan a barcode.
              </p>
            ) : (
              daily.meals.map((meal) => (
                <button
                  key={meal.id}
                  type="button"
                  className="compact-row-btn"
                  style={{ padding: ".45rem .6rem", background: "var(--surface-soft)", borderRadius: "10px", borderTop: 0 }}
                  onClick={() => onEditMeal(meal)}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: ".45rem", minWidth: 0 }}>
                    <MealCategoryIcon category={meal.category} size={14} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: ".84rem", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {meal.name}
                      </div>
                      <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>
                        {CATEGORY_LABELS[meal.category]} · {meal.localTime}
                      </div>
                    </div>
                  </div>
                  <strong className="num" style={{ fontSize: ".86rem" }}>
                    {fmtKcal(meal.totals.calories)}
                  </strong>
                </button>
              ))
            )}
          </div>
        )}

        <button
          type="button"
          className="compact-row-btn"
          onClick={() => onNavigate("More")}
        >
          <div>
            <strong style={{ fontSize: ".92rem" }}>Body Weight</strong>
            <div style={{ fontSize: ".76rem", color: "var(--muted)", marginTop: ".1rem" }}>
              {displayWeight != null ? `${displayWeight.toFixed(1)} kg` : "No weight logged"}
              {weightChange7d != null ? ` · ${weightChange7d > 0 ? "+" : ""}${weightChange7d.toFixed(1)} kg (7d)` : ""}
            </div>
          </div>
          <ChevronRight size={16} style={{ color: "var(--muted)" }} />
        </button>

        {isFitbitMode && daily.energy?.steps != null && (
          <button
            type="button"
            className="compact-row-btn"
            onClick={openTrainingView}
          >
            <div>
              <strong style={{ fontSize: ".92rem" }}>Daily Steps</strong>
              <div style={{ fontSize: ".76rem", color: "var(--muted)", marginTop: ".1rem" }}>
                <span className="num">{daily.energy.steps.toLocaleString("en-GB")}</span> steps
                {daily.energy.totalKcal != null ? ` · ${fmtKcal(daily.energy.totalKcal)} kcal burn` : ""}
              </div>
            </div>
            <ChevronRight size={16} style={{ color: "var(--muted)" }} />
          </button>
        )}
      </section>
    </>
  );
}
