"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { weightReadingsThrough } from "../lib/metrics";
import type { DailyNutritionView } from "../lib/nutrition-data";
import { addDays } from "../lib/nutrition-model";
import type { DailyStrainView, NutritionHistory, NutritionSettings, RecoveryInsightView, TrackerSnapshot } from "./types";

export type TrendMetricKind = "strain" | "energy" | "weight";
type TimeframeDays = 7 | 30 | 90;

interface MetricTrendsModalProps {
  open: boolean;
  initialMetric: TrendMetricKind;
  today: string;
  history30: NutritionHistory;
  daily?: DailyNutritionView;
  tracker: TrackerSnapshot;
  settings: NutritionSettings;
  recoveryInsights?: RecoveryInsightView;
  onClose: () => void;
}

function shortDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  });
}

export function MetricTrendsModal({
  open,
  initialMetric,
  today,
  history30,
  daily,
  tracker,
  settings,
  onClose,
}: MetricTrendsModalProps) {
  const [metric, setMetric] = useState<TrendMetricKind>(initialMetric);
  const [days, setDays] = useState<TimeframeDays>(30);
  const [strainDays, setStrainDays] = useState<Record<number, DailyStrainView[]>>({});
  const [nutrition90, setNutrition90] = useState<NutritionHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setStrainDays({}); setNutrition90(null); }, [today]);

  useEffect(() => {
    if (open) setMetric(initialMetric);
  }, [open, initialMetric]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoading(false);
    let active = true;
    const from = addDays(today, -(days - 1));

    if (metric === "strain" && !strainDays[days]) {
      setLoading(true);
      setError(null);
      fetch(`/api/strain?from=${from}&to=${today}`, { cache: "no-store" })
        .then(async (res) => { if (!res.ok) throw new Error(`History request failed (HTTP ${res.status})`); return await res.json() as { days?: DailyStrainView[] }; })
        .then((payload) => {
          if (active && payload?.days) {
            setStrainDays((prev) => ({ ...prev, [days]: payload.days! }));
          }
        })
        .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load history"); })
        .finally(() => {
          if (active) setLoading(false);
        });
    } else if ((metric === "energy" || metric === "weight") && days === 90 && !nutrition90) {
      setLoading(true);
      setError(null);
      fetch(`/api/nutrition?from=${addDays(today, -89)}&to=${today}`, { cache: "no-store" })
        .then(async (res) => { if (!res.ok) throw new Error(`History request failed (HTTP ${res.status})`); return await res.json() as NutritionHistory; })
        .then((payload) => {
          if (active && payload?.days) setNutrition90(payload);
        })
        .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load history"); })
        .finally(() => {
          if (active) setLoading(false);
        });
    }

    return () => {
      active = false;
    };
  }, [open, metric, days, today, strainDays, nutrition90]);

  const strainChartData = useMemo(() => {
    const list = (strainDays[days] ?? []).filter((day) => day.day >= addDays(today, -(days - 1)) && day.day <= today);
    return list.map((d) => ({
      day: d.day,
      label: shortDay(d.day),
      overall: d.overallStrain != null ? Number(d.overallStrain.toFixed(1)) : null,
      muscular: d.muscularStrain != null ? Number(d.muscularStrain.toFixed(1)) : null,
      cardio: d.cardioStrain != null ? Number(d.cardioStrain.toFixed(1)) : null,
    }));
  }, [strainDays, days, today]);

  const energyChartData = useMemo(() => {
    const source = days === 90 && nutrition90 ? nutrition90 : history30;
    const from = addDays(today, -(days - 1));
    return source.days
      .filter((d) => d.day >= from && d.day <= today)
      .map((d) => ({
        day: d.day,
        label: shortDay(d.day),
        intake: d.totals.calories != null ? Math.round(d.totals.calories) : null,
        burn: d.energy?.totalKcal != null ? Math.round(d.energy.totalKcal) : null,
        target: d.target,
        deficit: !d.provisional && d.deficit != null ? Math.round(d.deficit) : null,
        complete: d.diaryComplete,
        provisional: d.provisional,
      }));
  }, [days, nutrition90, history30, today]);

  const weightChartData = useMemo(() => {
    const from = addDays(today, -(days - 1));
    const nutrition = days === 90 && nutrition90 ? nutrition90 : history30;
    return weightReadingsThrough(tracker.readings, [...nutrition.days, ...(daily ? [daily] : [])], today)
      .filter((reading) => reading.date >= from)
      .map(({ date, value }) => ({
        day: date,
        label: shortDay(date),
        weightKg: Number(value.toFixed(1)),
      }));
  }, [days, today, tracker.readings, history30, nutrition90, daily]);

  const strainStats = useMemo(() => {
    const valid = strainChartData.filter((d) => d.overall != null);
    if (!valid.length) return null;
    const avgOverall = valid.reduce((s, d) => s + (d.overall ?? 0), 0) / valid.length;
    const averageComponent = (values: (number | null)[]) => { const known = values.filter((value): value is number => value != null); return known.length ? (known.reduce((sum, value) => sum + value, 0) / known.length).toFixed(1) : "—"; };
    const avgMuscular = averageComponent(valid.map((d) => d.muscular));
    const avgCardio = averageComponent(valid.map((d) => d.cardio));
    return {
      avgOverall: avgOverall.toFixed(1),
      avgMuscular,
      avgCardio,
    };
  }, [strainChartData]);

  const energyStats = useMemo(() => {
    const validIntake = energyChartData.filter((d) => d.intake != null && d.complete);
    const validBurn = energyChartData.filter((d) => d.burn != null);
    const validDeficit = energyChartData.filter((d) => d.deficit != null);
    const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
    const avgIn = avg(validIntake.map((d) => d.intake!));
    const avgBurn = avg(validBurn.map((d) => d.burn!));
    const avgDef = avg(validDeficit.map((d) => d.deficit!));
    return { avgIn, avgBurn, avgDef, intakeDays: validIntake.length, balanceDays: validDeficit.length };
  }, [energyChartData]);

  const weightStats = useMemo(() => {
    if (!weightChartData.length) return null;
    const first = weightChartData[0].weightKg;
    const latest = weightChartData[weightChartData.length - 1].weightKg;
    const min = Math.min(...weightChartData.map((d) => d.weightKg));
    const max = Math.max(...weightChartData.map((d) => d.weightKg));
    const delta = Number((latest - first).toFixed(1));
    return { latest, delta, min, max };
  }, [weightChartData]);

  if (!open) return null;

  return (
    <dialog className="modal-backdrop" open aria-label="Metric Trends" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet">
        <div className="modal-top">
          <div className="sheet-grabber" />
          <div className="split-row modal-header">
            <h2>Metric Trends</h2>
            <button type="button" className="secondary icon-btn modal-close-btn" aria-label="Close trends" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
          <div className="segmented" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }} role="tablist" aria-label="Trend metric">
            {(
              [
                ["strain", "Strain"],
                ["energy", "Energy Balance"],
                ["weight", "Weight"],
              ] as [TrendMetricKind, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={metric === key}
                className={metric === key ? "active" : ""}
                onClick={() => setMetric(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="segments" role="group" aria-label="Timeframe">
            {([7, 30, 90] as TimeframeDays[]).map((d) => (
              <button
                key={d}
                type="button"
                className={days === d ? "" : "secondary"}
                aria-pressed={days === d}
                style={{ minHeight: "34px", padding: ".2rem .75rem", fontSize: ".76rem" }}
                onClick={() => setDays(d)}
              >
                {d}D
              </button>
            ))}
          </div>
        </div>

        <div className="modal-body">
          {error && <p role="alert" className="empty">{error}. Close and reopen trends to try again.</p>}
          {loading && <p className="empty">Loading {days}D history…</p>}

          {!loading && !error && metric === "strain" && (
            <>
              {!strainStats && <p className="empty">No assessed strain in this period. Missing records are not rest days.</p>}
              {strainStats && (
                <div className="energy-strip" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 0 }}>
                  <div className="energy-cell">
                    <span>Avg Strain</span>
                    <strong className="num">{strainStats.avgOverall}</strong>
                  </div>
                  <div className="energy-cell">
                    <span>Muscular</span>
                    <strong className="num" style={{ color: "var(--purple)" }}>{strainStats.avgMuscular}</strong>
                  </div>
                  <div className="energy-cell">
                    <span>Cardio</span>
                    <strong className="num" style={{ color: "var(--strain-color)" }}>{strainStats.avgCardio}</strong>
                  </div>
                </div>
              )}

              <section className="card" style={{ display: "grid", gap: ".5rem" }}>
                <div className="split-row">
                  <span className="eyebrow">Daily estimated strain</span>
                </div>
                <div style={{ width: "100%", height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={strainChartData} margin={{ top: 10, right: 8, left: -22, bottom: 0 }}>
                      <defs>
                        <linearGradient id="silkStrainGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#f97316" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#f97316" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(46,48,64,0.08)" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#585a68" }} minTickGap={22} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#585a68" }} />
                      <Tooltip />
                      <Area type="monotone" dataKey="overall" name="Overall Strain" stroke="#f97316" strokeWidth={2.5} fill="url(#silkStrainGrad)" connectNulls={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section className="card" style={{ display: "grid", gap: ".5rem" }}>
                <span className="eyebrow">Muscular vs Cardio Distribution</span>
                <div style={{ width: "100%", height: 180 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={strainChartData} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(46,48,64,0.08)" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#585a68" }} minTickGap={22} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "#585a68" }} />
                      <Tooltip />
                      <Bar dataKey="muscular" name="Muscular" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="cardio" name="Cardio" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </>
          )}

          {!loading && !error && metric === "energy" && (
            <>
              <div className="energy-strip" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 0 }}>
                <div className="energy-cell">
                  <span>Avg complete-day intake</span>
                  <strong className="num">{energyStats.avgIn != null ? `${energyStats.avgIn} kcal` : "—"}</strong>
                </div>
                <div className="energy-cell">
                  <span>Avg Burn</span>
                  <strong className="num">{energyStats.avgBurn != null ? `${energyStats.avgBurn} kcal` : "—"}</strong>
                </div>
                <div className="energy-cell">
                  <span>Avg estimated deficit</span>
                  <strong className="num" style={{ color: "var(--accent)" }}>
                    {energyStats.avgDef != null ? `${energyStats.avgDef > 0 ? "+" : ""}${energyStats.avgDef} kcal` : "—"}
                  </strong>
                </div>
              </div>

              <p className="metric-provenance">Intake average: {energyStats.intakeDays} complete days. Balance: {energyStats.balanceDays} comparable days. Missing or incomplete food days are excluded; positive deficit means expenditure exceeded intake. Wearable burn is estimated.</p>
              <section className="card" style={{ display: "grid", gap: ".5rem" }}>
                <span className="eyebrow">Intake vs Expenditure ({days}D)</span>
                <div style={{ width: "100%", height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={energyChartData} margin={{ top: 10, right: 8, left: -12, bottom: 0 }}>
                      <defs>
                        <linearGradient id="silkIntakeGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(46,48,64,0.08)" />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#585a68" }} minTickGap={22} />
                      <YAxis tick={{ fontSize: 11, fill: "#585a68" }} />
                      <Tooltip />
                      <Area type="monotone" dataKey="intake" name="Intake (kcal)" stroke="#6366f1" strokeWidth={2.2} fill="url(#silkIntakeGrad)" connectNulls={false} />
                      <Line type="monotone" dataKey="burn" name="Total Burn (kcal)" stroke="#10b981" strokeWidth={2.2} dot={false} connectNulls={false} />
                      <Line type="stepAfter" dataKey="target" name="Historical target (kcal)" stroke="#8b5cf6" strokeDasharray="4 4" dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </>
          )}

          {!loading && !error && metric === "weight" && (
            <>
              {weightStats ? (
                <>
                  <div className="energy-strip" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 0 }}>
                    <div className="energy-cell">
                      <span>Latest</span>
                      <strong className="num">{weightStats.latest.toFixed(1)} kg</strong>
                    </div>
                    <div className="energy-cell">
                      <span>{days}D Change</span>
                      <strong
                        className="num"
                        style={{ color: weightStats.delta <= 0 ? "var(--status-good)" : "var(--strain-color)" }}
                      >
                        {weightStats.delta > 0 ? "+" : ""}
                        {weightStats.delta.toFixed(1)} kg
                      </strong>
                    </div>
                    <div className="energy-cell">
                      <span>Range</span>
                      <strong className="num">{weightStats.min.toFixed(1)}–{weightStats.max.toFixed(1)}</strong>
                    </div>
                  </div>

                  <section className="card" style={{ display: "grid", gap: ".5rem" }}>
                    <span className="eyebrow">Weight Trajectory ({days}D)</span>
                    <div style={{ width: "100%", height: 240 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={weightChartData} margin={{ top: 10, right: 8, left: -14, bottom: 0 }}>
                          <defs>
                            <linearGradient id="silkWeightGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.35} />
                              <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.02} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(46,48,64,0.08)" />
                          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#585a68" }} minTickGap={22} />
                          <YAxis domain={["dataMin - 1", "dataMax + 1"]} tick={{ fontSize: 11, fill: "#585a68" }} />
                          <Tooltip />
                          <Area type="monotone" dataKey="weightKg" name="Weight (kg)" stroke="#06b6d4" strokeWidth={2.5} fill="url(#silkWeightGrad)" connectNulls={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </section>
                </>
              ) : (
                <p className="empty">No weight entries logged in the last {days} days.</p>
              )}
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
