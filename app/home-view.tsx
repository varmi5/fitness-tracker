"use client";

import { Plus, RefreshCw } from "lucide-react";
import {
  CheckRingIcon,
  FitbitPulseIcon,
  FlameBurnIcon,
  FootstepsIcon,
  ScaleWeighedIcon,
  SparklePhotoIcon,
} from "../components/icons";
import { addDays } from "../lib/nutrition-model";
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
} from "./types";
import type { DailyNutritionView, MealRecord } from "../lib/nutrition-data";

interface HomeViewProps {
  today: string;
  daily: DailyNutritionView;
  history30: NutritionHistory;
  google: GoogleIntegrationStatus;
  busy: boolean;
  onLogMeal: () => void;
  onEditMeal: (meal: MealRecord) => void;
  onToggleComplete: (day: string, complete: boolean) => void;
  onSyncGoogle: () => void;
  onNavigate: (tab: AppTab) => void;
}

function summarizeWindow(history: NutritionHistory, fromDay: string) {
  const slice = history.days.filter((d) => d.day >= fromDay);
  const completeNutrition = slice.filter((d) => d.diaryComplete && d.totals.calories != null);
  const comparable = slice.filter((d) => !d.provisional && d.deficit != null);
  const avg = (nums: (number | null)[]) => {
    const valid = nums.filter((n): n is number => n != null);
    return valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
  };
  const netDeficit = comparable.length
    ? Math.round(comparable.reduce((sum, d) => sum + (d.deficit ?? 0), 0))
    : null;

  return {
    totalDays: slice.length,
    comparableDays: comparable.length,
    completeNutritionDays: completeNutrition.length,
    netDeficit,
    avgDeficit: avg(comparable.map((d) => d.deficit)),
    avgIntake: avg(completeNutrition.map((d) => d.totals.calories)),
    avgBurn: avg(comparable.map((d) => d.energy?.totalKcal ?? null)),
    avgProtein: avg(completeNutrition.map((d) => d.totals.proteinG)),
  };
}

export function HomeView({
  today,
  daily,
  history30,
  google,
  busy,
  onLogMeal,
  onEditMeal,
  onToggleComplete,
  onSyncGoogle,
  onNavigate,
}: HomeViewProps) {
  const intake = daily.totals.calories;
  const target = daily.target;
  const pct = intake == null || target <= 0 ? 0 : Math.min(100, Math.round((intake / target) * 100));
  const overTarget = intake != null && intake > target;
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (circumference * pct) / 100;

  const weekSummary = summarizeWindow(history30, addDays(today, -6));
  const monthSummary = summarizeWindow(history30, addDays(today, -29));

  const remainingLabel =
    intake == null
      ? `${fmtKcal(target)} kcal left`
      : daily.remaining != null && daily.remaining >= 0
        ? `${fmtKcal(daily.remaining)} left`
        : `${fmtKcal(Math.abs(daily.remaining ?? 0))} above target`;

  const proteinGoal = Math.round((target * 0.3) / 4);
  const carbsGoal = Math.round((target * 0.4) / 4);
  const fatGoal = Math.round((target * 0.3) / 9);
  const fibreGoal = 30;

  const macroCards = [
    { label: "Protein", val: daily.totals.proteinG, goal: proteinGoal, color: "var(--accent)" },
    { label: "Carbs", val: daily.totals.carbsG, goal: carbsGoal, color: "var(--blue)" },
    { label: "Fat", val: daily.totals.fatG, goal: fatGoal, color: "var(--amber)" },
    { label: "Fibre", val: daily.totals.fibreG, goal: fibreGoal, color: "var(--teal)" },
  ];

  const todayDisplay = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "short",
  });

  const sourceLabel =
    daily.energy?.source === "google"
      ? "Google Health · Fitbit"
      : daily.energy?.source === "apple"
        ? "Apple Health"
        : daily.energy?.source === "manual"
          ? "Manual TDEE"
          : "No burn synced";

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Home</h1>
          <div className="page-sub">
            <span>{todayDisplay}</span>
            <span className="pill">{daily.timezone}</span>
          </div>
        </div>
        <ButtonLike onClick={onLogMeal} />
      </div>

      {/* Calorie Ring Hero Card */}
      <section className="card card-hero" aria-label="Daily calorie summary">
        <div className="ring-layout">
          <div className="ring-wrap">
            <svg className="ring-svg" viewBox="0 0 136 136" aria-hidden="true">
              <circle className="ring-track" cx="68" cy="68" r={radius} />
              <circle
                className={`ring-fill${overTarget ? " over" : ""}`}
                cx="68"
                cy="68"
                r={radius}
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
              />
            </svg>
            <div className="ring-center">
              <strong className="num">{fmtKcal(intake ?? 0)}</strong>
              <span>{intake == null ? "no food logged" : `of ${fmtKcal(target)} kcal`}</span>
            </div>
          </div>

          <div className="hero-stats">
            <div className="split-row">
              <div>
                <div style={{ fontSize: "0.78rem", color: "var(--muted)" }}>Allowance status</div>
                <strong className="num" style={{ fontSize: "1.2rem" }}>
                  {remainingLabel}
                </strong>
              </div>
              <button
                type="button"
                className={`pill-btn ${daily.diaryComplete ? "active" : ""}`}
                disabled={busy}
                onClick={() => onToggleComplete(today, !daily.diaryComplete)}
              >
                <CheckRingIcon size={15} />
                {daily.diaryComplete ? "Day complete" : "Finish logging day"}
              </button>
            </div>

            <div className="hero-figures">
              <div className="stat-mini">
                <span>Consumed</span>
                <strong className="num">{intake == null ? "—" : `${fmtKcal(intake)}`}</strong>
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
                  Estimated range: <strong className="num">{fmtKcal(daily.totals.calMin)}–{fmtKcal(daily.totals.calMax)} kcal</strong>
                </span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Energy Balance & Fitbit Air / Google Health Widget */}
      <section className="card" aria-label="Energy balance and activity">
        <div className="split-row">
          <div style={{ display: "flex", alignItems: "center", gap: ".55rem" }}>
            <FitbitPulseIcon size={20} className="accent" />
            <div>
              <h2>Energy Balance</h2>
              <p style={{ fontSize: ".76rem" }}>
                {sourceLabel}
                {google.connected && ` · ${fmtRelativeSync(google.lastSync)}`}
              </p>
            </div>
          </div>
          <div className="button-row">
            {google.connected ? (
              <button type="button" className="secondary compact" disabled={busy} onClick={onSyncGoogle}>
                <RefreshCw size={15} /> Sync
              </button>
            ) : (
              <button type="button" className="secondary compact" onClick={() => onNavigate("Settings")}>
                {google.available ? "Connect Google Health" : "Add TDEE"}
              </button>
            )}
          </div>
        </div>

        <div className="energy-strip">
          <div className="energy-cell">
            <span>
              <FlameBurnIcon size={14} /> Total TDEE
            </span>
            <strong className="num">{daily.energy?.totalKcal != null ? `${fmtKcal(daily.energy.totalKcal)} kcal` : "—"}</strong>
          </div>
          <div className="energy-cell">
            <span>
              <FootstepsIcon size={14} /> Steps
            </span>
            <strong className="num">{daily.energy?.steps != null ? daily.energy.steps.toLocaleString("en-GB") : "—"}</strong>
          </div>
          <div className="energy-cell">
            <span>Active burn (info)</span>
            <strong className="num">{daily.energy?.activeKcal != null ? `${fmtKcal(daily.energy.activeKcal)} kcal` : "—"}</strong>
          </div>
          <div className="energy-cell">
            <span>Est. net balance</span>
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
          Total TDEE already includes resting metabolism and activity; active burn is shown for context only.
          {daily.provisional && " Today remains provisional until food logging is marked complete and TDEE is recorded."}
        </p>
      </section>

      {/* 4 Macro Tiles */}
      <section className="macro-grid" aria-label="Daily macronutrients">
        {macroCards.map((m) => {
          const fillPct = m.val == null ? 0 : Math.min(100, Math.round((m.val / m.goal) * 100));
          return (
            <article className="macro-tile" key={m.label}>
              <div className="macro-top">
                <span>{m.label}</span>
                <span className="num">{m.val == null ? "unknown" : `~${m.goal} g`}</span>
              </div>
              <div className="macro-val num">{fmtGram(m.val)}</div>
              <div className="macro-bar">
                <i style={{ width: `${fillPct}%`, background: m.color }} />
              </div>
            </article>
          );
        })}
      </section>

      {/* Weekly & Monthly Net Calorie Deficit Widgets */}
      <section className="two-col" aria-label="Weekly and monthly net calorie balance">
        {[
          { title: "7-Day Net Balance", stats: weekSummary, period: "7 days" },
          { title: "30-Day Net Balance", stats: monthSummary, period: "30 days" },
        ].map(({ title, stats }) => {
          const kgEquiv = stats.netDeficit != null ? (stats.netDeficit / 7700).toFixed(2) : null;
          return (
            <article className="card" key={title}>
              <div className="split-row">
                <h2>{title}</h2>
                <span className={`pill ${stats.comparableDays > 0 ? "teal-soft" : ""}`}>
                  {stats.comparableDays} of {stats.totalDays} complete
                </span>
              </div>
              <div className="reading num" style={{ fontSize: "clamp(1.7rem, 5vw, 2.25rem)", margin: ".5rem 0 .25rem" }}>
                {stats.netDeficit == null
                  ? "—"
                  : stats.netDeficit >= 0
                    ? `${stats.netDeficit.toLocaleString("en-GB")} kcal`
                    : `${Math.abs(stats.netDeficit).toLocaleString("en-GB")} kcal`}
                <small style={{ marginLeft: ".35rem" }}>
                  {stats.netDeficit == null ? "" : stats.netDeficit >= 0 ? "net deficit" : "net surplus"}
                </small>
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
                <span>Avg intake · Avg burn</span>
                <span className="num">
                  {fmtKcal(stats.avgIntake)} · {fmtKcal(stats.avgBurn)} kcal
                </span>
              </div>
              <div className="metric-meta">
                <span>Avg protein · Equiv. est.</span>
                <span className="num">
                  {stats.avgProtein == null ? "—" : `${stats.avgProtein} g`} · {kgEquiv == null ? "—" : `~${kgEquiv} kg`}
                </span>
              </div>
            </article>
          );
        })}
      </section>

      {/* Today's Meal Timeline */}
      <section className="card">
        <div className="split-row" style={{ marginBottom: ".65rem" }}>
          <h2>Today&apos;s Meals</h2>
          <button type="button" className="secondary compact" onClick={() => onNavigate("Nutrition")}>
            Open full diary
          </button>
        </div>
        {daily.meals.length === 0 ? (
          <p style={{ fontSize: ".88rem" }}>
            No meals logged yet for today. Tap <strong>Log meal</strong> or send a photo through your ChatGPT MCP connector.
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
                        <span className="pill">{CATEGORY_LABELS[m.category]}</span>
                        <strong>{m.name}</strong>
                      </div>
                      <div className="meal-meta" style={{ marginTop: ".3rem" }}>
                        <span className="num">{m.localTime}</span>
                        <span>{m.items.length} {m.items.length === 1 ? "item" : "items"}</span>
                        <span className={`pill ${method === "weighed" ? "accent-soft" : method === "photo_estimate" ? "amber-soft" : ""}`}>
                          {method === "weighed" ? <ScaleWeighedIcon size={12} /> : <SparklePhotoIcon size={12} />}
                          {METHOD_LABELS[method]}
                        </span>
                      </div>
                    </div>
                    <div className="meal-kcal">
                      <strong className="num">{fmtKcal(m.totals.calories)} kcal</strong>
                      <small className="num">P {fmtGram(m.totals.proteinG)}</small>
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

function ButtonLike({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="compact" onClick={onClick}>
      <Plus size={17} /> Log meal
    </button>
  );
}
