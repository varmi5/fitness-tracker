"use client";

import { ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import {
  BevelDotGauge,
  BevelSegmentedRing,
  FitbitPulseIcon,
  FlameBurnIcon,
  FootstepsIcon,
  McpBrandMark,
  MealCategoryIcon,
  ScaleWeighedIcon,
  SparklePhotoIcon,
  TwoWaySyncIcon,
  WeightScaleIcon,
} from "../components/icons";
import type { DailyNutritionView, MealRecord } from "../lib/nutrition-data";
import { addDays, isCalorieGoalMet } from "../lib/nutrition-model";
import { metrics, readingsFor, summary } from "../lib/metrics";
import { RecoveryCard } from "./recovery-card";
import {
  CATEGORY_LABELS,
  fmtGram,
  fmtKcal,
  fmtRelativeSync,
  mealMethodSummary,
  METHOD_LABELS,
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
  const mins = Math.round(seconds / 60);
  return formatDurationMinutes(mins);
}

function formatIsoClock(iso: string | null, timezone: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
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
  onLogMeal,
  onEditMeal,
  onSyncGoogle,
  onPushGoogle,
  onNavigate,
}: HomeViewProps) {
  const isFitbitMode = settings.trackingMode === "fitbit";
  const isBulkMode = Boolean(settings.bulkMode);

  const intake = daily.totals.calories;
  const target = daily.target;
  const pct = intake == null || target <= 0 ? 0 : Math.min(100, Math.round((intake / target) * 100));
  const goalMet = isCalorieGoalMet(intake, target, isBulkMode);
  const overTarget = goalMet === false;

  const remainingLabel =
    intake == null
      ? isBulkMode
        ? `${fmtKcal(target)} kcal to target`
        : `${fmtKcal(target)} kcal left`
      : isBulkMode
        ? daily.remaining != null && daily.remaining > 0
          ? `${fmtKcal(daily.remaining)} under target`
          : `${fmtKcal(Math.abs(daily.remaining ?? 0))} over · target met`
        : daily.remaining != null && daily.remaining >= 0
          ? `${fmtKcal(daily.remaining)} left`
          : `${fmtKcal(Math.abs(daily.remaining ?? 0))} over`;

  const proteinGoal = daily.macroTargets.proteinG;
  const fibreGoal = daily.macroTargets.fibreG;
  const carbsGoal = daily.macroTargets.carbsG;
  const fatGoal = daily.macroTargets.fatG;

  // Protein & Fibre prioritized on row 1 above Carbs & Fat
  const macroCards = [
    { label: "Protein", val: daily.totals.proteinG, goal: proteinGoal, color: "var(--macro-protein)", priority: true },
    { label: "Fibre", val: daily.totals.fibreG, goal: fibreGoal, color: "var(--macro-fibre)", priority: true },
    { label: "Carbs", val: daily.totals.carbsG, goal: carbsGoal, color: "var(--macro-carbs)", priority: false },
    { label: "Fat", val: daily.totals.fatG, goal: fatGoal, color: "var(--macro-fat)", priority: false },
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

  const manualSourceLabel =
    daily.energy?.source === "manual"
      ? "Manual TDEE"
      : daily.energy?.source === "apple"
        ? "Saved Health Import"
        : "Manual TDEE mode · No TDEE entered";

  const score = daily.nutritionScore;
  const bedClock = formatIsoClock(daily.sleep?.sleepStart ?? null, daily.timezone);
  const wakeClock = formatIsoClock(daily.sleep?.sleepEnd ?? null, daily.timezone);

  const showManualSteps = !isFitbitMode && daily.energy?.steps != null;
  const showManualActiveBurn = !isFitbitMode && daily.energy?.activeKcal != null;

  return (
    <>
      <div className="page-header">
        <div className="page-header-title" style={{ width: "100%" }}>
          <div className="brand-lockup" style={{ marginBottom: ".2rem" }}>
            <span className="brand-badge"><McpBrandMark size={16} /></span>
            <span>FitnessTrackr</span>
          </div>
          <div className="home-date-nav">
            <button
              type="button"
              className="secondary compact home-step-btn"
              aria-label="Previous day"
              onClick={() => onSelectHomeDay(addDays(viewDay, -1))}
            >
              <ChevronLeft size={18} />
            </button>
            <h1>{viewTitle}</h1>
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
          <div className="page-sub">
            <span>{viewDateDisplay}</span>
            <span className="pill">{daily.timezone}</span>
            {viewDay !== activeDay && (
              <button
                type="button"
                className="secondary compact"
                style={{ minHeight: "34px", padding: ".2rem .65rem", fontSize: ".76rem" }}
                onClick={() => onSelectHomeDay(activeDay)}
              >
                Back to {activeDay === calendarToday ? "today" : "active day"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tappable Overall Strain Hero Summary Card */}
      {strain && (
        <button
          type="button"
          className="card"
          aria-label="Overall Strain summary"
          onClick={() => (onOpenTraining ? onOpenTraining(viewDay) : onNavigate("Training"))}
          style={{
            width: "100%",
            textAlign: "left",
            cursor: "pointer",
            display: "grid",
            gap: ".75rem",
          }}
        >
          <div className="split-row">
            <span className="eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: ".4rem" }}>
              <FitbitPulseIcon size={15} />
              Overall Strain
            </span>
            <span className="pill">
              {strain.confidence} · View breakdown →
            </span>
          </div>
          <div className="split-row" style={{ alignItems: "baseline" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: ".35rem" }}>
              <strong className="num" style={{ fontSize: "2rem", lineHeight: 1 }}>
                {Math.round(strain.overallStrain)}
              </strong>
              <span className="muted" style={{ fontSize: ".9rem" }}>/ 100</span>
            </div>
            <div className="muted" style={{ fontSize: ".82rem", display: "flex", gap: ".85rem", flexWrap: "wrap" }}>
              <span>
                Cardio <strong className="num">{Math.round(strain.cardioStrain)}</strong>
              </span>
              <span>
                Muscular <strong className="num">{Math.round(strain.muscularStrain)}</strong>
              </span>
              <span>
                Walking <strong className="num">+{strain.walkingPoints.toFixed(1)}</strong>
              </span>
            </div>
          </div>
        </button>
      )}

      {/* Stage 7: Recovery Insights (separated from Strain, Fitbit/wearable mode only on Home) */}
      {isFitbitMode && <RecoveryCard recovery={recoveryInsights} />}

      {/* Bevel Segmented Calorie Hero Card */}
      <section className="card card-hero" aria-label="Daily calorie summary">
        <div className="ring-layout">
          <div className="ring-wrap">
            <BevelSegmentedRing pct={pct} overTarget={overTarget} />
            <div className="ring-center">
              <strong className="num">{fmtKcal(intake ?? 0)}</strong>
              <span>{intake == null ? "no meals yet" : `of ${fmtKcal(target)} kcal`}</span>
            </div>
          </div>

          <div className="hero-stats">
            <div className="split-row">
              <div>
                <div style={{ fontSize: ".76rem", color: "var(--muted)" }}>
                  {isBulkMode ? "Bulk target status" : "Allowance status"}
                </div>
                <strong
                  className="num"
                  style={{
                    fontSize: "1.18rem",
                    color: goalMet === null ? "var(--text)" : goalMet ? "var(--accent)" : "var(--danger-fg)",
                  }}
                >
                  {remainingLabel}
                </strong>
              </div>
              <button
                type="button"
                className={`pill score-pill-${score.grade ?? "none"}`}
                style={{ minHeight: "36px", cursor: "pointer" }}
                onClick={() => onNavigate("Nutrition")}
              >
                <span>Score</span>
                <strong className="num">
                  {score.score == null ? "—" : `${score.score}/100`}
                </strong>
                {score.grade && <span>· {score.grade}</span>}
              </button>
            </div>

            <div className="hero-figures">
              <div className="stat-mini">
                <span>Consumed</span>
                <strong className="num">{intake == null ? "—" : fmtKcal(intake)}</strong>
              </div>
              <div className="stat-mini">
                <span>Target</span>
                <strong className="num">{fmtKcal(target)}</strong>
              </div>
              <div className="stat-mini">
                <span>Meals</span>
                <strong className="num">{daily.meals.length}</strong>
              </div>
            </div>

            {daily.totals.calMin != null && daily.totals.calMax != null && (
              <div className="meal-meta">
                <span>
                  Uncertainty range:{" "}
                  <strong className="num">
                    {fmtKcal(daily.totals.calMin)}–{fmtKcal(daily.totals.calMax)} kcal
                  </strong>
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Priority Macros: Protein & Fibre ABOVE Carbs & Fat */}
      <section className="macro-grid" aria-label="Daily macronutrients">
        {macroCards.map((m) => {
          const fillPct = m.val == null ? 0 : Math.min(100, Math.round((m.val / m.goal) * 100));
          return (
            <article className={`macro-tile ${m.priority ? "priority" : ""}`} key={m.label}>
              <div className="macro-head">
                <div>
                  <div className="macro-top" style={{ gap: ".35rem", justifyContent: "flex-start" }}>
                    <span style={{ fontWeight: m.priority ? 700 : 600, color: m.priority ? "var(--text)" : "var(--muted)" }}>
                      {m.label}
                    </span>
                    <span className="num">· ~{m.goal}g</span>
                  </div>
                  <div className="macro-val num" style={{ marginTop: ".15rem" }}>
                    {fmtGram(m.val)}
                  </div>
                </div>
                <BevelDotGauge pct={fillPct} color={m.color} />
              </div>
              <div className="macro-bar">
                <i style={{ width: `${fillPct}%`, background: m.color }} />
              </div>
            </article>
          );
        })}
      </section>

      {/* Compact Nutrition Quality Score Strip (viewDay-scoped, links to Nutrition) */}
      <section className="card score-card" aria-label="Nutrition quality score">
        <div className="split-row">
          <div>
            <h2>Nutrition Score</h2>
            <p style={{ fontSize: ".76rem" }}>
              {score.coverage === "empty"
                ? "Log meals to score food quality, whole foods, protein & fibre"
                : score.coverage === "early"
                  ? `Early estimate (${daily.meals.length} ${daily.meals.length === 1 ? "meal" : "meals"} logged)`
                  : `Food quality, macro balance & fibre · ${daily.meals.length} ${daily.meals.length === 1 ? "meal" : "meals"}`}
            </p>
          </div>
          <button
            type="button"
            className={`score-badge score-grade-${score.grade ?? "none"}`}
            onClick={() => onNavigate("Nutrition")}
            title="View full nutrition diary & trends"
          >
            <strong className="num">{score.score ?? "—"}</strong>
            <span>{score.grade ? `Grade ${score.grade}` : "No data"}</span>
          </button>
        </div>

        <div className="score-pillars">
          <div className="energy-cell">
            <span>Fibre</span>
            <strong className="num">{score.fibreSubscore == null ? "—" : `${score.fibreSubscore}/100`}</strong>
            <small className="num">{fmtGram(daily.totals.fibreG)} / {fibreGoal}g</small>
          </div>
          <div className="energy-cell">
            <span>Protein</span>
            <strong className="num">{score.proteinSubscore == null ? "—" : `${score.proteinSubscore}/100`}</strong>
            <small className="num">{fmtGram(daily.totals.proteinG)} / {proteinGoal}g</small>
          </div>
          <div className="energy-cell">
            <span>Whole foods</span>
            <strong className="num">{score.wholeFoodPct == null ? "—" : `${score.wholeFoodPct}%`}</strong>
            <small>NOVA 1–2 share</small>
          </div>
          <div className="energy-cell">
            <span>Food quality</span>
            <strong className="num">{score.qualitySubscore == null ? "—" : `${score.qualitySubscore}/100`}</strong>
            <small>FSA + processing</small>
          </div>
        </div>
      </section>

      {/* Energy Balance & Activity Card (strictly viewDay-scoped and mode-adaptive) */}
      <section className="card" aria-label="Energy balance and activity">
        <div className="split-row">
          <div style={{ display: "flex", alignItems: "center", gap: ".55rem", minWidth: 0 }}>
            {isFitbitMode ? <FitbitPulseIcon size={20} className="accent" /> : <FlameBurnIcon size={20} className="accent" />}
            <div style={{ minWidth: 0 }}>
              <h2>{isFitbitMode ? "Energy & Activity" : "Energy Balance"}</h2>
              <p style={{ fontSize: ".76rem" }}>
                {isFitbitMode ? (
                  <>
                    Google Health · Fitbit Air
                    {google.connected && ` · ${fmtRelativeSync(google.lastSync)}`}
                    {settings.googleTwoWaySync && google.connected && " · 2-way on"}
                  </>
                ) : (
                  manualSourceLabel
                )}
              </p>
            </div>
          </div>
          <div className="header-actions">
            {isFitbitMode ? (
              google.connected ? (
                <>
                  <button type="button" className="secondary compact" disabled={busy} onClick={onSyncGoogle}>
                    <RefreshCw size={14} /> Sync
                  </button>
                  {(google.canWriteNutrition || google.canWriteWeights) && (
                    <button
                      type="button"
                      className="secondary compact"
                      disabled={busy}
                      onClick={onPushGoogle}
                      title="Push meals & weights to Google Health"
                    >
                      <TwoWaySyncIcon size={14} /> Push
                    </button>
                  )}
                </>
              ) : (
                <button type="button" className="secondary compact" onClick={() => onNavigate("More")}>
                  Connect Fitbit
                </button>
              )
            ) : (
              <button type="button" className="secondary compact" onClick={() => onNavigate("More")}>
                {daily.energy?.totalKcal != null ? "Edit TDEE" : "Add TDEE"}
              </button>
            )}
          </div>
        </div>

        <div className={`energy-strip ${isFitbitMode || showManualSteps || showManualActiveBurn ? "" : "energy-strip-compact"}`}>
          <div className="energy-cell">
            <span>
              <FlameBurnIcon size={14} /> Total TDEE
            </span>
            <strong className="num">
              {daily.energy?.totalKcal != null ? `${fmtKcal(daily.energy.totalKcal)} kcal` : "—"}
            </strong>
          </div>

          {isFitbitMode ? (
            <>
              <div className="energy-cell">
                <span>Active burn</span>
                <strong className="num">
                  {daily.energy?.activeKcal != null ? `${fmtKcal(daily.energy.activeKcal)} kcal` : "—"}
                </strong>
              </div>
              <div className="energy-cell">
                <span>
                  <FootstepsIcon size={14} /> Steps
                </span>
                <strong className="num">
                  {daily.energy?.steps != null ? daily.energy.steps.toLocaleString("en-GB") : "—"}
                </strong>
              </div>
              <div className="energy-cell">
                <span>Zone mins</span>
                <strong className="num">
                  {daily.energy?.activeZoneMinutes != null ? `${daily.energy.activeZoneMinutes} min` : "—"}
                </strong>
              </div>
              <div className="energy-cell">
                <span>Distance</span>
                <strong className="num">
                  {daily.energy?.distanceMeters != null ? `${(daily.energy.distanceMeters / 1000).toFixed(1)} km` : "—"}
                </strong>
              </div>
              {daily.energy?.floors != null && (
                <div className="energy-cell">
                  <span>Floors</span>
                  <strong className="num">{daily.energy.floors}</strong>
                </div>
              )}
            </>
          ) : (
            <>
              {showManualSteps && (
                <div className="energy-cell">
                  <span>
                    <FootstepsIcon size={14} /> Steps
                  </span>
                  <strong className="num">{daily.energy!.steps!.toLocaleString("en-GB")}</strong>
                </div>
              )}
              {showManualActiveBurn && (
                <div className="energy-cell">
                  <span>Active burn</span>
                  <strong className="num">{fmtKcal(daily.energy!.activeKcal)} kcal</strong>
                </div>
              )}
            </>
          )}

          <div className="energy-cell">
            <span>
              <WeightScaleIcon size={14} /> Weight
            </span>
            <strong className="num">
              {displayWeight != null ? `${Number(displayWeight.toFixed(1))} kg` : "—"}
            </strong>
            {weightChange7d != null && (
              <small style={{ fontSize: ".7rem", color: "var(--muted)" }} className="num">
                7d {weightChange7d > 0 ? "+" : ""}
                {weightChange7d.toFixed(1)} kg
              </small>
            )}
          </div>
          <div className="energy-cell">
            <span>Net balance</span>
            <strong className="num" style={{ color: daily.deficit != null && daily.deficit >= 0 ? "var(--teal)" : "var(--text)" }}>
              {daily.deficit == null
                ? "—"
                : daily.deficit >= 0
                  ? `${fmtKcal(daily.deficit)} deficit`
                  : `${fmtKcal(Math.abs(daily.deficit))} surplus`}
            </strong>
          </div>
        </div>
        <p style={{ fontSize: ".74rem", marginTop: ".6rem" }}>
          Total TDEE already includes resting metabolism.
          {daily.provisional &&
            (daily.diaryComplete
              ? " Add TDEE to lock net balance for this day."
              : " Net balance updates as you log meals and locks at midnight.")}
        </p>
      </section>

      {/* Fitbit-Only Cards: Sleep and Workouts (viewDay-scoped) */}
      {isFitbitMode && (
        <>
          <section className="card sleep-card" aria-label="Sleep summary">
            <div className="split-row">
              <div>
                <h2>Sleep</h2>
                <p style={{ fontSize: ".76rem" }}>
                  {daily.sleep
                    ? bedClock && wakeClock
                      ? `Slept ${bedClock} → woke ${wakeClock}`
                      : "Synced from Fitbit Air"
                    : "No Fitbit sleep recorded for this date"}
                </p>
              </div>
              <div className="button-row">
                {daily.sleep?.sleepEfficiencyPct != null && (
                  <span className="pill accent-soft num">{daily.sleep.sleepEfficiencyPct}% efficiency</span>
                )}
                <span className={`pill ${daily.sleep ? "teal-soft" : ""}`}>
                  {daily.sleep ? formatDurationMinutes(daily.sleep.minutesAsleep) : "—"}
                </span>
              </div>
            </div>
            {daily.sleep && (
              <div className="sleep-stages">
                <div className="energy-cell">
                  <span>Deep</span>
                  <strong className="num">{daily.sleep.deepMinutes != null ? `${daily.sleep.deepMinutes}m` : "—"}</strong>
                </div>
                <div className="energy-cell">
                  <span>REM</span>
                  <strong className="num">{daily.sleep.remMinutes != null ? `${daily.sleep.remMinutes}m` : "—"}</strong>
                </div>
                <div className="energy-cell">
                  <span>Light</span>
                  <strong className="num">{daily.sleep.lightMinutes != null ? `${daily.sleep.lightMinutes}m` : "—"}</strong>
                </div>
                <div className="energy-cell">
                  <span>Awake</span>
                  <strong className="num">{daily.sleep.minutesAwake != null ? `${daily.sleep.minutesAwake}m` : "—"}</strong>
                </div>
              </div>
            )}
          </section>

          {daily.workouts.length > 0 && (
            <section className="card" aria-label="Workouts">
              <div className="split-row" style={{ marginBottom: ".65rem" }}>
                <h2>Workouts</h2>
                <span className="pill teal-soft num">{daily.workouts.length} logged</span>
              </div>
              <div className="meal-list">
                {daily.workouts.map((w) => {
                  const dur = formatDurationSeconds(w.durationSeconds);
                  const startClock = formatIsoClock(w.startTime, daily.timezone);
                  return (
                    <div className="meal-card" key={w.sessionId}>
                      <div className="meal-head">
                        <div>
                          <div className="meal-title-row">
                            <strong>{w.title}</strong>
                            {w.exerciseType && w.exerciseType !== w.title && (
                              <span className="pill">{w.exerciseType}</span>
                            )}
                          </div>
                          <div className="meal-meta" style={{ marginTop: ".3rem" }}>
                            {startClock && <span className="num">{startClock}</span>}
                            {dur && <span className="num">{dur}</span>}
                            {w.avgHrBpm != null && <span className="num">{Math.round(w.avgHrBpm)} bpm avg</span>}
                            {w.activeZoneMinutes != null && <span className="pill accent-soft num">{w.activeZoneMinutes} AZM</span>}
                            {w.distanceMeters != null && <span className="num">{(w.distanceMeters / 1000).toFixed(2)} km</span>}
                          </div>
                        </div>
                        <div className="meal-kcal">
                          <strong className="num">
                            {w.caloriesKcal != null ? `${fmtKcal(w.caloriesKcal)} kcal` : "—"}
                          </strong>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      {/* Viewed Day Meal Timeline */}
      <section className="card">
        <div className="split-row" style={{ marginBottom: ".65rem" }}>
          <h2>{viewDay === calendarToday ? "Today\u2019s Meals" : `Meals · ${viewTitle}`}</h2>
          <div className="button-row">
            <button type="button" className="secondary compact" onClick={onLogMeal}>
              <Plus size={14} /> Add meal
            </button>
            <button type="button" className="secondary compact" onClick={() => onNavigate("Nutrition")}>
              Full diary
            </button>
          </div>
        </div>
        {daily.meals.length === 0 ? (
          <p style={{ fontSize: ".88rem" }}>
            No meals logged for this day yet. Tap <strong>Log meal</strong> or send a meal photo through your ChatGPT MCP connector.
          </p>
        ) : (
          <div className="meal-list">
            {daily.meals.map((m) => {
              const method = mealMethodSummary(m);
              return (
                <div className="meal-card" key={m.id}>
                  <div className="meal-head">
                    <div>
                      <div className="meal-title-row">
                        <span className="pill">
                          <MealCategoryIcon category={m.category} size={13} />
                          {CATEGORY_LABELS[m.category]}
                        </span>
                        <strong>{m.name}</strong>
                      </div>
                      <div className="meal-meta" style={{ marginTop: ".3rem" }}>
                        <span className="num">{m.localTime}</span>
                        <span>{m.items.length} {m.items.length === 1 ? "item" : "items"}</span>
                        <span className={`pill ${method === "weighed" ? "accent-soft" : method === "photo_estimate" ? "amber-soft" : ""}`}>
                          {method === "weighed" ? <ScaleWeighedIcon size={12} /> : <SparklePhotoIcon size={12} />}
                          {METHOD_LABELS[method]}
                        </span>
                        <span className={`pill score-pill-${m.qualityScore.grade}`}>
                          Score {m.qualityScore.score} · {m.qualityScore.grade}
                        </span>
                      </div>
                    </div>
                    <div className="meal-kcal">
                      <strong className="num">{fmtKcal(m.totals.calories)} kcal</strong>
                      <small className="num">
                        P {fmtGram(m.totals.proteinG)} · Fib {fmtGram(m.totals.fibreG)}
                      </small>
                    </div>
                  </div>
                  <div className="button-row">
                    <button type="button" className="secondary compact" onClick={() => onEditMeal(m)}>
                      Edit / details
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
