"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, Camera, ChevronRight, Plus, TrendingUp } from "lucide-react";
import { Button } from "../components/ui/button";
import {
  displayUnit,
  displayValue,
  metrics,
  readingsFor,
  recomp,
  summary,
  type Metric,
} from "../lib/metrics";
import type { DailyNutritionView } from "../lib/nutrition-data";
import { addDays } from "../lib/nutrition-model";
import type { TrendMetricKind } from "./metric-trends-modal";
import { PhysiqueCheckinView } from "./physique-checkin-view";
import type { NutritionHistory, NutritionSettings, TrackerSnapshot } from "./types";

const TrendChart = dynamic(() => import("./trends").then((m) => m.TrendChart), {
  ssr: false,
  loading: () => <p className="empty">Loading chart…</p>,
});

const numFmt = new Intl.NumberFormat("en", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const readout = (value: number | null | undefined, metric: Metric, units: "metric" | "imperial") =>
  value == null ? "—" : numFmt.format(displayValue(value, metric, units));

interface MeasurementsViewProps {
  snapshot: TrackerSnapshot;
  nutritionSettings?: NutritionSettings;
  history30?: NutritionHistory;
  daily?: DailyNutritionView;
  today: string;
  busy: boolean;
  initialSubPage?: "physique" | null;
  onClearInitialSubPage?: () => void;
  onOpenTrends: (metric: TrendMetricKind) => void;
  onSaveTracker: (action: object, successMessage: string) => Promise<void>;
  onMessage: (msg: string) => void;
}

type MeasurePage = null | "trends" | "log" | "physique";

export function MeasurementsView({
  snapshot,
  nutritionSettings,
  history30,
  daily,
  today,
  busy,
  initialSubPage,
  onClearInitialSubPage,
  onOpenTrends,
  onSaveTracker,
  onMessage,
}: MeasurementsViewProps) {
  const [page, setPage] = useState<MeasurePage>(initialSubPage ?? null);
  const [date, setDate] = useState(today);
  const [localMsg, setLocalMsg] = useState("");
  const { readings, settings } = snapshot;

  useEffect(() => {
    if (initialSubPage) {
      setPage(initialSubPage);
      onClearInitialSubPage?.();
    }
  }, [initialSubPage, onClearInitialSubPage]);

  const isFitbitMode =
    (nutritionSettings?.trackingMode ?? history30?.trackingMode ?? daily?.trackingMode) === "fitbit";
  const recoveryRecords = [
    ...(daily?.recovery ? [daily.recovery] : []),
    ...[...(history30?.days ?? [])]
      .reverse()
      .map((d) => d.recovery)
      .filter((r): r is NonNullable<typeof r> => r != null),
  ];
  const latestBodyFat = isFitbitMode
    ? (recoveryRecords.find((r) => r.bodyFatPct != null)?.bodyFatPct ?? null)
    : null;
  const latestVo2Max = isFitbitMode
    ? (recoveryRecords.find((r) => r.vo2Max != null)?.vo2Max ?? null)
    : null;

  const weightMetric = metrics.find((m) => m.key === "weight")!;
  const weightSummary = summary(readingsFor(readings, weightMetric), today);
  const latestWeightKg = daily?.energy?.weightKg ?? weightSummary.latest?.value ?? null;

  const weightSparkPoints = useMemo(() => {
    const from14 = addDays(today, -13);
    const byDay = new Map<string, number>();
    for (const d of history30?.days ?? []) {
      if (d.day >= from14 && d.day <= today && d.energy?.weightKg != null) byDay.set(d.day, d.energy.weightKg);
    }
    for (const r of readingsFor(readings, weightMetric)) {
      if (r.date >= from14 && r.date <= today) byDay.set(r.date, r.value);
    }
    const vals = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
    if (vals.length < 2) return "";
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const span = max - min || 1;
    return vals
      .map((v, i) => `${((i / (vals.length - 1)) * 124 + 3).toFixed(1)},${(30 - ((v - min) / span) * 24).toFixed(1)}`)
      .join(" ");
  }, [history30?.days, readings, today, weightMetric]);

  const selected = readings.filter((r) => r.date === date);
  const [waistMetric, leftMetric, rightMetric] = metrics;
  const [waist, left, right] = [waistMetric, leftMetric, rightMetric].map(
    (m) => summary(readingsFor(readings, m), today).latest?.value,
  );
  const ratio = (val: number | undefined, base: number | null | undefined) =>
    val != null && base != null && base > 0 ? (val / base).toFixed(2) : "—";

  const recentDates = [...new Set(readings.map((r) => r.date))]
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 12);

  function submitLog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalMsg("");
    const form = new FormData(event.currentTarget);
    const values = metrics.flatMap((metric) => {
      const raw = String(form.get(metric.key) ?? "").trim();
      if (raw === "") return [];
      const value = /^\d+(?:[.,]\d+)?$/.test(raw) ? Number(raw.replace(",", ".")) : NaN;
      return [{ key: metric.key, value: value / displayValue(1, metric, settings.units) }];
    });
    if (!values.length) {
      setLocalMsg("Enter at least one measurement.");
      return;
    }
    if (values.some(({ value }) => !Number.isFinite(value) || value <= 0)) {
      setLocalMsg("Enter positive numbers for measurements.");
      return;
    }
    const note = String(form.get("note") ?? "");
    void onSaveTracker(
      {
        action: "log",
        data: { date, values, note: note || (form.get("clearNotes") ? "" : undefined) },
      },
      "Measurements saved.",
    ).then(() => setPage(null));
  }

  if (page === "physique") {
    return (
      <PhysiqueCheckinView
        today={today}
        latestWeight={latestWeightKg}
        latestBodyFat={latestBodyFat}
        onBack={() => setPage(null)}
        onMessage={onMessage}
      />
    );
  }

  if (page === "trends") {
    return (
      <>
        <div className="page-header" style={{ marginBottom: ".2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: ".6rem", width: "100%", justifyContent: "space-between" }}>
            <button type="button" className="secondary compact" onClick={() => setPage(null)} style={{ minHeight: "36px" }}>
              <ArrowLeft size={16} /> Back
            </button>
            <h1 style={{ fontSize: "1.2rem", margin: 0, letterSpacing: "-0.02em", flex: 1, textAlign: "center" }}>
              Measurement Trends
            </h1>
            <button type="button" className="compact" onClick={() => setPage("log")} style={{ minHeight: "36px" }}>
              <Plus size={15} /> Log
            </button>
          </div>
        </div>
        <TrendChart readings={readings} today={today} units={settings.units} height={settings.heightCm} />
      </>
    );
  }

  if (page === "log") {
    return (
      <>
        <div className="page-header" style={{ marginBottom: ".2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: ".6rem", width: "100%", justifyContent: "space-between" }}>
            <button type="button" className="secondary compact" onClick={() => setPage(null)} style={{ minHeight: "36px" }}>
              <ArrowLeft size={16} /> Back
            </button>
            <h1 style={{ fontSize: "1.2rem", margin: 0, letterSpacing: "-0.02em", flex: 1, textAlign: "center" }}>
              Log Measurement
            </h1>
            <div style={{ minWidth: "56px" }} />
          </div>
        </div>

        <form className="card" key={date + JSON.stringify(selected)} onSubmit={submitLog} method="post" style={{ display: "grid", gap: ".75rem" }}>
          <label>
            Date
            <input
              type="date"
              required
              value={date}
              max={today}
              onChange={(e) => {
                if (e.target.value) setDate(e.target.value);
              }}
            />
          </label>
          <div className="input-grid">
            {metrics.map((metric) => {
              const value = readingsFor(selected, metric)[0]?.value;
              return (
                <label key={metric.key}>
                  {metric.label} ({displayUnit(metric, settings.units)})
                  <input
                    name={metric.key}
                    inputMode="decimal"
                    placeholder="—"
                    defaultValue={
                      value == null ? "" : String(Number(displayValue(value, metric, settings.units).toFixed(4)))
                    }
                  />
                </label>
              );
            })}
          </div>
          <label>
            Notes
            <input
              name="note"
              type="text"
              placeholder="Optional note (e.g. morning fasted)"
              defaultValue={selected.find((r) => r.note)?.note ?? ""}
            />
          </label>
          {localMsg && <p role="alert" style={{ color: "var(--danger-fg)", fontSize: ".82rem", margin: 0 }}>{localMsg}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save measurements"}
          </Button>
        </form>

        {recentDates.length > 0 && (
          <section className="card" style={{ display: "grid", gap: ".2rem" }}>
            <h2 style={{ fontSize: "1rem", margin: "0 0 .25rem" }}>Recent Entries</h2>
            {recentDates.map((d) => {
              const dayReadings = readings.filter((r) => r.date === d);
              return (
                <button
                  key={d}
                  type="button"
                  className="compact-row-btn"
                  onClick={() => setDate(d)}
                >
                  <div>
                    <strong className="num" style={{ fontSize: ".86rem" }}>{d}</strong>
                    <div style={{ fontSize: ".74rem", color: "var(--muted)" }}>
                      {dayReadings
                        .slice(0, 3)
                        .map((r) => {
                          const m = metrics.find((x) => x.key === r.metric);
                          return m ? `${m.label}: ${readout(r.value, m, settings.units)} ${displayUnit(m, settings.units)}` : "";
                        })
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <ChevronRight size={15} style={{ color: "var(--muted)" }} />
                </button>
              );
            })}
          </section>
        )}
      </>
    );
  }

  return (
    <>
      <div className="page-header" style={{ marginBottom: ".1rem" }}>
        <div className="page-header-title">
          <h1 style={{ fontSize: "1.45rem", letterSpacing: "-0.03em" }}>Body</h1>
        </div>
        <div className="header-actions">
          <button type="button" className="compact" onClick={() => setPage("log")}>
            <Plus size={15} /> Log
          </button>
        </div>
      </div>

      {/* Weight Telemetry Hero with 14-day sparkline */}
      <button
        type="button"
        className="card card-interactive"
        onClick={() => onOpenTrends("weight")}
        style={{ gap: ".4rem" }}
      >
        <div className="split-row">
          <span className="eyebrow">Weight Telemetry</span>
          <span className="silk-chip-btn">
            <TrendingUp size={12} /> Trends <ChevronRight size={12} />
          </span>
        </div>
        <div className="split-row" style={{ alignItems: "flex-end" }}>
          <div>
            <div className="reading" style={{ margin: 0 }}>
              {latestWeightKg != null ? numFmt.format(displayValue(latestWeightKg, weightMetric, settings.units)) : "—"}{" "}
              <small>{displayUnit(weightMetric, settings.units)}</small>
            </div>
            <div style={{ fontSize: ".76rem", color: "var(--muted)", marginTop: ".15rem" }}>
              7d avg {readout(weightSummary.weekly, weightMetric, settings.units)} {displayUnit(weightMetric, settings.units)}
              {weightSummary.change != null
                ? ` · ${weightSummary.change > 0 ? "+" : ""}${readout(weightSummary.change, weightMetric, settings.units)}`
                : ""}
            </div>
          </div>
          {weightSparkPoints && (
            <svg width="130" height="34" viewBox="0 0 130 34" aria-hidden="true">
              <polyline
                fill="none"
                stroke="var(--accent-2)"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={weightSparkPoints}
              />
            </svg>
          )}
        </div>
      </button>

      {/* Physique Check-in & Timelapse Launcher */}
      <button
        type="button"
        className="card card-interactive"
        onClick={() => setPage("physique")}
      >
        <div className="split-row">
          <div style={{ display: "flex", alignItems: "center", gap: ".65rem" }}>
            <span className="brand-badge" style={{ width: 38, height: 38, borderRadius: 12 }}>
              <Camera size={18} />
            </span>
            <div>
              <strong style={{ fontSize: ".96rem" }}>Physique Check-in &amp; Timelapse</strong>
              <div style={{ fontSize: ".76rem", color: "var(--muted)" }}>
                Front / Side / Back progress photos &amp; timelapse player
              </div>
            </div>
          </div>
          <ChevronRight size={18} style={{ color: "var(--muted)" }} />
        </div>
      </button>

      {/* 2x2 Circumferences Grid */}
      <div className="measure-grid">
        {metrics
          .filter((metric, index) => metric.key !== "weight" && (index < 4 || readingsFor(readings, metric).length > 0))
          .map((metric) => {
            const { latest, change, weekly } = summary(readingsFor(readings, metric), today);
            return (
              <button
                type="button"
                className="card card-interactive metric-card"
                key={metric.key}
                onClick={() => setPage("trends")}
                style={{ textAlign: "left" }}
              >
                <div className="split-row">
                  <span className="eyebrow">{metric.label}</span>
                  <ChevronRight size={14} style={{ color: "var(--muted)" }} />
                </div>
                <div className="reading" style={{ marginTop: ".25rem", fontSize: "clamp(1.4rem, 5vw, 1.9rem)" }}>
                  {readout(latest?.value, metric, settings.units)}{" "}
                  <small>{displayUnit(metric, settings.units)}</small>
                </div>
                <div className="split-row" style={{ fontSize: ".74rem", color: "var(--muted)", marginTop: ".15rem" }}>
                  <span>7d avg {readout(weekly, metric, settings.units)}</span>
                  <span className="num" style={{ fontWeight: 600, color: change != null && change < 0 ? "var(--status-good)" : "var(--text)" }}>
                    {change != null && change > 0 ? "+" : ""}
                    {readout(change, metric, settings.units)}
                  </span>
                </div>
              </button>
            );
          })}
      </div>

      {/* Fitbit Body Fat & VO2 Max */}
      {isFitbitMode && (latestBodyFat != null || latestVo2Max != null) && (
        <section className="card" aria-label="Fitbit body and cardio">
          <div className="split-row" style={{ marginBottom: ".5rem" }}>
            <span className="eyebrow">Body Composition &amp; Fitness</span>
            <span className="pill teal-soft">Google Health</span>
          </div>
          <div className="energy-strip" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", marginTop: 0 }}>
            <div className="energy-cell">
              <span>Body Fat</span>
              <strong className="num">{latestBodyFat != null ? `${Number(latestBodyFat.toFixed(1))}%` : "—"}</strong>
            </div>
            <div className="energy-cell">
              <span>VO2 Max</span>
              <strong className="num">{latestVo2Max != null ? `${Number(latestVo2Max.toFixed(1))}` : "—"}</strong>
            </div>
          </div>
        </section>
      )}

      {/* Ratios & Recomp Card */}
      <section className="card" style={{ display: "grid", gap: ".55rem" }} aria-label="Body insights">
        <div className="split-row">
          <span className="eyebrow">Cardiovascular Ratios &amp; Recomp</span>
          <button
            type="button"
            className="secondary compact"
            style={{ minHeight: "28px", padding: ".15rem .55rem", fontSize: ".72rem" }}
            onClick={() => setPage("trends")}
          >
            View charts
          </button>
        </div>
        <div className="energy-strip" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 0 }}>
          <div className="energy-cell">
            <span>Waist/Height</span>
            <strong className="num">{ratio(waist, settings.heightCm)}</strong>
          </div>
          <div className="energy-cell">
            <span>Arm/Waist</span>
            <strong className="num">
              {ratio(left == null || right == null ? undefined : (left + right) / 2, waist)}
            </strong>
          </div>
          <div className="energy-cell">
            <span>4-Wk Trend</span>
            <strong style={{ fontSize: ".82rem" }}>{recomp(readings, today)}</strong>
          </div>
        </div>
      </section>
    </>
  );
}
