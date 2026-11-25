"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, SlidersHorizontal, Upload } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BevelScoreRing } from "../components/bevel-widgets";
import { FitbitPulseIcon, FlameBurnIcon, FootstepsIcon } from "../components/icons";
import { MuscleFreshnessMap } from "../components/muscle-map-svg";
import type { StrainActivityBreakdown } from "../lib/strain-data";
import { computeTargetStrain } from "../lib/strain-engine";
import type { LoadStatusAssessment, TrainingLoadSummary } from "../lib/training-load";
import { addDays } from "../lib/nutrition-model";
import {
  fmtRelativeSync,
  type DailyStrainView,
  type GoogleIntegrationStatus,
  type HevyIntegrationStatus,
  type PulseInsightsView,
  type RecoveryInsightView,
  type StrainSettings,
  type ThemeMode,
} from "./types";

interface TrainingViewProps {
  today: string;
  selectedDay: string;
  strain: DailyStrainView;
  recoveryInsights?: RecoveryInsightView;
  pulseInsights?: PulseInsightsView | null;
  strainSettings: StrainSettings;
  hevy: HevyIntegrationStatus;
  google?: GoogleIntegrationStatus;
  theme: ThemeMode;
  busy: boolean;
  loading: boolean;
  onSelectDay: (day: string) => void;
  onRecomputeDay: (day: string) => void;
  onImportHevy: (rawText: string) => Promise<boolean>;
  onSyncHevy: () => Promise<void>;
  onOpenSettings: () => void;
}

type DrilldownPage =
  | null
  | { kind: "muscular" }
  | { kind: "cardio" }
  | { kind: "muscles" }
  | { kind: "recovery" }
  | { kind: "activity"; id: string };

function fmtDur(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "—";
  const mins = Math.round(seconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtSleep(minutes: number | null): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function statusPillClass(tone: LoadStatusAssessment["tone"]): string {
  if (tone === "teal") return "teal-soft";
  if (tone === "blue") return "protein-soft";
  if (tone === "amber") return "amber-soft";
  if (tone === "danger") return "danger-soft";
  return "";
}

function loadPercent(
  latest: { daily: number; acute7d: number; chronic42d: number } | null | undefined,
  status: LoadStatusAssessment | null | undefined,
  refLoad: number,
): { pct: number | null; subtitle: string } {
  if (!latest) return { pct: null, subtitle: "No history yet" };
  if (status?.acwr != null) {
    return {
      pct: Math.round(status.acwr * 100),
      subtitle: "Optimal 85–130%",
    };
  }
  const indexPct = Math.min(100, Math.round(100 * (1 - Math.exp(-Math.max(0, latest.acute7d) / refLoad))));
  return {
    pct: indexPct,
    subtitle: "Calibrating baseline",
  };
}

export function TrainingView({
  today,
  selectedDay,
  strain,
  recoveryInsights,
  pulseInsights,
  hevy,
  google,
  busy,
  loading,
  onSelectDay,
  onRecomputeDay,
  onImportHevy,
  onSyncHevy,
  onOpenSettings,
}: TrainingViewProps) {
  const [page, setPage] = useState<DrilldownPage>(null);
  const [loads, setLoads] = useState<TrainingLoadSummary | null>(null);
  const [loadsBusy, setLoadsBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoadsBusy(true);
    const from = addDays(selectedDay, -27);
    fetch(`/api/strain?loads=1&from=${from}&to=${selectedDay}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (res) => (res.ok ? ((await res.json()) as TrainingLoadSummary) : null))
      .then((data) => {
        if (data && !controller.signal.aborted) setLoads(data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setLoadsBusy(false);
      });
    return () => controller.abort();
  }, [selectedDay, strain.computedAt]);

  async function handleFileImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    await onImportHevy(text);
  }

  const overall = strain.overallStrain;
  const activeAcwr = loads?.cardioStatus?.acwr ?? loads?.muscularStatus?.acwr ?? null;
  const effectiveRecovery = pulseInsights?.recovery.score ?? recoveryInsights?.score;
  const target =
    pulseInsights?.strainTarget ??
    computeTargetStrain(effectiveRecovery, { acwr: activeAcwr });
  const inZone = overall != null && overall >= target.min && overall <= target.max;
  const overZone = overall != null && overall > target.max;

  const formattedDate = new Date(`${selectedDay}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  const fatiguedCount =
    loads?.muscleFreshness?.filter((m) => m.status === "fatigued").length ?? 0;
  const recoveringCount =
    loads?.muscleFreshness?.filter((m) => m.status === "recovering").length ?? 0;

  // ===========================================================================
  // FULL-PAGE BEVEL DRILL-DOWN VIEWS
  // ===========================================================================
  if (page) {
    const backHeader = (title: string, badge?: React.ReactNode) => (
      <div className="page-header" style={{ marginBottom: ".2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: ".6rem", width: "100%", justifyContent: "space-between" }}>
          <button
            type="button"
            className="secondary compact"
            onClick={() => setPage(null)}
            style={{ minHeight: "36px", padding: ".25rem .7rem" }}
          >
            <ArrowLeft size={16} /> Back
          </button>
          <h1 style={{ fontSize: "1.2rem", margin: 0, letterSpacing: "-0.02em", flex: 1, textAlign: "center" }}>
            {title}
          </h1>
          <div style={{ minWidth: "60px", display: "flex", justifyContent: "flex-end" }}>
            {badge}
          </div>
        </div>
      </div>
    );

    if (page.kind === "muscular") {
      const status = loads?.muscularStatus;
      const mPct = loadPercent(loads?.latestMuscular, status, 9);
      return (
        <>
          {backHeader(
            "Muscular Load",
            status && <span className={`pill ${statusPillClass(status.tone)}`}>{status.label}</span>,
          )}
          <section className="card" style={{ display: "grid", gap: ".75rem" }}>
            <div className="split-row">
              <div>
                <span className="eyebrow">Muscular Load</span>
                <h2 style={{ margin: ".15rem 0 0", fontSize: "1.55rem", letterSpacing: "-0.03em" }}>
                  <span className="num">{mPct.pct != null ? `${mPct.pct}%` : "—"}</span>
                  <span className="muted" style={{ fontSize: ".85rem", fontWeight: 500, marginLeft: ".45rem" }}>
                    {mPct.subtitle}
                  </span>
                </h2>
              </div>
              <button
                type="button"
                className="secondary compact"
                disabled={busy}
                onClick={() => void onSyncHevy()}
              >
                <RefreshCw size={13} /> Sync Hevy
              </button>
            </div>
            {status && <p style={{ fontSize: ".82rem", color: "var(--muted)", margin: 0 }}>{status.guidance}</p>}

            {loads?.latestMuscular ? (
              <>
                <div className="energy-strip" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 0 }}>
                  <div className="energy-cell">
                    <span>Today</span>
                    <strong className="num">{Math.min(100, Math.round(100 * (1 - Math.exp(-loads.latestMuscular.daily / 18))))}%</strong>
                  </div>
                  <div className="energy-cell">
                    <span>7d Load</span>
                    <strong className="num">{mPct.pct != null ? `${mPct.pct}%` : "—"}</strong>
                  </div>
                  <div className="energy-cell">
                    <span>Optimal Zone</span>
                    <strong className="num">85–130%</strong>
                  </div>
                </div>
                {loads.muscularSeries.length > 1 && (
                  <div className="chart" style={{ height: 210 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={loads.muscularSeries.slice(-28)}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} width={32} />
                        <Tooltip />
                        <Area
                          type="monotone"
                          dataKey="optimalMax"
                          name="Optimal Ceiling"
                          stroke="none"
                          fill="var(--purple-soft, rgba(124,58,237,0.14))"
                          fillOpacity={0.4}
                        />
                        <Line type="monotone" dataKey="acute7d" name="7d Acute" stroke="var(--purple)" dot={false} strokeWidth={2.5} />
                        <Line type="monotone" dataKey="chronic42d" name="42d Chronic" stroke="var(--accent)" dot={false} strokeWidth={2} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </>
            ) : (
              <p className="empty">No muscular training history synced yet.</p>
            )}
          </section>

          {loads?.muscleFreshness?.length ? (
            <section className="card" style={{ display: "grid", gap: ".65rem" }}>
              <div className="split-row">
                <h2 style={{ fontSize: "1rem", margin: 0 }}>Muscle Recovery Map</h2>
                <span className="pill">Hevy</span>
              </div>
              <MuscleFreshnessMap entries={loads.muscleFreshness} />
            </section>
          ) : null}
        </>
      );
    }

    if (page.kind === "cardio") {
      const status = loads?.cardioStatus;
      const cPct = loadPercent(loads?.latestCardio, status, 70);
      return (
        <>
          {backHeader(
            "Cardio Load",
            status && <span className={`pill ${statusPillClass(status.tone)}`}>{status.label}</span>,
          )}
          <section className="card" style={{ display: "grid", gap: ".75rem" }}>
            <div>
              <span className="eyebrow">Cardio Load</span>
              <h2 style={{ margin: ".15rem 0 0", fontSize: "1.55rem", letterSpacing: "-0.03em" }}>
                <span className="num">{cPct.pct != null ? `${cPct.pct}%` : "—"}</span>
                <span className="muted" style={{ fontSize: ".85rem", fontWeight: 500, marginLeft: ".45rem" }}>
                  {cPct.subtitle}
                </span>
              </h2>
            </div>
            {status && <p style={{ fontSize: ".82rem", color: "var(--muted)", margin: 0 }}>{status.guidance}</p>}

            {loads?.latestCardio ? (
              <>
                <div className="energy-strip" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 0 }}>
                  <div className="energy-cell">
                    <span>Today</span>
                    <strong className="num">{Math.min(100, Math.round(100 * (1 - Math.exp(-loads.latestCardio.daily / 220))))}%</strong>
                  </div>
                  <div className="energy-cell">
                    <span>7d Load</span>
                    <strong className="num">{cPct.pct != null ? `${cPct.pct}%` : "—"}</strong>
                  </div>
                  <div className="energy-cell">
                    <span>Optimal Zone</span>
                    <strong className="num">85–130%</strong>
                  </div>
                </div>
                {loads.cardioSeries.length > 1 && (
                  <div className="chart" style={{ height: 220 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={loads.cardioSeries.slice(-28)}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} width={32} />
                        <Tooltip />
                        <Area
                          type="monotone"
                          dataKey="optimalMax"
                          name="Optimal Ceiling"
                          stroke="none"
                          fill="var(--teal-soft)"
                          fillOpacity={0.4}
                        />
                        <Line type="monotone" dataKey="acute7d" name="7d Acute" stroke="var(--blue)" dot={false} strokeWidth={2.5} />
                        <Line type="monotone" dataKey="chronic42d" name="42d Chronic" stroke="var(--teal)" dot={false} strokeWidth={2} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </>
            ) : (
              <p className="empty">No cardio history synced yet.</p>
            )}
          </section>
        </>
      );
    }

    if (page.kind === "muscles") {
      return (
        <>
          {backHeader("Muscle Recovery")}
          <section className="card" style={{ display: "grid", gap: ".75rem" }}>
            {loads?.muscleFreshness?.length ? (
              <MuscleFreshnessMap entries={loads.muscleFreshness} />
            ) : (
              <p className="empty">Sync Hevy workouts to map your muscle recovery &amp; strain heatmap.</p>
            )}
          </section>
        </>
      );
    }

    if (page.kind === "recovery") {
      const rec = recoveryInsights;
      return (
        <>
          {backHeader("Recovery")}
          <section className="card" style={{ display: "grid", gap: ".9rem", justifyItems: "center" }} aria-label="Recovery Insights">
            <BevelScoreRing
              label="Recovery Score"
              value={rec?.score ?? null}
              displayText={rec?.score != null ? `${rec.score}%` : "—"}
              pct={rec?.score ?? 0}
              color="var(--recovery-color)"
              size={128}
              strokeWidth={10}
              sublabel={
                rec?.band === "optimal"
                  ? "Optimal"
                  : rec?.band === "moderate"
                    ? "Moderate"
                    : rec?.band === "strained"
                      ? "Strained"
                      : "Pending sync"
              }
            />
            <div className="energy-strip" style={{ width: "100%", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 0 }}>
              <div className="energy-cell">
                <span>Sleep</span>
                <strong className="num">{fmtSleep(rec?.metrics.sleepMinutes ?? null)}</strong>
              </div>
              <div className="energy-cell">
                <span>Resting HR</span>
                <strong className="num">
                  {rec?.metrics.restingHrBpm != null ? `${Math.round(rec.metrics.restingHrBpm)} bpm` : "—"}
                </strong>
              </div>
              <div className="energy-cell">
                <span>HRV</span>
                <strong className="num">
                  {rec?.metrics.hrvRmssdMs != null ? `${Math.round(rec.metrics.hrvRmssdMs)} ms` : "—"}
                </strong>
              </div>
            </div>
            {rec?.summary && (
              <p style={{ fontSize: ".82rem", color: "var(--muted)", margin: 0, textAlign: "center" }}>
                {rec.summary}
              </p>
            )}
            <div className="bevel-awaiting-strip" style={{ width: "100%" }}>
              <span>
                <strong>Target Strain:</strong> {target.min}–{target.max} ({target.label})
              </span>
            </div>
          </section>

          {pulseInsights && pulseInsights.recovery.drivers.length > 0 && (
            <section className="card" style={{ display: "grid", gap: ".55rem" }}>
              <span className="eyebrow">Recovery Drivers ({pulseInsights.recovery.baselineStatus})</span>
              <div style={{ display: "grid", gap: ".35rem" }}>
                {pulseInsights.recovery.drivers.map((d) => (
                  <div key={d.key} className="split-row" style={{ fontSize: ".82rem" }}>
                    <span>
                      <strong>{d.label}</strong>{" "}
                      <span style={{ color: "var(--muted)" }}>
                        {d.valueText}
                        {d.baselineText ? ` (base ${d.baselineText})` : ""}
                      </span>
                    </span>
                    <span className={`pill ${d.tone === "good" ? "teal-soft" : d.tone === "bad" ? "danger-soft" : d.tone === "warn" ? "amber-soft" : ""}`}>
                      {d.impactPts >= 0 ? `+${d.impactPts}` : d.impactPts} pts
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {pulseInsights && pulseInsights.healthMonitor.availableCount > 0 && (
            <section className="card" style={{ display: "grid", gap: ".55rem" }}>
              <div className="split-row">
                <span className="eyebrow">5-Vital Health Monitor</span>
                <span className={`pill ${pulseInsights.healthMonitor.status === "elevated" ? "danger-soft" : pulseInsights.healthMonitor.status === "watch" ? "amber-soft" : "teal-soft"}`}>
                  {pulseInsights.healthMonitor.status}
                </span>
              </div>
              <p style={{ fontSize: ".78rem", margin: 0 }}>{pulseInsights.healthMonitor.note}</p>
              <div style={{ display: "grid", gap: ".3rem" }}>
                {pulseInsights.healthMonitor.vitals.map((v) => (
                  <div key={v.key} className="split-row" style={{ fontSize: ".8rem" }}>
                    <span>{v.label}</span>
                    <span className="num">
                      <strong>{v.valueText}</strong>
                      {v.rangeText ? <span style={{ color: "var(--muted)" }}> · {v.rangeText}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {pulseInsights?.forecast.predictedScore != null && (
            <section className="card" style={{ display: "grid", gap: ".3rem" }}>
              <div className="split-row">
                <span className="eyebrow">Next-Day Readiness Forecast</span>
                <strong className="num" style={{ color: "var(--accent)" }}>
                  {pulseInsights.forecast.predictedScore}% ({pulseInsights.forecast.low}–{pulseInsights.forecast.high}%)
                </strong>
              </div>
              <p style={{ fontSize: ".78rem", margin: 0 }}>{pulseInsights.forecast.summary}</p>
            </section>
          )}
        </>
      );
    }

    if (page.kind === "activity") {
      const act = strain.activities.find((a) => a.id === page.id);
      if (act) {
        const groupedExercises = new Map<string, NonNullable<StrainActivityBreakdown["sets"]>>();
        for (const s of act.sets ?? []) {
          const list = groupedExercises.get(s.exerciseTitle) ?? [];
          list.push(s);
          groupedExercises.set(s.exerciseTitle, list);
        }
        return (
          <>
            {backHeader(act.title, <span className="pill teal-soft">+{act.overallPointsContribution.toFixed(1)} pts</span>)}
            <section className="card" style={{ display: "grid", gap: ".75rem" }}>
              <div className="energy-strip" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 0 }}>
                <div className="energy-cell">
                  <span>Duration</span>
                  <strong className="num">{fmtDur(act.durationSeconds)}</strong>
                </div>
                <div className="energy-cell">
                  <span>Muscular</span>
                  <strong className="num">{act.mRaw > 0 ? act.mRaw : "—"}</strong>
                </div>
                <div className="energy-cell">
                  <span>Cardio TRIMP</span>
                  <strong className="num">{act.cRaw > 0 ? act.cRaw : "—"}</strong>
                </div>
              </div>

              {act.hrSeries && act.hrSeries.length > 1 && (
                <div>
                  <span className="eyebrow">Heart Rate ({act.avgHrBpm != null ? `Avg ${act.avgHrBpm} bpm` : "Timeline"})</span>
                  <div className="chart" style={{ height: 170, marginTop: ".35rem" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={act.hrSeries.map((p) => ({ time: p.recordedAt.slice(11, 16), bpm: p.bpm }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                        <YAxis domain={["dataMin - 10", "dataMax + 10"]} tick={{ fontSize: 10 }} width={32} />
                        <Tooltip />
                        <Area type="monotone" dataKey="bpm" stroke="var(--danger-fg)" fill="var(--danger-bg)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {act.trimpZones && act.trimpZones.some((z) => z.minutes > 0) && (
                <div className="energy-strip" style={{ marginTop: 0 }}>
                  {act.trimpZones.map((z) => (
                    <div className="energy-cell" key={z.zone}>
                      <span>Z{z.zone}</span>
                      <strong className="num">{z.minutes.toFixed(0)}m</strong>
                    </div>
                  ))}
                </div>
              )}

              {act.notes.map((n, idx) => (
                <p key={idx} style={{ fontSize: ".76rem", color: "var(--muted)", margin: 0 }}>{n}</p>
              ))}
            </section>

            {groupedExercises.size > 0 && (
              <section className="card" style={{ display: "grid", gap: ".55rem" }}>
                <h2 style={{ fontSize: "1rem", margin: 0 }}>Hevy Exercises</h2>
                {[...groupedExercises.entries()].map(([exTitle, sets]) => (
                  <div key={exTitle} style={{ borderTop: "1px solid var(--border)", paddingTop: ".45rem" }}>
                    <strong style={{ fontSize: ".88rem" }}>{exTitle}</strong>
                    <div style={{ display: "grid", gap: ".2rem", marginTop: ".25rem", fontSize: ".78rem", color: "var(--muted)" }}>
                      {sets.map((s, i) => (
                        <div key={i} className="split-row">
                          <span>Set {s.setIndex + 1} · {s.setType}</span>
                          <span className="num" style={{ color: "var(--text)" }}>
                            {s.weightKg != null ? `${s.weightKg} kg` : "BW"} × {s.reps ?? "—"}
                            {s.rpe != null ? ` · RPE ${s.rpe}` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            )}
          </>
        );
      }
    }
  }

  // ===========================================================================
  // MAIN TRAINING OVERVIEW (Sleek, Tappable Bevel Cards → Full-Page Drill-Downs)
  // ===========================================================================
  const recoveryPending = recoveryInsights?.score == null && recoveryInsights?.completeness === "unavailable";

  return (
    <>
      {/* Clean Header */}
      <div className="page-header" style={{ marginBottom: ".15rem" }}>
        <div className="page-header-title">
          <h1 style={{ fontSize: "1.45rem", letterSpacing: "-0.03em" }}>Training &amp; Strain</h1>
          <div className="page-sub">
            <span>{formattedDate}</span>
            <span className={`pill ${inZone ? "teal-soft" : overZone ? "amber-soft" : ""}`}>
              Target {target.min}–{target.max}
            </span>
          </div>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="secondary compact"
            disabled={busy || loading}
            onClick={() => onRecomputeDay(selectedDay)}
            aria-label="Recalculate strain"
          >
            <RefreshCw size={14} />
          </button>
          <button
            type="button"
            className="secondary compact"
            onClick={() => onOpenSettings("Settings")}
            aria-label="Walking and strain settings"
          >
            <SlidersHorizontal size={14} />
          </button>
        </div>
      </div>

      {/* Compact Date Navigation */}
      <section className="card" style={{ padding: ".6rem .75rem" }} aria-label="Training date navigation">
        <div className="date-nav">
          <button
            type="button"
            className="secondary compact"
            aria-label="Previous training day"
            onClick={() => onSelectDay(addDays(selectedDay, -1))}
          >
            <ChevronLeft size={18} />
          </button>
          <label style={{ flex: 1, minWidth: 0 }}>
            <span className="sr-only">Select training date</span>
            <input
              type="date"
              aria-label="Select training date"
              value={selectedDay}
              max={today}
              onChange={(e) => {
                if (e.target.value) onSelectDay(e.target.value);
              }}
            />
          </label>
          <button
            type="button"
            className="secondary compact"
            aria-label="Next training day"
            disabled={selectedDay >= today}
            onClick={() => onSelectDay(addDays(selectedDay, 1))}
          >
            <ChevronRight size={18} />
          </button>
          {selectedDay !== today && (
            <button type="button" className="secondary compact" onClick={() => onSelectDay(today)}>
              Today
            </button>
          )}
        </div>
      </section>

      {/* Recovery Insights Card (Taps into full-page Recovery view) */}
      <div className="unlock-gate">
        <section
          className={`card unlock-gate-content ${google && !google.connected ? "is-locked" : ""}`}
          aria-label="Recovery Insights"
          style={{ padding: recoveryPending ? ".65rem .9rem" : undefined }}
        >
          <button
            type="button"
            className="compact-row-btn"
            style={{ padding: 0, borderTop: 0 }}
            onClick={() => setPage({ kind: "recovery" })}
          >
            <div>
              <span className="eyebrow">Recovery</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: ".45rem", marginTop: ".1rem" }}>
                <strong className="num" style={{ fontSize: "1.2rem" }}>
                  {effectiveRecovery != null ? `${Math.round(effectiveRecovery)}%` : "Pending"}
                </strong>
                <span style={{ fontSize: ".78rem", color: "var(--muted)" }}>
                  {recoveryPending
                    ? "Awaiting morning sync"
                    : `${fmtSleep(recoveryInsights?.metrics.sleepMinutes ?? null)} sleep${
                        recoveryInsights?.metrics.restingHrBpm != null
                          ? ` · ${Math.round(recoveryInsights.metrics.restingHrBpm)} bpm RHR`
                          : ""
                      }`}
                </span>
              </div>
            </div>
            <ChevronRight size={17} style={{ color: "var(--muted)" }} />
          </button>
        </section>
        {google && !google.connected && (
          <div className="unlock-overlay">
            <h3>Unlock Recovery Insights</h3>
            <p>Connect Google Health to unlock Sleep, Resting HR, and HRV readiness.</p>
            {google.available ? (
              <a className="unlock-btn" href="/api/integrations/google/connect">
                Connect Google Health
              </a>
            ) : (
              <button type="button" className="unlock-btn" onClick={() => onOpenSettings()}>
                Configure in Settings
              </button>
            )}
          </div>
        )}
      </div>

      {/* Overall Strain Hero Ring */}
      <section className="card" aria-label="Overall Strain summary">
        <div className="ring-layout" style={{ alignItems: "center" }}>
          <BevelScoreRing
            label="Overall Strain"
            value={overall}
            displayText={overall == null ? "—" : overall.toFixed(1)}
            pct={overall ?? 0}
            color="var(--strain-color)"
            targetRange={[target.min, target.max]}
            size={110}
            strokeWidth={9.5}
            sublabel={target.label}
          />
          <div className="hero-stats">
            <div className="hero-figures">
              <div className="stat-mini">
                <span>Muscular</span>
                <strong className="num" style={{ color: "var(--purple)" }}>
                  {strain.muscularStrain == null ? "—" : strain.muscularStrain.toFixed(1)}
                </strong>
              </div>
              <div className="stat-mini">
                <span>Cardio</span>
                <strong className="num" style={{ color: "var(--blue)" }}>
                  {strain.cardioStrain == null ? "—" : strain.cardioStrain.toFixed(1)}
                </strong>
              </div>
              <div className="stat-mini">
                <span>Walking</span>
                <strong className="num" style={{ color: "var(--teal)" }}>
                  +{strain.walkingPoints.toFixed(1)}
                </strong>
              </div>
            </div>
            <p style={{ fontSize: ".76rem", color: "var(--muted)", margin: 0 }}>{target.guidance}</p>
          </div>
        </div>
      </section>

      {/* Long-Term Cardio & Muscular Load Cards (Percentage display → Full-Page Drill-Down) */}
      {(() => {
        const cPct = loadPercent(loads?.latestCardio, loads?.cardioStatus, 70);
        const mPct = loadPercent(loads?.latestMuscular, loads?.muscularStatus, 9);
        return (
          <section className="two-col" aria-label="Long-term training loads">
            <div className="unlock-gate">
              <button
                type="button"
                className={`card card-interactive unlock-gate-content ${google && !google.connected ? "is-locked" : ""}`}
                onClick={() => setPage({ kind: "cardio" })}
                style={{ width: "100%", textAlign: "left", background: "var(--surface)", color: "var(--text)" }}
              >
                <div className="split-row">
                  <span className="eyebrow">Cardio Load</span>
                  {loads?.cardioStatus ? (
                    <span className={`pill ${statusPillClass(loads.cardioStatus.tone)}`}>
                      {loads.cardioStatus.label}
                    </span>
                  ) : (
                    <span className="pill teal-soft">%</span>
                  )}
                </div>
                <div className="split-row" style={{ marginTop: ".45rem", alignItems: "baseline" }}>
                  <strong className="num" style={{ fontSize: "1.55rem", letterSpacing: "-0.03em" }}>
                    {loadsBusy && !loads ? "…" : cPct.pct != null ? `${cPct.pct}%` : "—"}
                  </strong>
                  <span style={{ fontSize: ".74rem", color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: ".2rem" }}>
                    {cPct.subtitle} <ChevronRight size={14} />
                  </span>
                </div>
              </button>
              {google && !google.connected && (
                <div className="unlock-overlay">
                  <h3>Unlock Cardio Load</h3>
                  <p>Connect Google Health to track heart-rate load.</p>
                  {google.available ? (
                    <a className="unlock-btn" href="/api/integrations/google/connect">
                      Connect Google Health
                    </a>
                  ) : (
                    <button type="button" className="unlock-btn" onClick={() => onOpenSettings("Settings")}>
                      Open Settings
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="unlock-gate">
              <button
                type="button"
                className={`card card-interactive unlock-gate-content ${!hevy.connected ? "is-locked" : ""}`}
                onClick={() => setPage({ kind: "muscular" })}
                style={{ width: "100%", textAlign: "left", background: "var(--surface)", color: "var(--text)" }}
              >
                <div className="split-row">
                  <span className="eyebrow">Muscular Load</span>
                  {loads?.muscularStatus ? (
                    <span className={`pill ${statusPillClass(loads.muscularStatus.tone)}`}>
                      {loads.muscularStatus.label}
                    </span>
                  ) : (
                    <span className="pill protein-soft">%</span>
                  )}
                </div>
                <div className="split-row" style={{ marginTop: ".45rem", alignItems: "baseline" }}>
                  <strong className="num" style={{ fontSize: "1.55rem", letterSpacing: "-0.03em" }}>
                    {loadsBusy && !loads ? "…" : mPct.pct != null ? `${mPct.pct}%` : "—"}
                  </strong>
                  <span style={{ fontSize: ".74rem", color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: ".2rem" }}>
                    {mPct.subtitle} <ChevronRight size={14} />
                  </span>
                </div>
              </button>
              {!hevy.connected && (
                <div className="unlock-overlay">
                  <h3>Unlock Muscular Load</h3>
                  <p>Connect Hevy to track set-level Muscular Load and training status.</p>
                  {hevy.oauthAvailable ? (
                    <a className="unlock-btn" href="/api/integrations/hevy/connect">
                      Connect Hevy to Unlock
                    </a>
                  ) : (
                    <label className="unlock-btn" style={{ cursor: "pointer" }}>
                      <Upload size={14} /> Import Hevy CSV / JSON
                      <input type="file" accept=".csv,.json,text/csv,application/json" style={{ display: "none" }} onChange={handleFileImport} />
                    </label>
                  )}
                </div>
              )}
            </div>
          </section>
        );
      })()}

      {/* Muscle Recovery & Heat Map Card (Tap → Full-Page Anatomical Heatmap) */}
      <div className="unlock-gate">
        <button
          type="button"
          className={`card card-interactive unlock-gate-content ${!hevy.connected ? "is-locked" : ""}`}
          onClick={() => setPage({ kind: "muscles" })}
          style={{ width: "100%", textAlign: "left", background: "var(--surface)", color: "var(--text)" }}
        >
          <div className="split-row">
            <div>
              <span className="eyebrow">Muscle Recovery &amp; Heat Map</span>
              <div style={{ fontSize: ".84rem", color: "var(--muted)", marginTop: ".2rem" }}>
                {loadsBusy && !loads
                  ? "Loading Hevy muscle map…"
                  : fatiguedCount > 0
                    ? `${fatiguedCount} fatigued · ${recoveringCount} recovering`
                    : recoveringCount > 0
                      ? `${recoveringCount} muscle group(s) recovering`
                      : "All muscle groups fresh & ready"}
              </div>
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: ".35rem" }}>
              <span className={`pill ${fatiguedCount > 0 ? "danger-soft" : recoveringCount > 0 ? "amber-soft" : "teal-soft"}`}>
                {fatiguedCount > 0 ? "Fatigued" : recoveringCount > 0 ? "Recovering" : "Fresh"}
              </span>
              <ChevronRight size={16} style={{ color: "var(--muted)" }} />
            </div>
          </div>
        </button>
        {!hevy.connected && (
          <div className="unlock-overlay">
            <h3>Unlock Muscle Recovery</h3>
            <p>Connect Hevy to view anatomical recovery &amp; strain heatmaps.</p>
            {hevy.oauthAvailable ? (
              <a className="unlock-btn" href="/api/integrations/hevy/connect">
                Connect Hevy to Unlock
              </a>
            ) : (
              <button type="button" className="unlock-btn" onClick={() => onOpenSettings()}>
                Configure Hevy in Settings
              </button>
            )}
          </div>
        )}
      </div>

      {/* Daily Strain Breakdown (Tap any activity → Full-Page Workout Detail) */}
      <section className="card" aria-label="Daily Strain Breakdown" style={{ display: "grid", gap: ".2rem" }}>
        <div className="split-row" style={{ marginBottom: ".25rem" }}>
          <h2 style={{ fontSize: "1rem", margin: 0 }}>Today&apos;s Activities</h2>
          <span className="pill">{strain.activities.length}</span>
        </div>

        {loading ? (
          <p className="empty">Loading activities…</p>
        ) : strain.activities.length === 0 ? (
          <p className="empty" style={{ padding: ".5rem 0" }}>
            No workouts or steps recorded for {formattedDate}.
          </p>
        ) : (
          strain.activities.map((act: StrainActivityBreakdown) => (
            <button
              key={act.id}
              type="button"
              className="compact-row-btn"
              onClick={() => setPage({ kind: "activity", id: act.id })}
            >
              <div>
                <div className="meal-title-row">
                  <span className={`pill ${act.kind === "strength" ? "protein-soft" : act.kind === "cardio" ? "teal-soft" : "accent-soft"}`}>
                    {act.kind === "strength" ? <FlameBurnIcon size={12} /> : act.kind === "cardio" ? <FitbitPulseIcon size={12} /> : <FootstepsIcon size={12} />}
                    {act.source}
                  </span>
                  <strong>{act.title}</strong>
                </div>
                <div className="meal-meta" style={{ marginTop: ".2rem" }}>
                  {act.durationSeconds != null && <span>{fmtDur(act.durationSeconds)}</span>}
                  {act.avgHrBpm != null && <span className="num">Avg {act.avgHrBpm} bpm</span>}
                  {pulseInsights?.workoutHrrById[act.id]?.after1Minute != null && (
                    <span className="pill teal-soft num" style={{ fontSize: ".68rem", minHeight: "20px", padding: ".05rem .45rem" }}>
                      HRR 1m −{pulseInsights.workoutHrrById[act.id].after1Minute} bpm
                    </span>
                  )}
                  {act.mRaw > 0 && <span className="num">Muscular {act.mRaw}</span>}
                  {act.walkingDetail?.eligibleSteps != null && (
                    <span className="num">{act.walkingDetail.eligibleSteps.toLocaleString("en-GB")} steps</span>
                  )}
                </div>
              </div>
              <div style={{ display: "inline-flex", alignItems: "center", gap: ".35rem" }}>
                <strong className="num">+{act.overallPointsContribution.toFixed(1)}</strong>
                <ChevronRight size={16} style={{ color: "var(--muted)" }} />
              </div>
            </button>
          ))
        )}
      </section>

      {/* Auto Habit Impact on Next-Day Recovery */}
      {pulseInsights && pulseInsights.behaviorImpacts.length > 0 && (
        <section className="card" style={{ display: "grid", gap: ".45rem" }} aria-label="Habit Impact on Recovery">
          <div className="split-row">
            <span className="eyebrow">Auto Habit Impact on Recovery</span>
            <span className="pill">45d trend</span>
          </div>
          <div style={{ display: "grid", gap: ".35rem" }}>
            {pulseInsights.behaviorImpacts.map((b) => (
              <div key={b.key} className="split-row" style={{ fontSize: ".8rem" }}>
                <span>
                  <strong>{b.label}</strong>{" "}
                  <span style={{ color: "var(--muted)" }}>({b.withCount}d vs {b.withoutCount}d)</span>
                </span>
                <span className={`pill num ${b.deltaRecovery >= 0 ? "teal-soft" : "danger-soft"}`}>
                  {b.deltaRecovery >= 0 ? `+${b.deltaRecovery}` : b.deltaRecovery}%
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Quiet Hevy Sync Footer */}
      {hevy.connected && (
        <section className="bevel-awaiting-strip" aria-label="Hevy Strength Sync">
          <span>
            <strong>Hevy</strong>
            {hevy.accountLabel ? ` · ${hevy.accountLabel}` : ""} · {hevy.workoutCount} workouts
            {hevy.lastSync ? ` · ${fmtRelativeSync(hevy.lastSync)}` : ""}
          </span>
          <button
            type="button"
            className="secondary compact"
            style={{ minHeight: "30px", padding: ".2rem .6rem", fontSize: ".74rem" }}
            disabled={busy}
            onClick={() => void onSyncHevy()}
          >
            <RefreshCw size={12} /> Sync
          </button>
        </section>
      )}
    </>
  );
}
