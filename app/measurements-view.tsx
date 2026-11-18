"use client";

import dynamic from "next/dynamic";
import { useState, type FormEvent } from "react";
import { Activity, ChevronRight, Crosshair, Plus, Ruler } from "lucide-react";
import { MoonThemeIcon, SunThemeIcon } from "../components/icons";
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
import type { NutritionHistory, NutritionSettings, ThemeMode, TrackerSnapshot } from "./types";

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
  theme: ThemeMode;
  busy: boolean;
  onToggleTheme: () => void;
  onSaveTracker: (action: object, successMessage: string) => Promise<void>;
}

export function MeasurementsView({
  snapshot,
  nutritionSettings,
  history30,
  daily,
  today,
  theme,
  busy,
  onToggleTheme,
  onSaveTracker,
}: MeasurementsViewProps) {
  const [sub, setSub] = useState<"overview" | "trends" | "log">("overview");
  const [date, setDate] = useState(today);
  const [localMsg, setLocalMsg] = useState("");
  const { readings, settings } = snapshot;

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

  const selected = readings.filter((r) => r.date === date);
  const [waistMetric, leftMetric, rightMetric] = metrics;
  const [waist, left, right] = [waistMetric, leftMetric, rightMetric].map(
    (m) => summary(readingsFor(readings, m), today).latest?.value,
  );
  const ratio = (val: number | undefined, base: number | null | undefined) =>
    val != null && base != null && base > 0 ? (val / base).toFixed(2) : "Insufficient data";

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
    );
  }

  return (
    <>
      <div className="page-header">
        <div className="page-header-title">
          <h1>Measurements</h1>
          <p style={{ fontSize: ".84rem" }}>Waist, weight, and circumference tracking</p>
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
          <button type="button" className="compact" onClick={() => setSub(sub === "log" ? "overview" : "log")}>
            <Plus size={16} /> {sub === "log" ? "Back" : "Log"}
          </button>
        </div>
      </div>

      <div className="segments" role="tablist" aria-label="Measurement views">
        {(
          [
            ["overview", "Overview"],
            ["trends", "Trends"],
            ["log", "Log & History"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={sub === key} onClick={() => setSub(key)}>
            {label}
          </button>
        ))}
      </div>

      {sub === "overview" && (
        <>
          <div className="measure-grid">
            {metrics
              .filter((metric, index) => index < 3 || readingsFor(readings, metric).length > 0)
              .map((metric) => {
                const { latest, change, weekly } = summary(readingsFor(readings, metric), today);
                return (
                  <article className="card metric-card" key={metric.key}>
                    <h2>{metric.label}</h2>
                    <div className="reading">
                      {readout(latest?.value, metric, settings.units)}{" "}
                      <small>{displayUnit(metric, settings.units)}</small>
                    </div>
                    <div className="metric-meta">
                      <span>7-day change</span>
                      <span className="num">
                        {change != null && change > 0 ? "+" : ""}
                        {readout(change, metric, settings.units)}
                      </span>
                    </div>
                    <div className="metric-meta">
                      <span>7-day average</span>
                      <span className="num">{readout(weekly, metric, settings.units)}</span>
                    </div>
                  </article>
                );
              })}
          </div>

          {isFitbitMode && (latestBodyFat != null || latestVo2Max != null) && (
            <section className="card" aria-label="Fitbit body and cardio">
              <div className="split-row" style={{ marginBottom: ".6rem" }}>
                <h2>Fitbit Body &amp; Cardio</h2>
                <span className="pill teal-soft">Fitbit Air</span>
              </div>
              <div className="macro-grid">
                <div className="energy-cell">
                  <span>Body fat %</span>
                  <strong className="num">
                    {latestBodyFat != null ? `${Number(latestBodyFat.toFixed(1))}%` : "—"}
                  </strong>
                </div>
                <div className="energy-cell">
                  <span>Cardio Fitness VO2 max</span>
                  <strong className="num">
                    {latestVo2Max != null ? `${Number(latestVo2Max.toFixed(1))} ml/kg/min` : "—"}
                  </strong>
                </div>
              </div>
            </section>
          )}

          <h2 className="section-title">Insights</h2>
          <div className="insight-grid">
            <article className="card">
              <Ruler className="accent" size={20} />
              <h3>Waist-to-height</h3>
              <strong className="num">{ratio(waist, settings.heightCm)}</strong>
            </article>
            <article className="card">
              <Activity className="accent" size={20} />
              <h3>Arm-to-waist</h3>
              <strong className="num">
                {ratio(left == null || right == null ? undefined : (left + right) / 2, waist)}
              </strong>
            </article>
            <article className="card recomp">
              <Crosshair className="accent" size={20} />
              <h3>Recomp direction</h3>
              <strong>{recomp(readings, today)}</strong>
              <p>
                Compares the last 4 weeks with the 4 weeks before. Changes up to 0.5 cm count as flat. Each period needs two readings per metric.
              </p>
            </article>
          </div>
        </>
      )}

      {sub === "trends" && (
        <TrendChart readings={readings} today={today} units={settings.units} height={settings.heightCm} />
      )}

      {sub === "log" && (
        <>
          <form className="card" key={date + JSON.stringify(selected)} onSubmit={submitLog} method="post">
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
              Note <small>Optional</small>
              <textarea name="note" rows={2} maxLength={1000} placeholder="Leave blank to keep existing notes" />
            </label>
            {selected.some((r) => r.note) && (
              <label className="check-row">
                <input type="checkbox" name="clearNotes" /> Clear existing notes when the note field is blank
              </label>
            )}
            {localMsg && <p role="alert">{localMsg}</p>}
            <Button disabled={busy} type="submit">
              Save measurements
            </Button>
          </form>

          {readings.length > 0 && (
            <section className="card">
              <h2>Recent entries</h2>
              {[...new Set(readings.map((r) => r.date))].slice(0, 10).map((day) => (
                <button type="button" className="list-item" key={day} onClick={() => setDate(day)}>
                  <span className="num">{day}</span>
                  <ChevronRight size={18} />
                </button>
              ))}
            </section>
          )}

          {selected.length > 0 && (
            <section className="card">
              <h2>Entries on {date}</h2>
              {selected.map((row) => {
                const metric = metrics.find((m) => m.metric === row.metric && m.side === row.side)!;
                return (
                  <div className="list-item" key={row.id}>
                    <span>
                      {metric.label}: <strong className="num">{readout(row.value, metric, settings.units)} {displayUnit(metric, settings.units)}</strong>
                      {row.note && <small className="row-note">{row.note}</small>}
                    </span>
                    <button
                      type="button"
                      className="secondary compact"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(`Delete ${metric.label} for ${date}?`)) {
                          void onSaveTracker({ action: "delete-reading", id: row.id }, "Measurement deleted.");
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}
    </>
  );
}
