"use client";

import { ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import {
  BevelDotGauge,
  BevelSegmentedRing,
  CheckRingIcon,
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
import { addDays } from "../lib/nutrition-model";
import { metrics, readingsFor, summary } from "../lib/metrics";
import {
  CATEGORY_LABELS,
  fmtGram,
  fmtKcal,
  fmtRelativeSync,
  mealMethodSummary,
  METHOD_LABELS,
  type AppTab,
  type GoogleIntegrationStatus,
  type NutritionHistory,
  type NutritionSettings,
  type ThemeMode,
  type TrackerSnapshot,
} from "./types";

interface HomeViewProps {
  calendarToday: string;
  activeDay: string;
  viewDay: string;
  waitingForSleep: boolean;
  showSleep: boolean;
  daily: DailyNutritionView;
  history30: NutritionHistory;
  tracker: TrackerSnapshot;
  google: GoogleIntegrationStatus;
  settings: NutritionSettings;
  theme: ThemeMode;
  busy: boolean;
  onToggleTheme: () => void;
  onSelectHomeDay: (day: string) => void;
  onLogMeal: () => void;
  onEditMeal: (meal: MealRecord) => void;
  onToggleComplete: (day: string, complete: boolean) => void;
  onSyncGoogle: () => void;
  onPushGoogle: () => void;
  onNavigate: (tab: AppTab) => void;
}

function summarizeWindow(history: NutritionHistory, fromDay: string) {
  const slice = history.days.filter((d) => d.day >= fromDay);
  const foodComplete = slice.filter((d) => d.diaryComplete && d.totals.calories != null);
  const foodLogged = slice.filter((d) => d.mealCount > 0 && d.totals.calories != null);
  const burnDays = slice.filter((d) => d.energy?.totalKcal != null);
  const comparable = slice.filter((d) => !d.provisional && d.deficit != null);

  const avg = (nums: (number | null)[]) => {
    const valid = nums.filter((n): n is number => n != null);
    return valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
  };
  const netDeficit = comparable.length
    ? Math.round(comparable.reduce((sum, d) => sum + (d.deficit ?? 0), 0))
    : null;

  const intakeSource = foodComplete.length > 0 ? foodComplete : foodLogged;
  const usingUnmarkedFallback = foodComplete.length === 0 && foodLogged.length > 0;

  return {
    totalDays: slice.length,
    comparableDays: comparable.length,
    completeNutritionDays: foodComplete.length,
    loggedDays: foodLogged.length,
    burnDays: burnDays.length,
    usingUnmarkedFallback,
    netDeficit,
    avgDeficit: avg(comparable.map((d) => d.deficit)),
    avgIntake: avg(intakeSource.map((d) => d.totals.calories)),
    avgBurn: avg(burnDays.map((d) => d.energy?.totalKcal ?? null)),
    avgProtein: avg(intakeSource.map((d) => d.totals.proteinG)),
    avgFibre: avg(intakeSource.map((d) => d.totals.fibreG)),
  };
}

function formatDurationMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
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
  waitingForSleep,
  showSleep,
  daily,
  history30,
  tracker,
  google,
  settings,
  busy,
  onSelectHomeDay,
  onEditMeal,
  onToggleComplete,
  onSyncGoogle,
  onPushGoogle,
  onNavigate,
}: HomeViewProps) {
  const intake = daily.totals.calories;
  const target = daily.target;
  const pct = intake == null || target <= 0 ? 0 : Math.min(100, Math.round((intake / target) * 100));
  const overTarget = intake != null && intake > target;

  const weekSummary = summarizeWindow(history30, addDays(calendarToday, -6));
  const monthSummary = summarizeWindow(history30, addDays(calendarToday, -29));

  const remainingLabel =
    intake == null
      ? `${fmtKcal(target)} kcal left`
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

  // Weight resolution: prefer tracker weight readings, fall back to synced daily energy weights
  const weightMetric = metrics.find((m) => m.key === "weight")!;
  const weightReadings = readingsFor(tracker.readings, weightMetric);
  const weightSummary = summary(weightReadings, viewDay);
  const latestEnergyWeight = [...history30.days].reverse().find((d) => d.energy?.weightKg != null)?.energy?.weightKg ?? null;
  const displayWeight = weightSummary.latest?.value ?? daily.energy?.weightKg ?? latestEnergyWeight;
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

  const hasFitbitIntegration = Boolean(google.connected || showSleep || daily.energy?.source === "google");

  const sourceLabel =
    daily.energy?.source === "google"
      ? "Google Health · Fitbit Air"
      : daily.energy?.source === "apple"
        ? "Saved Health Import"
        : daily.energy?.source === "manual"
          ? "Manual TDEE"
          : "No TDEE entered";

  const last7 = history30.days.slice(-7);
  const barCeiling = Math.max(target * 1.15, ...last7.map((d) => d.totals.calories ?? 0), 1000);
  const targetLinePct = Math.min(92, Math.max(8, Math.round((target / barCeiling) * 100)));

  const score = daily.nutritionScore;
  const bedClock = formatIsoClock(daily.sleep?.sleepStart ?? null, daily.timezone);
  const wakeClock = formatIsoClock(daily.sleep?.sleepEnd ?? null, daily.timezone);

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
            {waitingForSleep && viewDay === activeDay && (
              <span className="pill amber-soft">Holding yesterday · pre-sleep</span>
            )}
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
                <div style={{ fontSize: ".76rem", color: "var(--muted)" }}>Allowance status</div>
                <strong className="num" style={{ fontSize: "1.18rem" }}>
                  {remainingLabel}
                </strong>
              </div>
              <button
                type="button"
                className={`pill-btn ${daily.diaryComplete ? "active" : ""}`}
                disabled={busy}
                onClick={() => onToggleComplete(daily.day, !daily.diaryComplete)}
              >
                <CheckRingIcon size={15} />
                {daily.diaryComplete ? "Day complete" : "Finish day"}
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

      {/* Bevel-Style Nutrition Quality Score Card */}
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
          <div className={`score-badge score-grade-${score.grade ?? "none"}`}>
            <strong className="num">{score.score ?? "—"}</strong>
            <span>{score.grade ? `Grade ${score.grade}` : "No data"}</span>
          </div>
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

        {score.contributors.length > 0 && (
          <div className="contrib-list">
            {score.contributors.slice(0, 4).map((c) => (
              <span
                key={`${c.impact}-${c.key}`}
                className={`pill ${c.impact === "positive" ? "teal-soft" : "amber-soft"}`}
                title={c.detail}
              >
                {c.impact === "positive" ? "+" : "−"} {c.label}
              </span>
            ))}
          </div>
        )}
        {score.unknownFibreCount > 0 && (
          <p style={{ fontSize: ".74rem" }}>
            {score.unknownFibreCount} food {score.unknownFibreCount === 1 ? "item has" : "items have"} unrecorded fibre; missing values stay excluded rather than treated as 0 g.
          </p>
        )}
      </section>

      {/* Fitbit Sleep Card (strictly shown only when Fitbit sleep integration is active or sleep exists) */}
      {showSleep && (
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
            <span className={`pill ${daily.sleep ? "teal-soft" : ""}`}>
              {daily.sleep ? formatDurationMinutes(daily.sleep.minutesAsleep) : "—"}
            </span>
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
      )}

      {/* NutriTrace-style 7-Day Calorie Intake Mini Bars */}
      <section className="card week-bars-card" aria-label="7-day calorie intake">
        <div className="split-row" style={{ flexWrap: "nowrap" }}>
          <div style={{ minWidth: 0 }}>
            <h2>Last 7 Days Intake</h2>
            <p style={{ fontSize: ".76rem" }}>Daily intake vs {fmtKcal(target)} kcal target</p>
          </div>
          <button type="button" className="secondary compact" onClick={() => onNavigate("Nutrition")}>
            Open diary
          </button>
        </div>
        <div className="week-bars-wrap">
          <div className="week-target-line" style={{ bottom: `calc(${targetLinePct}% * 0.72 + 18px)` }} />
          {last7.map((d) => {
            const cal = d.totals.calories;
            const barH = cal == null ? 0 : Math.max(8, Math.min(100, Math.round((cal / barCeiling) * 100)));
            const dow = new Date(`${d.day}T12:00:00Z`).toLocaleDateString("en-GB", {
              timeZone: "UTC",
              weekday: "narrow",
            });
            return (
              <div className="week-bar-col" key={d.day} title={`${d.day}: ${cal == null ? "no data" : `${cal} kcal`}`}>
                <div className="week-bar-track">
                  {cal != null && (
                    <div
                      className={`week-bar-fill ${cal > d.target ? "over" : ""}`}
                      style={{ height: `${barH}%` }}
                    />
                  )}
                </div>
                <span className="week-bar-label num">{dow}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Energy Balance & Weight Widget */}
      <section className="card" aria-label="Energy balance and activity">
        <div className="split-row">
          <div style={{ display: "flex", alignItems: "center", gap: ".55rem", minWidth: 0 }}>
            <FitbitPulseIcon size={20} className="accent" />
            <div style={{ minWidth: 0 }}>
              <h2>Energy Balance</h2>
              <p style={{ fontSize: ".76rem" }}>
                {sourceLabel}
                {google.connected && ` · ${fmtRelativeSync(google.lastSync)}`}
                {settings.googleTwoWaySync && google.connected && " · 2-way on"}
              </p>
            </div>
          </div>
          <div className="header-actions">
            {google.connected ? (
              <>
                <button type="button" className="secondary compact" disabled={busy} onClick={onSyncGoogle}>
                  <RefreshCw size={14} /> Sync
                </button>
                {(google.canWriteNutrition || google.canWriteWeights) && (
                  <button type="button" className="secondary compact" disabled={busy} onClick={onPushGoogle} title="Push meals & weights to Google Health">
                    <TwoWaySyncIcon size={14} /> Push
                  </button>
                )}
              </>
            ) : (
              <button type="button" className="secondary compact" onClick={() => onNavigate("Settings")}>
                Add TDEE
              </button>
            )}
          </div>
        </div>

        <div className={`energy-strip ${hasFitbitIntegration ? "" : "energy-strip-compact"}`}>
          <div className="energy-cell">
            <span>
              <FlameBurnIcon size={14} /> Total TDEE
            </span>
            <strong className="num">{daily.energy?.totalKcal != null ? `${fmtKcal(daily.energy.totalKcal)} kcal` : "—"}</strong>
          </div>
          {hasFitbitIntegration && (
            <>
              <div className="energy-cell">
                <span>
                  <FootstepsIcon size={14} /> Steps
                </span>
                <strong className="num">{daily.energy?.steps != null ? daily.energy.steps.toLocaleString("en-GB") : "—"}</strong>
              </div>
              <div className="energy-cell">
                <span>Active burn</span>
                <strong className="num">{daily.energy?.activeKcal != null ? `${fmtKcal(daily.energy.activeKcal)} kcal` : "—"}</strong>
              </div>
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
          {daily.provisional && " Net balance stays provisional until this day is marked complete and TDEE is entered."}
        </p>
      </section>

      {/* Weekly & Monthly Net Calorie Balance Widgets */}
      <section className="two-col" aria-label="Weekly and monthly net calorie balance">
        {[
          { title: "7-Day Net Balance", stats: weekSummary },
          { title: "30-Day Net Balance", stats: monthSummary },
        ].map(({ title, stats }) => {
          const kgEquiv = stats.netDeficit != null ? (stats.netDeficit / 7700).toFixed(2) : null;
          const statusBadge =
            stats.comparableDays > 0
              ? `${stats.comparableDays} of ${stats.totalDays} paired`
              : stats.completeNutritionDays > 0
                ? `${stats.completeNutritionDays} food · add TDEE`
                : stats.loggedDays > 0
                  ? `${stats.loggedDays} logged · tap Finish day`
                  : `0 of ${stats.totalDays} logged`;
          return (
            <article className="card" key={title}>
              <div className="split-row">
                <h2>{title}</h2>
                <span className={`pill ${stats.comparableDays > 0 ? "teal-soft" : stats.completeNutritionDays > 0 ? "accent-soft" : ""}`}>
                  {statusBadge}
                </span>
              </div>
              <div className="reading num" style={{ fontSize: "clamp(1.35rem, 4.2vw, 1.95rem)", margin: ".5rem 0 .25rem" }}>
                {stats.netDeficit != null ? (
                  <>
                    {stats.netDeficit >= 0
                      ? `${stats.netDeficit.toLocaleString("en-GB")} kcal`
                      : `${Math.abs(stats.netDeficit).toLocaleString("en-GB")} kcal`}
                    <small style={{ marginLeft: ".35rem" }}>
                      {stats.netDeficit >= 0 ? "net deficit" : "net surplus"}
                    </small>
                  </>
                ) : stats.completeNutritionDays > 0 ? (
                  <small style={{ fontSize: ".9rem" }}>Add TDEE for deficit</small>
                ) : stats.loggedDays > 0 ? (
                  <small style={{ fontSize: ".9rem" }}>Tap Finish day to lock</small>
                ) : (
                  "—"
                )}
              </div>
              <div className="metric-meta">
                <span>Daily avg balance</span>
                <span className="num">
                  {stats.avgDeficit == null
                    ? "—"
                    : `${stats.avgDeficit >= 0 ? "+" : ""}${stats.avgDeficit.toLocaleString("en-GB")} kcal/d`}
                </span>
              </div>
              <div className="metric-meta">
                <span>Avg intake{stats.usingUnmarkedFallback ? " (unmarked)" : ""} · Avg burn</span>
                <span className="num">
                  {fmtKcal(stats.avgIntake)} · {fmtKcal(stats.avgBurn)} kcal
                </span>
              </div>
              <div className="metric-meta">
                <span>Avg Protein · Fibre</span>
                <span className="num">
                  {stats.avgProtein == null ? "—" : `${stats.avgProtein} g`} · {stats.avgFibre == null ? "—" : `${stats.avgFibre} g`}
                </span>
              </div>
              <div className="metric-meta">
                <span>Est. weight equiv.</span>
                <span className="num">{kgEquiv == null ? "—" : `~${kgEquiv} kg`}</span>
              </div>
            </article>
          );
        })}
      </section>

      {/* Active/Viewed Day Meal Timeline */}
      <section className="card">
        <div className="split-row" style={{ marginBottom: ".65rem" }}>
          <h2>{viewDay === calendarToday ? "Today\u2019s Meals" : `Meals · ${viewTitle}`}</h2>
          <button type="button" className="secondary compact" onClick={() => onNavigate("Nutrition")}>
            Full diary
          </button>
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
