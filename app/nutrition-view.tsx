"use client";

import { foodEmoji } from "../lib/food-emoji";

import dynamic from "next/dynamic";
import { useState } from "react";
import { ArrowLeft, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Plus, Trash2, TrendingUp } from "lucide-react";
import { CalorieSlider, EnergyBalanceScale } from "../components/bevel-widgets";
import {
  MealCategoryIcon,
  ScaleWeighedIcon,
  SparklePhotoIcon,
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
  busy: boolean;
  loading: boolean;
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
  busy,
  loading,
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
  const [balanceWindow, setBalanceWindow] = useState<"7d" | "30d">("7d");

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

  const calPct =
    dayView.totals.calories == null || dayView.target <= 0
      ? 0
      : Math.round((dayView.totals.calories / dayView.target) * 100);
  const sliderStatus =
    dayView.remaining == null
      ? isBulkMode
        ? `${fmtKcal(dayView.target)} to target`
        : `${fmtKcal(dayView.target)} left`
      : isBulkMode
        ? dayView.remaining > 0
          ? `${fmtKcal(dayView.remaining)} under`
          : `${fmtKcal(Math.abs(dayView.remaining))} over · met`
        : dayView.remaining >= 0
          ? `${fmtKcal(dayView.remaining)} left`
          : `${fmtKcal(Math.abs(dayView.remaining))} over`;

  const diaryContent = (
    <>
      <p className="metric-provenance">Food scores are experimental heuristics, not validated health ratings. Names and available metadata can misclassify foods. Unknown nutrients remain unknown; logged totals can be partial.</p>
      {/* Sleek Bevel Calorie Intake Linear Slider */}
      <CalorieSlider
        title="Calorie Intake"
        consumedText={fmtKcal(dayView.totals.calories)}
        targetText={`${fmtKcal(dayView.target)} kcal`}
        statusText={sliderStatus}
        fillPct={calPct}
        isOnTarget={dayGoalMet}
        isBulkMode={isBulkMode}
        headerRight={
          <div style={{ display: "inline-flex", alignItems: "center", gap: ".35rem" }}>
            {dayView.nutritionScore.grade && (
              <span className={`pill score-pill-${dayView.nutritionScore.grade}`} style={{ fontSize: ".7rem" }}>
                Heuristic {dayView.nutritionScore.score} ({dayView.nutritionScore.grade})
              </span>
            )}
            <span
              className="num"
              style={{
                fontSize: ".8rem",
                fontWeight: 650,
                color: dayGoalMet === null ? "var(--muted)" : dayGoalMet ? "var(--status-good)" : "var(--status-bad)",
              }}
            >
              {sliderStatus}
            </span>
          </div>
        }
        macros={[
          {
            label: "Protein",
            valueText: fmtGram(dayView.totals.proteinG),
            pct:
              dayView.totals.proteinG != null && dayView.macroTargets.proteinG > 0
                ? Math.round((dayView.totals.proteinG / dayView.macroTargets.proteinG) * 100)
                : 0,
            color: "var(--macro-protein)",
          },
          {
            label: "Fibre",
            valueText: fmtGram(dayView.totals.fibreG),
            pct:
              dayView.totals.fibreG != null && dayView.macroTargets.fibreG > 0
                ? Math.round((dayView.totals.fibreG / dayView.macroTargets.fibreG) * 100)
                : 0,
            color: "var(--macro-fibre)",
          },
          {
            label: "Carbs",
            valueText: fmtGram(dayView.totals.carbsG),
            pct:
              dayView.totals.carbsG != null && dayView.macroTargets.carbsG > 0
                ? Math.round((dayView.totals.carbsG / dayView.macroTargets.carbsG) * 100)
                : 0,
            color: "var(--macro-carbs)",
          },
          {
            label: "Fat",
            valueText: fmtGram(dayView.totals.fatG),
            pct:
              dayView.totals.fatG != null && dayView.macroTargets.fatG > 0
                ? Math.round((dayView.totals.fatG / dayView.macroTargets.fatG) * 100)
                : 0,
            color: "var(--macro-fat)",
          },
        ]}
      />

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
                        {meal.qualityScore.score == null ? "Unassessed" : `Heuristic ${meal.qualityScore.score} · ${meal.qualityScore.grade ?? "—"}`}
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

  // Dedicated Full-Page Energy Balance & Trends Drill-Down (7d / 30d toggle + Intake vs Output graphs)
  if (subView === "trends") {
    const activeStats = balanceWindow === "7d" ? weekSummary : monthSummary;
    return (
      <>
        <div className="page-header" style={{ marginBottom: ".2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: ".6rem", width: "100%", justifyContent: "space-between" }}>
            <button
              type="button"
              className="secondary compact"
              onClick={() => setSubView("diary")}
              style={{ minHeight: "36px" }}
            >
              <ArrowLeft size={16} /> Back
            </button>
            <h1 style={{ fontSize: "1.2rem", margin: 0, letterSpacing: "-0.02em", flex: 1, textAlign: "center" }}>
              Energy Balance
            </h1>
            <div style={{ minWidth: "56px" }} />
          </div>
        </div>

        <div className="segments" role="tablist" aria-label="Energy balance window">
          <button
            type="button"
            role="tab"
            aria-selected={balanceWindow === "7d"}
            aria-pressed={balanceWindow === "7d"}
            onClick={() => setBalanceWindow("7d")}
          >
            7 Days
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={balanceWindow === "30d"}
            aria-pressed={balanceWindow === "30d"}
            onClick={() => setBalanceWindow("30d")}
          >
            30 Days
          </button>
        </div>

        <EnergyBalanceScale
          title={balanceWindow === "7d" ? "7-Day Energy Balance" : "30-Day Energy Balance"}
          avgDeficitKcal={activeStats.avgDeficit}
          isBulkMode={isBulkMode}
          pairedDays={activeStats.comparableDays}
          totalDays={activeStats.totalDays}
        />

        <section className="card" style={{ display: "grid", gap: ".55rem" }}>
          <span className="eyebrow">{balanceWindow === "7d" ? "7-Day" : "30-Day"} Intake vs Output</span>
          <div className="energy-strip" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 0 }}>
            <div className="energy-cell">
              <span>Avg Intake</span>
              <strong className="num">{fmtKcal(activeStats.avgIntake)}</strong>
            </div>
            <div className="energy-cell">
              <span>Avg Burn</span>
              <strong className="num">{fmtKcal(activeStats.avgBurn)}</strong>
            </div>
            <div className="energy-cell">
              <span>Avg Protein</span>
              <strong className="num">{activeStats.avgProtein == null ? "—" : `${activeStats.avgProtein} g`}</strong>
            </div>
          </div>
        </section>

        <NutritionTrends history={history30} tracker={tracker} trackingMode={settings.trackingMode} />
      </>
    );
  }

  return (
    <>
      <div className="page-header" style={{ marginBottom: ".15rem" }}>
        <div className="page-header-title">
          <h1 style={{ fontSize: "1.45rem", letterSpacing: "-0.03em" }}>Nutrition</h1>
          <div className="page-sub">
            <span>{formattedDate}</span>
          </div>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="secondary compact"
            onClick={() => setSubView("trends")}
          >
            <TrendingUp size={15} /> Trends
          </button>
          <button type="button" className="compact" onClick={onLogMeal}>
            <Plus size={16} /> Add
          </button>
        </div>
      </div>

      {/* 7-Day Interactive Week Strip + Date Picker */}
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
                  <i style={{ width: `${fillPct}%`, background: goalMet === false ? "var(--status-bad)" : "var(--status-good)" }} />
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
      ) : (
        <>
          {diaryContent}
          {/* Sleek Visual 7-Day Energy Balance Scale (Tap → Full-Page 7d/30d Trends & Graphs) */}
          <EnergyBalanceScale
            title="7-Day Energy Balance"
            avgDeficitKcal={weekSummary.avgDeficit}
            isBulkMode={isBulkMode}
            pairedDays={weekSummary.comparableDays}
            totalDays={weekSummary.totalDays}
            onClick={() => setSubView("trends")}
          />
        </>
      )}
    </>
  );
}
