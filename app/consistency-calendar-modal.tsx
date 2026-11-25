"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Dumbbell, Footprints, X } from "lucide-react";
import { isCalorieGoalMet } from "../lib/nutrition-model";
import type { DailyStrainView, HistoryDay, NutritionHistory, NutritionSettings } from "./types";

type AdherenceFilter = "all" | "protein" | "calories" | "gym" | "running";

interface ConsistencyCalendarModalProps {
  open: boolean;
  today: string;
  settings: NutritionSettings;
  stepsThreshold?: number;
  onClose: () => void;
  onJumpToDay: (day: string) => void;
}

function monthBounds(ym: string): { from: string; to: string; label: string; daysInMonth: number; startDow: number } {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  const daysInMonth = last.getUTCDate();
  const jsDow = first.getUTCDay(); // 0=Sun..6=Sat
  const startDow = (jsDow + 6) % 7; // Mon=0..Sun=6
  const label = first.toLocaleDateString("en-GB", { timeZone: "UTC", month: "long", year: "numeric" });
  return {
    from: `${ym}-01`,
    to: `${ym}-${String(daysInMonth).padStart(2, "0")}`,
    label,
    daysInMonth,
    startDow,
  };
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function ConsistencyCalendarModal({
  open,
  today,
  settings,
  stepsThreshold = 10500,
  onClose,
  onJumpToDay,
}: ConsistencyCalendarModalProps) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const [filter, setFilter] = useState<AdherenceFilter>("all");
  const [selectedDay, setSelectedDay] = useState(today);
  const [nutritionByDay, setNutritionByDay] = useState<Record<string, HistoryDay>>({});
  const [strainByDay, setStrainByDay] = useState<Record<string, DailyStrainView>>({});
  const [loading, setLoading] = useState(false);

  const bounds = useMemo(() => monthBounds(month), [month]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    Promise.all([
      fetch(`/api/nutrition?from=${bounds.from}&to=${bounds.to}`, { cache: "no-store" }).then((r) =>
        r.ok ? (r.json() as Promise<NutritionHistory>) : null,
      ),
      fetch(`/api/strain?from=${bounds.from}&to=${bounds.to}`, { cache: "no-store" }).then((r) =>
        r.ok ? (r.json() as Promise<{ days?: DailyStrainView[] }>) : null,
      ),
    ])
      .then(([nut, str]) => {
        if (!active) return;
        const nMap: Record<string, HistoryDay> = {};
        for (const d of nut?.days ?? []) nMap[d.day] = d;
        const sMap: Record<string, DailyStrainView> = {};
        for (const d of str?.days ?? []) sMap[d.day] = d;
        setNutritionByDay(nMap);
        setStrainByDay(sMap);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, bounds.from, bounds.to]);

  if (!open) return null;

  const isBulkMode = Boolean(settings.bulkMode);
  const proteinTarget = settings.macroTargets?.proteinG ?? 120;

  const cells: (string | null)[] = [
    ...Array.from({ length: bounds.startDow }, () => null),
    ...Array.from({ length: bounds.daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];

  const dayFlags = (day: string) => {
    const n = nutritionByDay[day];
    const s = strainByDay[day];
    const hasGym = Boolean(s?.activities.some((a) => a.kind === "strength"));
    const hasRunning = Boolean(
      s?.activities.some((a) => a.kind === "cardio" && /run|jog|sprint|treadmill|walk/i.test(a.title)),
    );
    const hasCardio = hasRunning || Boolean(s?.activities.some((a) => a.kind === "cardio"));
    const hasCalories = Boolean(n && n.mealCount > 0 && n.totals.calories != null);
    const calMet = hasCalories && n ? isCalorieGoalMet(n.totals.calories, n.target, isBulkMode) === true : false;
    const calState: "good" | "bad" | "none" = !hasCalories ? "none" : calMet ? "good" : "bad";
    const steps = n?.energy?.steps ?? s?.totalSteps ?? null;
    const stepsState: "good" | "bad" | "none" =
      steps == null ? "none" : steps >= stepsThreshold ? "good" : "bad";
    const protMet = n?.totals.proteinG != null && n.totals.proteinG >= proteinTarget * 0.9;
    const anyLogged = Boolean((n && n.mealCount > 0) || hasGym || hasCardio);
    return {
      hasGym,
      hasRunning: hasRunning || hasCardio,
      calMet,
      calState,
      stepsState,
      protMet,
      anyLogged,
    };
  };

  const selectedNut = nutritionByDay[selectedDay];
  const selectedStrain = strainByDay[selectedDay];
  const selectedSteps = selectedNut?.energy?.steps ?? selectedStrain?.totalSteps ?? null;
  const selectedCalDelta =
    selectedNut && selectedNut.mealCount > 0 && selectedNut.totals.calories != null
      ? Math.round(selectedNut.totals.calories - selectedNut.target)
      : null;

  return (
    <dialog className="modal-backdrop" open aria-label="Consistency Calendar" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <div className="modal-top">
          <div className="sheet-grabber" />
          <div className="split-row modal-header">
            <h2>Consistency Calendar</h2>
            <button type="button" className="secondary icon-btn modal-close-btn" aria-label="Close calendar" onClick={onClose}>
              <X size={18} />
            </button>
          </div>

          <div className="split-row">
            <button type="button" className="secondary compact home-step-btn" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
              <ChevronLeft size={16} />
            </button>
            <strong style={{ fontSize: ".95rem" }}>{bounds.label}</strong>
            <button
              type="button"
              className="secondary compact home-step-btn"
              aria-label="Next month"
              disabled={month >= today.slice(0, 7)}
              onClick={() => setMonth((m) => shiftMonth(m, 1))}
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="cal-filter-row" role="group" aria-label="Adherence filter">
            {(
              [
                ["all", "All"],
                ["protein", "Protein Goal"],
                ["calories", "Calorie Target"],
                ["gym", "Gym"],
                ["running", "Running"],
              ] as [AdherenceFilter, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={filter === key ? "" : "secondary"}
                aria-pressed={filter === key}
                style={{ minHeight: "34px", padding: ".2rem .6rem", fontSize: ".74rem" }}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-body">
          <section className="card" style={{ display: "grid", gap: ".5rem" }}>
            <div className="cal-weekdays">
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <span key={i}>{d}</span>
              ))}
            </div>
            {loading ? (
              <p className="empty">Loading month…</p>
            ) : (
              <div className="cal-grid">
                {cells.map((day, idx) => {
                  if (!day) return <div key={`empty-${idx}`} />;
                  const f = dayFlags(day);
                  const filterMatch =
                    filter !== "all" &&
                    (filter === "protein"
                      ? f.protMet
                      : filter === "calories"
                        ? f.calMet
                        : filter === "gym"
                          ? f.hasGym
                          : f.hasRunning);
                  const filterDim = filter !== "all" && !filterMatch;
                  const isSelected = day === selectedDay;
                  const dayNum = Number(day.slice(8, 10));
                  return (
                    <button
                      key={day}
                      type="button"
                      className={`cal-cell ${filterMatch ? "is-filter-match" : ""} ${filterDim ? "is-filter-dim" : ""} ${isSelected ? "is-selected" : ""}`}
                      onClick={() => setSelectedDay(day)}
                    >
                      <span
                        className={`cal-ring num ${
                          f.stepsState === "good" ? "is-steps-good" : f.stepsState === "bad" ? "is-steps-bad" : ""
                        }`}
                      >
                        {dayNum}
                      </span>
                      <span
                        className={`cal-cal-bar ${
                          f.calState === "good" ? "is-cal-good" : f.calState === "bad" ? "is-cal-bad" : ""
                        }`}
                        aria-hidden="true"
                      />
                      <span className="cal-icons">
                        {f.hasGym && <Dumbbell size={9} aria-label="Gym" />}
                        {f.hasRunning && <Footprints size={9} aria-label="Cardio" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="cal-legend" aria-label="Calendar key">
              <span className="cal-legend-item">
                <span className="cal-legend-dot is-good" aria-hidden="true" />
                ≥ {stepsThreshold.toLocaleString("en-GB")} steps
              </span>
              <span className="cal-legend-item">
                <span className="cal-legend-dot is-bad" aria-hidden="true" />
                &lt; {stepsThreshold.toLocaleString("en-GB")} steps
              </span>
              <span className="cal-legend-item">
                <span className="cal-legend-bar is-good" aria-hidden="true" />
                Calorie target
              </span>
              <span className="cal-legend-item">
                <span className="cal-legend-bar is-bad" aria-hidden="true" />
                {isBulkMode ? "Under target" : "Over calories"}
              </span>
              <span className="cal-legend-item">
                <span className="cal-legend-tile" aria-hidden="true" />
                Filter match
              </span>
              <span className="cal-legend-item">
                <Dumbbell size={11} aria-hidden="true" /> Gym · <Footprints size={11} aria-hidden="true" /> Cardio
              </span>
            </div>
          </section>

          <section className="card" style={{ display: "grid", gap: ".55rem" }}>
            <div className="split-row">
              <strong>{selectedDay}</strong>
              <button
                type="button"
                className="secondary compact"
                style={{ minHeight: "32px", fontSize: ".76rem" }}
                onClick={() => {
                  onJumpToDay(selectedDay);
                  onClose();
                }}
              >
                Open in Today <ChevronRight size={14} />
              </button>
            </div>
            <div className="energy-strip cal-detail-strip" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", marginTop: 0 }}>
              <div className="energy-cell">
                <span>Calories</span>
                <strong className="num">
                  {selectedNut?.totals.calories != null
                    ? `${Math.round(selectedNut.totals.calories)} / ${selectedNut.target}${
                        selectedCalDelta != null ? ` (${selectedCalDelta > 0 ? "+" : ""}${selectedCalDelta})` : ""
                      }`
                    : "—"}
                </strong>
              </div>
              <div className="energy-cell">
                <span>Protein</span>
                <strong className="num">
                  {selectedNut?.totals.proteinG != null ? `${Math.round(selectedNut.totals.proteinG)}g` : "—"}
                </strong>
              </div>
              <div className="energy-cell">
                <span>Steps</span>
                <strong className="num">
                  {selectedSteps != null ? selectedSteps.toLocaleString("en-GB") : "—"}
                </strong>
              </div>
              <div className="energy-cell">
                <span>Strain</span>
                <strong className="num">
                  {selectedStrain?.overallStrain != null ? Math.round(selectedStrain.overallStrain) : "—"}
                </strong>
              </div>
            </div>
            {selectedStrain && selectedStrain.activities.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: ".35rem" }}>
                {selectedStrain.activities.map((a) => (
                  <span key={a.id} className="pill accent-soft" style={{ fontSize: ".72rem" }}>
                    {a.title}
                  </span>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </dialog>
  );
}
