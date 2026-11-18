"use client";

import { foodEmoji } from "../lib/food-emoji";

import dynamic from "next/dynamic";
import { useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Plus, Trash2, TrendingUp } from "lucide-react";
import {
  MealCategoryIcon,
  MoonThemeIcon,
  ScaleWeighedIcon,
  SparklePhotoIcon,
  SunThemeIcon,
} from "../components/icons";
import type { DailyNutritionView, MealRecord } from "../lib/nutrition-data";
import { addDays, isCalorieGoalMet } from "../lib/nutrition-model";
import {
  CATEGORY_LABELS,
  fmtGram,
  fmtKcal,
  mealMethodSummary,
  METHOD_LABELS,
  type NutritionHistory,
  type NutritionSettings,
  type ThemeMode,
  type TrackerSnapshot,
} from "./types";

const NutritionTrends = dynamic(() => import("./nutrition-trends").then((m) => m.NutritionTrends), {
  ssr: false,
  loading: () => <p className="empty">Loading nutrition trends…</p>,
});

interface NutritionViewProps {
  today: string;
  selectedDay: string;
  dayView: DailyNutritionView;
  history30: NutritionHistory;
  tracker: TrackerSnapshot;
  settings: NutritionSettings;
  theme: ThemeMode;
  busy: boolean;
  loading: boolean;
  onToggleTheme: () => void;
  onSelectDay: (day: string) => void;
  onLogMeal: () => void;
  onEditMeal: (meal: MealRecord) => void;
  onDuplicateMeal: (id: string, targetDay?: string) => void;
  onMoveMeal: (id: string, targetDay: string) => void;
  onDeleteMeal: (id: string, name: string) => void;
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
  const usingTodayFallback = foodComplete.length === 0 && foodLogged.length > 0;

  return {
    totalDays: slice.length,
    comparableDays: comparable.length,
    completeNutritionDays: foodComplete.length,
    loggedDays: foodLogged.length,
    burnDays: burnDays.length,
    usingTodayFallback,
    netDeficit,
    avgDeficit: avg(comparable.map((d) => d.deficit)),
    avgIntake: avg(intakeSource.map((d) => d.totals.calories)),
    avgBurn: avg(burnDays.map((d) => d.energy?.totalKcal ?? null)),
    avgProtein: avg(intakeSource.map((d) => d.totals.proteinG)),
    avgFibre: avg(intakeSource.map((d) => d.totals.fibreG)),
  };
}

export function NutritionView({
  today,
  selectedDay,
  dayView,
  history30,
  tracker,
  settings,
  theme,
  busy,
  loading,
  onToggleTheme,
  onSelectDay,
  onLogMeal,
  onEditMeal,
  onDuplicateMeal,
  onMoveMeal,
  onDeleteMeal,
}: NutritionViewProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveTargetDay, setMoveTargetDay] = useState(selectedDay);
  const [subView, setSubView] = useState<"diary" | "trends">("diary");

  const isBulkMode = Boolean(settings.bulkMode);
  const dayGoalMet = isCalorieGoalMet(dayView.totals.calories, dayView.target, isBulkMode);

  const formattedDate = new Date(`${selectedDay}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // 7-day interactive strip ending today (or ending selectedDay if older)
  const historyByDay = new Map(history30.days.map((d) => [d.day, d]));
  const anchorEnd = selectedDay <= today ? today : selectedDay;
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(anchorEnd, i - 6));

  const weekSummary = summarizeWindow(history30, addDays(today, -6));
  const monthSummary = summarizeWindow(history30, addDays(today, -29));

  const diaryContent = (
    <>
      {/* Daily Summary Card: Protein & Fibre above Carbs & Fat */}
      <section className="card">
        <div className="split-row" style={{ marginBottom: ".65rem" }}>
          <div>
            <div style={{ fontSize: ".76rem", color: "var(--muted)" }}>
              Intake vs {fmtKcal(dayView.target)} kcal {isBulkMode ? "bulk target" : "target"}
            </div>
            <strong className="num" style={{ fontSize: "1.45rem" }}>
              {dayView.totals.calories == null ? "—" : `${fmtKcal(dayView.totals.calories)} kcal`}
            </strong>{" "}
            <span
              style={{
                fontSize: ".85rem",
                color: dayGoalMet === null ? "var(--muted)" : dayGoalMet ? "var(--accent)" : "var(--danger-fg)",
                fontWeight: dayGoalMet === null ? 400 : 600,
              }}
            >
              · {dayView.remaining == null
                ? isBulkMode
                  ? `${fmtKcal(dayView.target)} to target`
                  : `${fmtKcal(dayView.target)} remaining`
                : isBulkMode
                  ? dayView.remaining > 0
                    ? `${fmtKcal(dayView.remaining)} under target`
                    : `${fmtKcal(Math.abs(dayView.remaining))} over · target met`
                  : dayView.remaining >= 0
                    ? `${fmtKcal(dayView.remaining)} remaining`
                    : `${fmtKcal(Math.abs(dayView.remaining))} over`}
            </span>
          </div>
          <div className="button-row">
            {isBulkMode && <span className="pill accent-soft">Bulk mode</span>}
            {dayGoalMet !== null && (
              <span className={`pill ${dayGoalMet ? "accent-soft" : "danger-soft"}`}>
                {isBulkMode
                  ? dayGoalMet
                    ? "Target met"
                    : "Under target"
                  : dayGoalMet
                    ? "Under target"
                    : "Over target"}
              </span>
            )}
            <span className={`pill ${dayView.diaryComplete ? "teal-soft" : ""}`}>
              {dayView.diaryComplete ? "Past day" : "Active day"}
            </span>
          </div>
        </div>

        <div className="button-row" style={{ marginBottom: ".6rem" }}>
          <span className={`pill score-pill-${dayView.nutritionScore.grade ?? "none"}`}>
            Nutrition Score:{" "}
            <strong className="num">
              {dayView.nutritionScore.score == null ? "—" : `${dayView.nutritionScore.score}/100 (${dayView.nutritionScore.grade})`}
            </strong>
          </span>
          {dayView.nutritionScore.wholeFoodPct != null && (
            <span className="pill">
              Whole food {dayView.nutritionScore.wholeFoodPct}%
            </span>
          )}
          {dayView.nutritionScore.contributors.slice(0, 3).map((c) => (
            <span
              key={`${c.impact}-${c.key}`}
              className={`pill ${c.impact === "positive" ? "teal-soft" : "amber-soft"}`}
              title={c.detail}
            >
              {c.impact === "positive" ? "+" : "−"} {c.label}
            </span>
          ))}
        </div>

        <div className="macro-grid">
          <div className="energy-cell" style={{ borderColor: "var(--accent-border)" }}>
            <span style={{ color: "var(--macro-protein)", fontWeight: 700 }}>Protein</span>
            <strong className="num">{fmtGram(dayView.totals.proteinG)}</strong><small>of {fmtGram(dayView.macroTargets.proteinG)} target</small>
          </div>
          <div className="energy-cell" style={{ borderColor: "var(--accent-border)" }}>
            <span style={{ color: "var(--macro-fibre)", fontWeight: 700 }}>Fibre</span>
            <strong className="num">{fmtGram(dayView.totals.fibreG)}</strong><small>of {fmtGram(dayView.macroTargets.fibreG)} target</small>
          </div>
          <div className="energy-cell">
            <span>Carbs</span>
            <strong className="num">{fmtGram(dayView.totals.carbsG)}</strong><small>of {fmtGram(dayView.macroTargets.carbsG)} target</small>
          </div>
          <div className="energy-cell">
            <span>Fat</span>
            <strong className="num">{fmtGram(dayView.totals.fatG)}</strong><small>of {fmtGram(dayView.macroTargets.fatG)} target</small>
          </div>
        </div>
        {dayView.totals.hasUnknownValues && dayView.meals.length > 0 && (
          <p style={{ fontSize: ".74rem", marginTop: ".5rem" }}>
            Some items have unrecorded micronutrients/fibre; missing values stay blank rather than being counted as zero.
          </p>
        )}
      </section>

      {/* Chronological Meal Diary */}
      <section style={{ display: "grid", gap: ".65rem" }} aria-label="Meal diary">
        <div className="split-row">
          <h2 className="section-title">Chronological Diary</h2>
          <span style={{ fontSize: ".8rem", color: "var(--muted)" }}>
            {dayView.meals.length} {dayView.meals.length === 1 ? "meal" : "meals"}
          </span>
        </div>

        {dayView.meals.length === 0 ? (
          <div className="card">
            <p className="empty" style={{ padding: "1.4rem 0" }}>
              No meals logged for {selectedDay}. Unlogged days are excluded from weekly and monthly averages.
            </p>
          </div>
        ) : (
          dayView.meals.map((meal) => {
            const isOpen = Boolean(expanded[meal.id]);
            const method = mealMethodSummary(meal);
            return (
              <article className="meal-card" key={meal.id}>
                <div className="meal-head">
                  <div>
                    <div className="meal-title-row">
                      <span className="pill">
                        <MealCategoryIcon category={meal.category} size={13} />
                        {CATEGORY_LABELS[meal.category]}
                      </span>
                      <span className="num" style={{ fontSize: ".8rem", color: "var(--muted)" }}>
                        {meal.localTime}
                      </span>
                      <strong><span aria-hidden="true">{foodEmoji(meal.name, meal.category)}</span> {meal.name}</strong>
                    </div>
                    <div className="meal-meta" style={{ marginTop: ".35rem" }}>
                      <span className={`pill ${method === "weighed" ? "accent-soft" : method === "photo_estimate" ? "amber-soft" : ""}`}>
                        {method === "weighed" ? <ScaleWeighedIcon size={12} /> : <SparklePhotoIcon size={12} />}
                        {METHOD_LABELS[method]}
                      </span>
                      <span className={`pill score-pill-${meal.qualityScore.grade}`}>
                        Score {meal.qualityScore.score} · {meal.qualityScore.grade}
                      </span>
                      <span className="num">P {fmtGram(meal.totals.proteinG)}</span>
                      <span className="num">Fib {fmtGram(meal.totals.fibreG)}</span>
                      <span className="num">C {fmtGram(meal.totals.carbsG)}</span>
                      <span className="num">F {fmtGram(meal.totals.fatG)}</span>
                    </div>
                  </div>
                  <div className="meal-kcal">
                    <strong className="num">{fmtKcal(meal.totals.calories)} kcal</strong>
                    {meal.totals.calMin != null && meal.totals.calMax != null && (
                      <small className="num">
                        {fmtKcal(meal.totals.calMin)}–{fmtKcal(meal.totals.calMax)}
                      </small>
                    )}
                  </div>
                </div>

                <div className="button-row">
                  <button
                    type="button"
                    className="secondary compact"
                    aria-expanded={isOpen}
                    onClick={() => setExpanded((p) => ({ ...p, [meal.id]: !isOpen }))}
                  >
                    {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                    {isOpen ? "Hide items" : `Items (${meal.items.length})`}
                  </button>
                  <button type="button" className="secondary compact" onClick={() => onEditMeal(meal)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="secondary compact"
                    disabled={busy}
                    onClick={() => onDuplicateMeal(meal.id, selectedDay)}
                  >
                    <Copy size={14} /> Duplicate
                  </button>
                  <button
                    type="button"
                    className="secondary compact"
                    onClick={() => {
                      setMovingId(movingId === meal.id ? null : meal.id);
                      setMoveTargetDay(selectedDay);
                    }}
                  >
                    Move date
                  </button>
                  <button
                    type="button"
                    className="danger compact"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Delete "${meal.name}" from ${selectedDay}?`)) {
                        onDeleteMeal(meal.id, meal.name);
                      }
                    }}
                    aria-label={`Delete ${meal.name}`}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {movingId === meal.id && (
                  <div className="date-nav" style={{ borderTop: "1px solid var(--border)", paddingTop: ".55rem" }}>
                    <input
                      type="date"
                      value={moveTargetDay}
                      onChange={(e) => e.target.value && setMoveTargetDay(e.target.value)}
                    />
                    <button
                      type="button"
                      className="compact"
                      disabled={busy}
                      onClick={() => {
                        onMoveMeal(meal.id, moveTargetDay);
                        setMovingId(null);
                      }}
                    >
                      Move to {moveTargetDay}
                    </button>
                  </div>
                )}

                {isOpen && (
                  <div className="meal-items-box">
                    {meal.items.map((item) => (
                      <div className="item-row" key={item.id}>
                        <div>
                          <div>
                            <strong><span aria-hidden="true">{foodEmoji(item.name)}</span> {item.name}</strong>
                            {item.amount != null && (
                              <span className="num" style={{ color: "var(--muted)", marginLeft: ".4rem" }}>
                                {item.amount} {item.portionLabel ? `× ${item.portionLabel}` : item.unit}
                              </span>
                            )}
                          </div>
                          <div className="item-sub">
                            <span className="pill">{METHOD_LABELS[item.estimationMethod]}</span>
                            <span className="num">P {fmtGram(item.proteinG)}</span>
                            <span className="num">Fib {fmtGram(item.fibreG)}</span>
                            <span className="num">C {fmtGram(item.carbsG)}</span>
                            <span className="num">F {fmtGram(item.fatG)}</span>
                          </div>
                        </div>
                        <div className="num" style={{ textAlign: "right", flexShrink: 0 }}>
                          <strong>{item.calories == null ? "—" : `${fmtKcal(item.calories)} kcal`}</strong>
                          {item.calMin != null && item.calMax != null && (
                            <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>
                              {fmtKcal(item.calMin)}–{fmtKcal(item.calMax)}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {(meal.cookingMethod || meal.ingredients || meal.notes) && (
                      <div style={{ fontSize: ".8rem", color: "var(--muted)", borderTop: "1px solid var(--border)", paddingTop: ".45rem" }}>
                        {meal.cookingMethod && <div>Cooking: {meal.cookingMethod}</div>}
                        {meal.ingredients && <div>Ingredients: {meal.ingredients}</div>}
                        {meal.notes && <div>Notes: {meal.notes}</div>}
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>
    </>
  );

  const trendsAndSummaryContent = (
    <>
      {/* Weekly & Monthly Net Calorie Balance & Macro Summary Widgets */}
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
                  ? `${stats.loggedDays} logged today`
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
                  <small style={{ fontSize: ".9rem" }}>Completes at midnight</small>
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
                <span>Avg intake{stats.usingTodayFallback ? " (today)" : ""} · Avg burn</span>
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

      <NutritionTrends history={history30} tracker={tracker} trackingMode={settings.trackingMode} />
    </>
  );

  return (
    <>
      <div className="page-header">
        <div className="page-header-title">
          <h1>Nutrition</h1>
          <div className="page-sub">
            <span>{formattedDate}</span>
            <span className="pill">{dayView.timezone}</span>
          </div>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
            onClick={onToggleTheme}
          >
            {theme === "light" ? <MoonThemeIcon size={17} /> : <SunThemeIcon size={17} />}
          </button>
          <button
            type="button"
            className="secondary compact"
            aria-pressed={subView === "trends"}
            onClick={() => setSubView(subView === "trends" ? "diary" : "trends")}
          >
            <TrendingUp size={15} /> Trends
          </button>
          <button type="button" className="compact" onClick={onLogMeal}>
            <Plus size={16} /> Add
          </button>
        </div>
      </div>

      <div className="segments" role="tablist" aria-label="Nutrition views">
        <button type="button" aria-pressed={subView === "diary"} onClick={() => setSubView("diary")}>
          Diary
        </button>
        <button type="button" aria-pressed={subView === "trends"} onClick={() => setSubView("trends")}>
          Trends &amp; Summary
        </button>
      </div>

      {/* NutriTrace 7-Day Interactive Week Strip + Date Picker */}
      <section className="card" aria-label="Calendar navigation" style={{ display: "grid", gap: ".65rem" }}>
        <div className="week-strip">
          {weekDays.map((dayStr) => {
            const dObj = new Date(`${dayStr}T12:00:00Z`);
            const dow = dObj.toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "narrow" });
            const dom = dObj.getUTCDate();
            const entry = historyByDay.get(dayStr);
            const cal = entry?.totals.calories;
            const tgt = entry?.target ?? dayView.target;
            const fillPct = cal != null && tgt > 0 ? Math.min(100, Math.round((cal / tgt) * 100)) : 0;
            const goalMet = isCalorieGoalMet(cal, tgt, isBulkMode);
            return (
              <button
                type="button"
                key={dayStr}
                className={`week-cell ${dayStr === selectedDay ? "selected" : ""}`}
                onClick={() => onSelectDay(dayStr)}
              >
                <span className="week-cell-dow">{dow}</span>
                <span className="week-cell-day num">{dom}</span>
                <span className="week-mini-bar">
                  <i style={{ width: `${fillPct}%`, background: goalMet === false ? "var(--danger-fg)" : "var(--accent)" }} />
                </span>
              </button>
            );
          })}
        </div>

        <div className="date-nav">
          <button
            type="button"
            className="secondary compact"
            aria-label="Previous day"
            onClick={() => onSelectDay(addDays(selectedDay, -1))}
          >
            <ChevronLeft size={18} />
          </button>
          <label style={{ flex: 1, minWidth: 0 }}>
            <span className="sr-only">Select date</span>
            <input
              type="date"
              aria-label="Select diary date"
              value={selectedDay}
              onChange={(e) => {
                if (e.target.value) onSelectDay(e.target.value);
              }}
            />
          </label>
          <button
            type="button"
            className="secondary compact"
            aria-label="Next day"
            onClick={() => onSelectDay(addDays(selectedDay, 1))}
          >
            <ChevronRight size={18} />
          </button>
          {selectedDay !== today && (
            <button type="button" className="secondary compact" onClick={() => onSelectDay(today)}>
              <CalendarDays size={15} /> Today
            </button>
          )}
        </div>
      </section>

      {loading ? (
        <p className="card" role="status">
          Loading diary…
        </p>
      ) : subView === "trends" ? (
        <>
          {trendsAndSummaryContent}
          {diaryContent}
        </>
      ) : (
        <>
          {diaryContent}
          {trendsAndSummaryContent}
        </>
      )}
    </>
  );
}
