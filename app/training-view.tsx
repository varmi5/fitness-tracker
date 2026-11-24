"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RefreshCw, SlidersHorizontal, Upload } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BevelScoreRing } from "../components/bevel-widgets";
import { FitbitPulseIcon, FlameBurnIcon, FootstepsIcon } from "../components/icons";
import { MuscleFreshnessMap } from "../components/muscle-map-svg";
import type { StrainActivityBreakdown } from "../lib/strain-data";
import { computeTargetStrain } from "../lib/strain-engine";
import type { LoadStatusAssessment, TrainingLoadSummary } from "../lib/training-load";
import { addDays } from "../lib/nutrition-model";
import { RecoveryCard } from "./recovery-card";
import {
  fmtRelativeSync,
  type DailyStrainView,
  type GoogleIntegrationStatus,
  type HevyIntegrationStatus,
  type MoreSection,
  type RecoveryInsightView,
  type StrainSettings,
  type ThemeMode,
} from "./types";

interface TrainingViewProps {
  today: string;
  selectedDay: string;
  strain: DailyStrainView;
  recoveryInsights?: RecoveryInsightView;
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
  onOpenSettings: (section?: MoreSection) => void;
}

function fmtDur(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "—";
  const mins = Math.round(seconds / 60);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function statusPillClass(tone: LoadStatusAssessment["tone"]): string {
  if (tone === "teal") return "teal-soft";
  if (tone === "blue") return "protein-soft";
  if (tone === "amber") return "amber-soft";
  if (tone === "danger") return "danger-soft";
  return "";
}

export function TrainingView({
  today,
  selectedDay,
  strain,
  recoveryInsights,
  strainSettings,
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loads, setLoads] = useState<TrainingLoadSummary | null>(null);
  const [loadsBusy, setLoadsBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoadsBusy(true);
    const from = addDays(selectedDay, -27);
    fetch(`/api/strain?mode=loads&from=${from}&to=${selectedDay}`, {
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
  const target = computeTargetStrain(recoveryInsights?.score);
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

      {/* Recovery Insights (sleek, click-to-expand, gated if Google Health disconnected) */}
      <div className="unlock-gate">
        <div className={`unlock-gate-content ${google && !google.connected ? "is-locked" : ""}`}>
          <RecoveryCard recovery={recoveryInsights} />
        </div>
        {google && !google.connected && (
          <div className="unlock-overlay">
            <h3>Unlock Recovery Insights</h3>
            <p>Connect Google Health to unlock Sleep, Resting HR, and HRV readiness.</p>
            {google.available ? (
              <a className="unlock-btn" href="/api/integrations/google/connect">
                Connect Google Health
              </a>
            ) : (
              <button type="button" className="unlock-btn" onClick={() => onOpenSettings("Settings")}>
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
            size={112}
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

      {/* Daily Strain Breakdown (Click any item to expand details) */}
      <section className="card" aria-label="Daily Strain Breakdown" style={{ display: "grid", gap: ".5rem" }}>
        <div className="split-row">
          <h2 style={{ fontSize: "1rem", margin: 0 }}>Daily Breakdown</h2>
          <span className="pill">{strain.activities.length} item(s)</span>
        </div>

        {loading ? (
          <p className="empty">Loading daily strain…</p>
        ) : strain.activities.length === 0 ? (
          <p className="empty" style={{ padding: ".6rem 0" }}>
            No workouts or steps recorded for {formattedDate}.
          </p>
        ) : (
          strain.activities.map((act: StrainActivityBreakdown) => {
            const isOpen = expandedId === act.id;
            const groupedExercises = new Map<string, NonNullable<StrainActivityBreakdown["sets"]>>();
            for (const s of act.sets ?? []) {
              const list = groupedExercises.get(s.exerciseTitle) ?? [];
              list.push(s);
              groupedExercises.set(s.exerciseTitle, list);
            }

            return (
              <article className="meal-card" key={act.id} style={{ padding: ".7rem .85rem" }}>
                <button
                  type="button"
                  className="list-item"
                  style={{ borderTop: 0, padding: 0 }}
                  aria-expanded={isOpen}
                  onClick={() => setExpandedId(isOpen ? null : act.id)}
                >
                  <div>
                    <div className="meal-title-row">
                      <span className={`pill ${act.kind === "strength" ? "protein-soft" : act.kind === "cardio" ? "teal-soft" : "accent-soft"}`}>
                        {act.kind === "strength" ? <FlameBurnIcon size={12} /> : act.kind === "cardio" ? <FitbitPulseIcon size={12} /> : <FootstepsIcon size={12} />}
                        {act.source}
                      </span>
                      <strong>{act.title}</strong>
                    </div>
                    <div className="meal-meta" style={{ marginTop: ".25rem" }}>
                      {act.durationSeconds != null && <span>{fmtDur(act.durationSeconds)}</span>}
                      {act.avgHrBpm != null && <span className="num">Avg {act.avgHrBpm} bpm</span>}
                      {act.mRaw > 0 && <span className="num">Muscular {act.mRaw}</span>}
                      {act.cRaw > 0 && <span className="num">Cardio TRIMP {act.cRaw}</span>}
                      {act.walkingDetail?.eligibleSteps != null && (
                        <span className="num">
                          {act.walkingDetail.eligibleSteps.toLocaleString("en-GB")} steps
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="meal-kcal" style={{ display: "flex", alignItems: "center", gap: ".35rem" }}>
                    <div>
                      <strong className="num">+{act.overallPointsContribution.toFixed(1)}</strong>
                      <small>pts</small>
                    </div>
                    {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  </div>
                </button>

                {isOpen && (
                  <div className="meal-items-box" style={{ display: "grid", gap: ".55rem", marginTop: ".6rem" }}>
                    {act.notes.map((n, idx) => (
                      <p key={idx} style={{ fontSize: ".76rem", color: "var(--muted)", margin: 0 }}>{n}</p>
                    ))}

                    {act.walkingDetail && (
                      <div className="energy-strip" style={{ marginTop: 0 }}>
                        <div className="energy-cell">
                          <span>Eligible</span>
                          <strong className="num">{act.walkingDetail.eligibleSteps?.toLocaleString("en-GB") ?? "—"}</strong>
                        </div>
                        <div className="energy-cell">
                          <span>Threshold</span>
                          <strong className="num">{act.walkingDetail.threshold.toLocaleString("en-GB")}</strong>
                        </div>
                        <div className="energy-cell">
                          <span>Excess</span>
                          <strong className="num">{act.walkingDetail.excessSteps.toLocaleString("en-GB")}</strong>
                        </div>
                      </div>
                    )}

                    {act.hrSeries && act.hrSeries.length > 1 && (
                      <div className="chart" style={{ height: 140 }}>
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
                    )}

                    {groupedExercises.size > 0 && (
                      <div style={{ display: "grid", gap: ".4rem" }}>
                        {[...groupedExercises.entries()].map(([exTitle, sets]) => (
                          <div key={exTitle} style={{ borderTop: "1px solid var(--border)", paddingTop: ".35rem" }}>
                            <strong style={{ fontSize: ".84rem" }}>{exTitle}</strong>
                            <div style={{ display: "grid", gap: ".18rem", marginTop: ".2rem", fontSize: ".76rem", color: "var(--muted)" }}>
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
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })
        )}
      </section>

      {/* Bevel-Style Muscle Recovery & Freshness Dropdown */}
      <div className="unlock-gate">
        <details className={`card settings-accordion unlock-gate-content ${!hevy.connected ? "is-locked" : ""}`}>
          <summary className="settings-accordion-summary">
            <div className="settings-accordion-title">
              <h2>Muscle Recovery Map</h2>
              <p>
                {fatiguedCount > 0
                  ? `${fatiguedCount} fatigued · ${recoveringCount} recovering`
                  : recoveringCount > 0
                    ? `${recoveringCount} muscle group(s) recovering`
                    : "All muscle groups fresh & ready"}
              </p>
            </div>
            <div className="settings-accordion-right">
              <span className={`pill ${fatiguedCount > 0 ? "danger-soft" : recoveringCount > 0 ? "amber-soft" : "teal-soft"}`}>
                {fatiguedCount > 0 ? "Fatigued" : recoveringCount > 0 ? "Recovering" : "Fresh"}
              </span>
              <ChevronDown size={17} className="settings-accordion-chevron" />
            </div>
          </summary>
          <div className="settings-accordion-body">
            {loads?.muscleFreshness?.length ? (
              <MuscleFreshnessMap entries={loads.muscleFreshness} />
            ) : (
              <p className="empty">Sync Hevy workouts to view your anatomical muscle recovery map.</p>
            )}
          </div>
        </details>
        {!hevy.connected && (
          <div className="unlock-overlay">
            <h3>Unlock Muscle Recovery</h3>
            <p>Connect Hevy to map strain and recovery freshness across every muscle group.</p>
            {hevy.oauthAvailable ? (
              <a className="unlock-btn" href="/api/integrations/hevy/connect">
                Connect Hevy to Unlock
              </a>
            ) : (
              <button type="button" className="unlock-btn" onClick={() => onOpenSettings("Settings")}>
                Configure Hevy in Settings
              </button>
            )}
          </div>
        )}
      </div>

      {/* Long-Term Cardio Load & Muscular Load (Collapsible Dropdowns to minimize scrolling) */}
      <section className="two-col" aria-label="Long-term training loads">
        <div className="unlock-gate">
          <details className={`card settings-accordion unlock-gate-content ${google && !google.connected ? "is-locked" : ""}`}>
            <summary className="settings-accordion-summary">
              <div className="settings-accordion-title">
                <h2>Cardio Load</h2>
                <p>
                  {loads?.latestCardio
                    ? `7d ${loads.latestCardio.acute7d} · 42d ${loads.latestCardio.chronic42d}`
                    : "7d Acute vs 42d Chronic"}
                </p>
              </div>
              <div className="settings-accordion-right">
                {loads?.cardioStatus ? (
                  <span className={`pill ${statusPillClass(loads.cardioStatus.tone)}`}>
                    {loads.cardioStatus.label}
                  </span>
                ) : (
                  <span className="pill teal-soft">7d / 42d</span>
                )}
                <ChevronDown size={17} className="settings-accordion-chevron" />
              </div>
            </summary>
            <div className="settings-accordion-body">
              {loadsBusy && !loads ? (
                <p className="empty">Loading Cardio Load…</p>
              ) : !loads?.latestCardio ? (
                <p className="empty">No cardio TRIMP history yet.</p>
              ) : (
                <>
                  {loads.cardioStatus && (
                    <p style={{ fontSize: ".76rem", color: "var(--muted)", margin: 0 }}>
                      {loads.cardioStatus.guidance}
                    </p>
                  )}
                  <div className="energy-strip" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 0 }}>
                    <div className="energy-cell">
                      <span>Daily</span>
                      <strong className="num">{loads.latestCardio.daily}</strong>
                    </div>
                    <div className="energy-cell">
                      <span>7d Acute</span>
                      <strong className="num">{loads.latestCardio.acute7d}</strong>
                    </div>
                    <div className="energy-cell">
                      <span>42d Chronic</span>
                      <strong className="num">{loads.latestCardio.chronic42d}</strong>
                    </div>
                  </div>
                  {loads.cardioSeries.length > 1 && (
                    <div className="chart" style={{ height: 145 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={loads.cardioSeries.slice(-28)}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} width={30} />
                          <Tooltip />
                          <Area type="monotone" dataKey="optimalMax" name="Optimal Ceiling" stroke="none" fill="var(--teal-soft)" fillOpacity={0.35} />
                          <Line type="monotone" dataKey="acute7d" name="7d Acute" stroke="var(--blue)" dot={false} strokeWidth={2} />
                          <Line type="monotone" dataKey="chronic42d" name="42d Chronic" stroke="var(--teal)" dot={false} strokeWidth={2} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </>
              )}
            </div>
          </details>
          {google && !google.connected && (
            <div className="unlock-overlay">
              <h3>Unlock Cardio Load</h3>
              <p>Connect Google Health to track 7d &amp; 42d heart-rate load.</p>
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
          <details className={`card settings-accordion unlock-gate-content ${!hevy.connected ? "is-locked" : ""}`}>
            <summary className="settings-accordion-summary">
              <div className="settings-accordion-title">
                <h2>Muscular Load</h2>
                <p>
                  {loads?.latestMuscular
                    ? `7d ${loads.latestMuscular.acute7d} · 42d ${loads.latestMuscular.chronic42d}`
                    : "7d Acute vs 42d Chronic"}
                </p>
              </div>
              <div className="settings-accordion-right">
                {loads?.muscularStatus ? (
                  <span className={`pill ${statusPillClass(loads.muscularStatus.tone)}`}>
                    {loads.muscularStatus.label}
                  </span>
                ) : (
                  <span className="pill protein-soft">7d / 42d</span>
                )}
                <ChevronDown size={17} className="settings-accordion-chevron" />
              </div>
            </summary>
            <div className="settings-accordion-body">
              {loadsBusy && !loads ? (
                <p className="empty">Loading Muscular Load…</p>
              ) : !loads?.latestMuscular ? (
                <p className="empty">No muscular training history yet.</p>
              ) : (
                <>
                  {loads.muscularStatus && (
                    <p style={{ fontSize: ".76rem", color: "var(--muted)", margin: 0 }}>
                      {loads.muscularStatus.guidance}
                    </p>
                  )}
                  <div className="energy-strip" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 0 }}>
                    <div className="energy-cell">
                      <span>Daily</span>
                      <strong className="num">{loads.latestMuscular.daily}</strong>
                    </div>
                    <div className="energy-cell">
                      <span>7d Acute</span>
                      <strong className="num">{loads.latestMuscular.acute7d}</strong>
                    </div>
                    <div className="energy-cell">
                      <span>42d Chronic</span>
                      <strong className="num">{loads.latestMuscular.chronic42d}</strong>
                    </div>
                  </div>
                  {loads.muscularSeries.length > 1 && (
                    <div className="chart" style={{ height: 145 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={loads.muscularSeries.slice(-28)}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                          <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 10 }} />
                          <YAxis tick={{ fontSize: 10 }} width={30} />
                          <Tooltip />
                          <Area type="monotone" dataKey="optimalMax" name="Optimal Ceiling" stroke="none" fill="var(--purple-soft, rgba(139,92,246,0.14))" fillOpacity={0.35} />
                          <Line type="monotone" dataKey="acute7d" name="7d Acute" stroke="var(--purple)" dot={false} strokeWidth={2} />
                          <Line type="monotone" dataKey="chronic42d" name="42d Chronic" stroke="var(--accent)" dot={false} strokeWidth={2} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </>
              )}
            </div>
          </details>
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

      {/* Quiet Hevy Sync Footer (only sync button when connected) */}
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
