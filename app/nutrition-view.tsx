"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, Plus, Trash2, TrendingUp } from "lucide-react";
import { CheckRingIcon, ScaleWeighedIcon, SparklePhotoIcon } from "../components/icons";
import type { DailyNutritionView, MealRecord } from "../lib/nutrition-data";
import { addDays } from "../lib/nutrition-model";
import {
  CATEGORY_LABELS,
  fmtGram,
  fmtKcal,
  mealMethodSummary,
  METHOD_LABELS,
  type NutritionHistory,
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
  busy: boolean;
  onSelectDay: (day: string) => void;
  onLogMeal: () => void;
  onEditMeal: (meal: MealRecord) => void;
  onDuplicateMeal: (id: string, targetDay?: string) => void;
  onMoveMeal: (id: string, targetDay: string) => void;
  onDeleteMeal: (id: string, name: string) => void;
  onToggleComplete: (day: string, complete: boolean) => void;
}

export function NutritionView({
  today,
  selectedDay,
  dayView,
  history30,
  tracker,
  busy,
  onSelectDay,
  onLogMeal,
  onEditMeal,
  onDuplicateMeal,
  onMoveMeal,
  onDeleteMeal,
  onToggleComplete,
}: NutritionViewProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveTargetDay, setMoveTargetDay] = useState(selectedDay);
  const [showTrends, setShowTrends] = useState(false);

  const formattedDate = new Date(`${selectedDay}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Nutrition</h1>
          <p style={{ fontSize: ".85rem" }}>{formattedDate} · {dayView.timezone}</p>
        </div>
        <div className="button-row">
          <button
            type="button"
            className="secondary compact"
            aria-pressed={showTrends}
            onClick={() => setShowTrends(!showTrends)}
          >
            <TrendingUp size={16} /> Trends
          </button>
          <button type="button" className="compact" onClick={onLogMeal}>
            <Plus size={17} /> Add food
          </button>
        </div>
      </div>

      {/* Date Navigation */}
      <section className="card" aria-label="Calendar navigation">
        <div className="date-nav">
          <button
            type="button"
            className="secondary compact"
            aria-label="Previous day"
            onClick={() => onSelectDay(addDays(selectedDay, -1))}
          >
            <ChevronLeft size={18} />
          </button>
          <label style={{ flex: 1, minWidth: "150px" }}>
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

      {showTrends && <NutritionTrends history={history30} tracker={tracker} />}

      {/* Daily Summary Card */}
      <section className="card">
        <div className="split-row" style={{ marginBottom: ".6rem" }}>
          <div>
            <div style={{ fontSize: ".76rem", color: "var(--muted)" }}>Intake vs {fmtKcal(dayView.target)} kcal target</div>
            <strong className="num" style={{ fontSize: "1.45rem" }}>
              {dayView.totals.calories == null ? "—" : `${fmtKcal(dayView.totals.calories)} kcal`}
            </strong>{" "}
            <span style={{ fontSize: ".85rem", color: "var(--muted)" }}>
              · {dayView.remaining == null
                ? `${fmtKcal(dayView.target)} remaining`
                : dayView.remaining >= 0
                  ? `${fmtKcal(dayView.remaining)} remaining`
                  : `${fmtKcal(Math.abs(dayView.remaining))} over`}
            </span>
          </div>
          <button
            type="button"
            className={`pill-btn ${dayView.diaryComplete ? "active" : ""}`}
            disabled={busy}
            onClick={() => onToggleComplete(selectedDay, !dayView.diaryComplete)}
          >
            <CheckRingIcon size={15} />
            {dayView.diaryComplete ? "Complete" : "Finish logging"}
          </button>
        </div>

        <div className="energy-strip" style={{ marginTop: ".4rem" }}>
          <div className="energy-cell">
            <span>Protein</span>
            <strong className="num">{fmtGram(dayView.totals.proteinG)}</strong>
          </div>
          <div className="energy-cell">
            <span>Carbs</span>
            <strong className="num">{fmtGram(dayView.totals.carbsG)}</strong>
          </div>
          <div className="energy-cell">
            <span>Fat</span>
            <strong className="num">{fmtGram(dayView.totals.fatG)}</strong>
          </div>
          <div className="energy-cell">
            <span>Fibre</span>
            <strong className="num">{fmtGram(dayView.totals.fibreG)}</strong>
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
                      <span className="pill">{CATEGORY_LABELS[meal.category]}</span>
                      <span className="num" style={{ fontSize: ".82rem", color: "var(--muted)" }}>
                        {meal.localTime}
                      </span>
                      <strong>{meal.name}</strong>
                    </div>
                    <div className="meal-meta" style={{ marginTop: ".35rem" }}>
                      <span className={`pill ${method === "weighed" ? "accent-soft" : method === "photo_estimate" ? "amber-soft" : ""}`}>
                        {method === "weighed" ? <ScaleWeighedIcon size={12} /> : <SparklePhotoIcon size={12} />}
                        {METHOD_LABELS[method]}
                      </span>
                      <span className="num">P {fmtGram(meal.totals.proteinG)}</span>
                      <span className="num">C {fmtGram(meal.totals.carbsG)}</span>
                      <span className="num">F {fmtGram(meal.totals.fatG)}</span>
                      <span className="num">Fib {fmtGram(meal.totals.fibreG)}</span>
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
                            <strong>{item.name}</strong>
                            {item.amount != null && (
                              <span className="num" style={{ color: "var(--muted)", marginLeft: ".4rem" }}>
                                {item.amount} {item.unit}
                              </span>
                            )}
                          </div>
                          <div className="item-sub">
                            <span className="pill">{METHOD_LABELS[item.estimationMethod]}</span>
                            <span className="num">P {fmtGram(item.proteinG)}</span>
                            <span className="num">C {fmtGram(item.carbsG)}</span>
                            <span className="num">F {fmtGram(item.fatG)}</span>
                            <span className="num">Fib {fmtGram(item.fibreG)}</span>
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
}
