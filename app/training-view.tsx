"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, RefreshCw, SlidersHorizontal, Upload } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BevelSegmentedRing, FitbitPulseIcon, FlameBurnIcon, FootstepsIcon } from "../components/icons";
import type { StrainActivityBreakdown } from "../lib/strain-data";
import type { TrainingLoadSummary } from "../lib/training-load";
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
    let active = true;
    const from = addDays(today, -41);
    setLoadsBusy(true);
    void fetch(`/api/strain?loads=1&from=${from}&to=${today}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: TrainingLoadSummary | null) => {
        if (active && data) setLoads(data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoadsBusy(false);
      });
    return () => {
      active = false;
    };
  }, [today, strain.computedAt]);

  async function handleHevyFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) return;
    const text = await file.text();
    await onImportHevy(text);
    e.target.value = "";
  }

  const overall = strain.overallStrain;
  const pct = overall == null ? 0 : Math.min(100, Math.round(overall));

  const confidenceLabel =
    strain.confidence === "complete"
      ? "Complete"
      : strain.confidence === "partial"
        ? "Partial data"
        : strain.confidence === "rest"
          ? "Rest day"
          : "Incomplete";

  const formattedDate = new Date(`${selectedDay}T12:00:00Z`).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });

  return (
    <>
      <div className="page-header">
        <div className="page-header-title">
          <h1>Training &amp; Strain</h1>
          <div className="page-sub">
            <span>{formattedDate}</span>
            <span className={`pill ${strain.confidence === "complete" ? "teal-soft" : strain.confidence === "partial" ? "amber-soft" : ""}`}>
              {confidenceLabel}
            </span>
            <span className="pill">{strain.algorithmVersion}</span>
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
            <RefreshCw size={15} /> Recalc
          </button>
          <button
            type="button"
            className="secondary compact"
            onClick={() => onOpenSettings("Settings")}
            aria-label="Walking and strain settings"
          >
            <SlidersHorizontal size={15} />
          </button>
        </div>
      </div>

      {/* Date Navigation */}
      <section className="card" aria-label="Training date navigation">
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

      {/* Stage 7: Recovery Insights (separated from Strain) */}
      <div className="unlock-gate">
        <div className={`unlock-gate-content ${google && !google.connected ? "is-locked" : ""}`}>
          <RecoveryCard recovery={recoveryInsights} />
        </div>
        {google && !google.connected && (
          <div className="unlock-overlay">
            <h3>Unlock Recovery Insights</h3>
            <p>Connect Google Health (Fitbit Air) to unlock daily Sleep, Resting HR, and HRV readiness.</p>
            {google.available ? (
              <a className="unlock-btn" href="/api/integrations/google/connect">
                Connect Google Health to Unlock
              </a>
            ) : (
              <button type="button" className="unlock-btn" onClick={() => onOpenSettings("Settings")}>
                Configure Google Health in Settings
              </button>
            )}
          </div>
        )}
      </div>

      {/* Overall Strain Hero */}
      <section className="card card-hero" aria-label="Overall Strain summary">
        <div className="ring-layout">
          <div className="ring-wrap">
            <BevelSegmentedRing pct={pct} overTarget={false} />
            <div className="ring-center">
              <strong className="num">{overall == null ? "—" : overall.toFixed(1)}</strong>
              <span>of 100 Strain</span>
            </div>
          </div>

          <div className="hero-stats">
            <div className="hero-figures">
              <div className="stat-mini">
                <span>Cardio Strain</span>
                <strong className="num" style={{ color: "var(--blue)" }}>
                  {strain.cardioStrain == null ? "—" : strain.cardioStrain.toFixed(1)}
                </strong>
              </div>
              <div className="stat-mini">
                <span>Muscular Strain</span>
                <strong className="num" style={{ color: "var(--purple)" }}>
                  {strain.muscularStrain == null ? "—" : strain.muscularStrain.toFixed(1)}
                </strong>
              </div>
              <div className="stat-mini">
                <span>Walking Bonus</span>
                <strong className="num" style={{ color: "var(--teal)" }}>
                  +{strain.walkingPoints.toFixed(1)}
                </strong>
              </div>
            </div>
            <p style={{ fontSize: ".78rem", color: "var(--muted)" }}>
              Raw TRIMP: <strong className="num">{strain.cRaw}</strong> · Raw Muscular:{" "}
              <strong className="num">{strain.mRaw}</strong> · Threshold:{" "}
              <strong className="num">{strainSettings.walkingStepThreshold.toLocaleString("en-GB")}</strong> steps
            </p>
            <p style={{ fontSize: ".72rem", color: "var(--muted)" }}>
              Exertion estimate for personal tracking; not a medical measure of fatigue or injury risk.
            </p>
          </div>
        </div>
      </section>

      {/* Daily Contributing Activities */}
      <section className="card" aria-label="Daily Strain Breakdown" style={{ display: "grid", gap: ".65rem" }}>
        <div className="split-row">
          <h2>Daily Strain Breakdown</h2>
          <span className="pill">{strain.activities.length} contributor(s)</span>
        </div>

        {loading ? (
          <p className="empty">Loading daily strain…</p>
        ) : strain.activities.length === 0 ? (
          <p className="empty">
            No workouts or step data recorded for {selectedDay}. Sync Google Health or import a Hevy workout below.
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
              <article className="meal-card" key={act.id}>
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
                    <div className="meal-meta" style={{ marginTop: ".3rem" }}>
                      {act.durationSeconds != null && <span>{fmtDur(act.durationSeconds)}</span>}
                      {act.avgHrBpm != null && <span className="num">Avg {act.avgHrBpm} bpm</span>}
                      {act.cRaw > 0 && <span className="num">TRIMP {act.cRaw}</span>}
                      {act.mRaw > 0 && <span className="num">Muscular {act.mRaw}</span>}
                      {act.walkingDetail?.eligibleSteps != null && (
                        <span className="num">
                          {act.walkingDetail.eligibleSteps.toLocaleString("en-GB")} eligible steps
                        </span>
                      )}
                      <span className={`pill ${act.status === "complete" ? "teal-soft" : act.status === "partial" ? "amber-soft" : ""}`}>
                        {act.status}
                      </span>
                    </div>
                  </div>
                  <div className="meal-kcal" style={{ display: "flex", alignItems: "center", gap: ".4rem" }}>
                    <div>
                      <strong className="num">+{act.overallPointsContribution.toFixed(1)}</strong>
                      <small>Strain pts</small>
                    </div>
                    {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </button>

                {isOpen && (
                  <div className="meal-items-box" style={{ display: "grid", gap: ".6rem" }}>
                    {act.notes.map((n, idx) => (
                      <p key={idx} style={{ fontSize: ".78rem", color: "var(--muted)" }}>{n}</p>
                    ))}

                    {act.walkingDetail && (
                      <div className="energy-strip" style={{ marginTop: 0 }}>
                        <div className="energy-cell">
                          <span>Total steps</span>
                          <strong className="num">{act.walkingDetail.totalSteps?.toLocaleString("en-GB") ?? "—"}</strong>
                        </div>
                        <div className="energy-cell">
                          <span>Workout excluded</span>
                          <strong className="num">{act.walkingDetail.excludedWorkoutSteps?.toLocaleString("en-GB") ?? "—"}</strong>
                        </div>
                        <div className="energy-cell">
                          <span>Eligible steps</span>
                          <strong className="num">{act.walkingDetail.eligibleSteps?.toLocaleString("en-GB") ?? "—"}</strong>
                        </div>
                        <div className="energy-cell">
                          <span>Threshold</span>
                          <strong className="num">{act.walkingDetail.threshold.toLocaleString("en-GB")}</strong>
                        </div>
                        <div className="energy-cell">
                          <span>Excess steps</span>
                          <strong className="num">{act.walkingDetail.excessSteps.toLocaleString("en-GB")}</strong>
                        </div>
                      </div>
                    )}

                    {act.walkingDetail && (
                      <div>
                        <button type="button" className="secondary compact" onClick={() => onOpenSettings("Settings")}>
                          <SlidersHorizontal size={14} /> Walking Settings
                        </button>
                      </div>
                    )}

                    {act.hrSeries && act.hrSeries.length > 1 && (
                      <div className="chart" style={{ height: 150 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={act.hrSeries.map((p) => ({ time: p.recordedAt.slice(11, 16), bpm: p.bpm }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                            <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                            <YAxis domain={["dataMin - 10", "dataMax + 10"]} tick={{ fontSize: 11 }} width={34} />
                            <Tooltip />
                            <Area type="monotone" dataKey="bpm" stroke="var(--danger-fg)" fill="var(--danger-bg)" strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    )}

                    {act.trimpZones && act.trimpZones.some((z) => z.minutes > 0) && (
                      <div className="energy-strip" style={{ marginTop: 0 }}>
                        {act.trimpZones.map((z) => (
                          <div className="energy-cell" key={z.zone}>
                            <span>{z.label}</span>
                            <strong className="num">{z.minutes.toFixed(1)}m</strong>
                            <small className="num">{z.trimp.toFixed(1)} TRIMP</small>
                          </div>
                        ))}
                      </div>
                    )}

                    {groupedExercises.size > 0 && (
                      <div style={{ display: "grid", gap: ".45rem" }}>
                        {[...groupedExercises.entries()].map(([exTitle, sets]) => (
                          <div key={exTitle} style={{ borderTop: "1px solid var(--border)", paddingTop: ".4rem" }}>
                            <strong style={{ fontSize: ".86rem" }}>{exTitle}</strong>
                            <div style={{ display: "grid", gap: ".2rem", marginTop: ".25rem", fontSize: ".78rem", color: "var(--muted)" }}>
                              {sets.map((s, i) => (
                                <div key={i} className="split-row">
                                  <span>
                                    Set {s.setIndex + 1} · {s.setType}
                                  </span>
                                  <span className="num" style={{ color: "var(--text)" }}>
                                    {s.weightKg != null ? `${s.weightKg} kg` : "BW"} × {s.reps ?? "—"}
                                    {s.rpe != null ? ` · RPE ${s.rpe}` : " · RPE est."}
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

      {/* Long-term Cardio Load & Muscular Load (Separate EWMAs) */}
      <section className="two-col" aria-label="Long-term training loads">
        <div className="unlock-gate">
          <article className={`card unlock-gate-content ${google && !google.connected ? "is-locked" : ""}`}>
            <div className="split-row">
              <h2>Cardio Load (TRIMP EWMA)</h2>
              <span className="pill teal-soft">7d / 42d</span>
            </div>
            {loadsBusy && !loads ? (
              <p className="empty">Loading Cardio Load…</p>
            ) : !loads?.latestCardio ? (
              <p className="empty">No cardio TRIMP history yet.</p>
            ) : (
              <>
                <div className="energy-strip" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
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
                  <div className="chart" style={{ height: 150, marginTop: ".65rem" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={loads.cardioSeries.slice(-28)}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} width={32} />
                        <Tooltip />
                        <Line type="monotone" dataKey="acute7d" name="7d Acute" stroke="var(--blue)" dot={false} strokeWidth={2} />
                        <Line type="monotone" dataKey="chronic42d" name="42d Chronic" stroke="var(--teal)" dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </>
            )}
          </article>
          {google && !google.connected && (
            <div className="unlock-overlay">
              <h3>Unlock Cardio Load</h3>
              <p>Connect Google Health (Fitbit) to track 7d &amp; 42d heart-rate TRIMP load.</p>
              {google.available ? (
                <a className="unlock-btn" href="/api/integrations/google/connect">
                  Connect Google Health
                </a>
              ) : (
                <button type="button" className="unlock-btn" onClick={() => onOpenSettings("Settings")}>
                  Open Google Settings
                </button>
              )}
            </div>
          )}
        </div>

        <div className="unlock-gate">
          <article className={`card unlock-gate-content ${!hevy.connected ? "is-locked" : ""}`}>
            <div className="split-row">
              <h2>Muscular Load (Sets EWMA)</h2>
              <span className="pill protein-soft">7d / 42d</span>
            </div>
            {loadsBusy && !loads ? (
              <p className="empty">Loading Muscular Load…</p>
            ) : !loads?.latestMuscular ? (
              <p className="empty">No muscular training history yet.</p>
            ) : (
              <>
                <div className="energy-strip" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
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
                  <div className="chart" style={{ height: 150, marginTop: ".65rem" }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={loads.muscularSeries.slice(-28)}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                        <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} width={32} />
                        <Tooltip />
                        <Line type="monotone" dataKey="acute7d" name="7d Acute" stroke="var(--purple)" dot={false} strokeWidth={2} />
                        <Line type="monotone" dataKey="chronic42d" name="42d Chronic" stroke="var(--accent)" dot={false} strokeWidth={2} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </>
            )}
          </article>
          {!hevy.connected && (
            <div className="unlock-overlay">
              <h3>Unlock Muscular Load</h3>
              <p>Connect Hevy or import a workout export to unlock 7d &amp; 42d Muscular Load.</p>
              <div className="button-row" style={{ justifyContent: "center" }}>
                {hevy.oauthAvailable ? (
                  <a className="unlock-btn" href="/api/integrations/hevy/connect">
                    Connect Hevy to Unlock
                  </a>
                ) : (
                  <button type="button" className="unlock-btn" onClick={() => onOpenSettings("Settings")}>
                    Connect Hevy in Settings
                  </button>
                )}
                <label className="secondary compact" style={{ display: "inline-flex", alignItems: "center", gap: ".4rem", cursor: "pointer" }}>
                  <Upload size={14} /> Import CSV / JSON
                  <input type="file" accept=".csv,.json,text/csv,application/json" style={{ display: "none" }} onChange={(e) => void handleHevyFile(e)} />
                </label>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Muscle-Group Weekly Working Sets & Exercise Progression */}
      {loads && (
        <div className="unlock-gate">
          <section
            className={`card unlock-gate-content ${!hevy.connected ? "is-locked" : ""}`}
            aria-label="Muscle group workload"
          >
            <div className="split-row">
              <h2>Muscle Group Weekly Sets</h2>
              <span className="pill">{loads.dataQuality.completeDays} complete days</span>
            </div>
            <div className="energy-strip">
              {loads.muscleSummaries.map((m) => (
                <div className="energy-cell" key={m.muscle}>
                  <span>{m.muscle}</span>
                  <strong className="num">{m.weeklyWorkingSets} sets</strong>
                  <small className="num">Load {m.totalLoad.toFixed(1)}</small>
                </div>
              ))}
            </div>
            {loads.exerciseProgression.length > 0 && (
              <div style={{ marginTop: ".85rem" }}>
                <h3 style={{ fontSize: ".88rem", color: "var(--muted)", marginBottom: ".35rem" }}>Exercise Progression (Est. 1RM)</h3>
                {loads.exerciseProgression.slice(0, 6).map((ex) => (
                  <div className="list-item" key={ex.exerciseTitle}>
                    <div>
                      <strong>{ex.exerciseTitle}</strong>
                      <span className="row-note">
                        {ex.sessions} session(s) · Latest {ex.latestWeightKg ?? "—"} kg × {ex.latestReps ?? "—"} ({ex.latestDay})
                      </span>
                    </div>
                    <div className="num" style={{ textAlign: "right" }}>
                      <strong>{ex.bestEstimated1RmKg != null ? `${ex.bestEstimated1RmKg} kg` : "—"}</strong>
                      {ex.deltaKg != null && (
                        <small className="row-note" style={{ color: ex.deltaKg >= 0 ? "var(--accent)" : "var(--danger-fg)" }}>
                          {ex.deltaKg >= 0 ? `+${ex.deltaKg}` : ex.deltaKg} kg
                        </small>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          {!hevy.connected && (
            <div className="unlock-overlay">
              <h3>Unlock 10-Muscle-Group Breakdown &amp; 1RM Progression</h3>
              <p>Connect your Hevy account to see weekly working sets across Chest, Back, Quads, Glutes &amp; more.</p>
              {hevy.oauthAvailable ? (
                <a className="unlock-btn" href="/api/integrations/hevy/connect">
                  Connect Hevy to Unlock
                </a>
              ) : (
                <button type="button" className="unlock-btn" onClick={() => onOpenSettings("Settings")}>
                  Open Hevy Settings
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Hevy Sync & Status bar (shown compactly once connected) */}
      {hevy.connected && (
        <section className="card" aria-label="Hevy workouts import">
          <div className="split-row">
            <div>
              <h2>Hevy Strength Sync</h2>
              <p style={{ fontSize: ".8rem" }}>
                {hevy.accountLabel ? `${hevy.accountLabel} · ` : ""}
                {hevy.workoutCount} Hevy workout(s) stored · Last sync {fmtRelativeSync(hevy.lastSync)}
              </p>
            </div>
            <div className="button-row">
              <span className="pill teal-soft">Hevy Connected</span>
              <button type="button" className="secondary compact" disabled={busy} onClick={() => void onSyncHevy()}>
                <RefreshCw size={14} /> Sync Hevy
              </button>
              <button type="button" className="secondary compact" onClick={() => onOpenSettings("Settings")}>
                <SlidersHorizontal size={14} /> Settings
              </button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
