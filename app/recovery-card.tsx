"use client";

import type { RecoveryInsightView } from "./types";

function fmtSleep(minutes: number | null): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function RecoveryCard({ recovery }: { recovery?: RecoveryInsightView }) {
  if (!recovery) return null;

  const bandLabel =
    recovery.band === "optimal"
      ? "Optimal"
      : recovery.band === "moderate"
        ? "Moderate"
        : recovery.band === "strained"
          ? "Strained"
          : "Unavailable";

  const bandClass =
    recovery.band === "optimal"
      ? "teal-soft"
      : recovery.band === "moderate"
        ? "amber-soft"
        : recovery.band === "strained"
          ? "red-soft"
          : "";

  const completenessLabel =
    recovery.completeness === "complete"
      ? `Complete · ${recovery.confidence} confidence`
      : recovery.completeness === "partial"
        ? `Partial · ${recovery.confidence} confidence`
        : "No wearable vitals";

  return (
    <section className="card" aria-label="Recovery Insights">
      <div className="split-row">
        <div>
          <span className="eyebrow">Recovery Insights</span>
          <h2 style={{ marginTop: ".15rem" }}>
            {recovery.score != null ? (
              <>
                <span className="num">{recovery.score}</span>{" "}
                <span className="muted" style={{ fontSize: ".9rem", fontWeight: 500 }}>
                  / 100
                </span>
              </>
            ) : (
              <span className="muted">Unavailable</span>
            )}
          </h2>
        </div>
        <div style={{ display: "flex", gap: ".4rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span className={`pill ${bandClass}`}>{bandLabel}</span>
          <span className="pill">{completenessLabel}</span>
        </div>
      </div>

      <div
        className="muted"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: ".6rem",
          marginTop: ".65rem",
          fontSize: ".82rem",
        }}
      >
        <div>
          <div>Sleep</div>
          <strong className="num" style={{ color: "var(--text)" }}>
            {fmtSleep(recovery.metrics.sleepMinutes)}
          </strong>
        </div>
        <div>
          <div>Resting HR</div>
          <strong className="num" style={{ color: "var(--text)" }}>
            {recovery.metrics.restingHrBpm != null
              ? `${Math.round(recovery.metrics.restingHrBpm)} bpm`
              : "—"}
          </strong>
          {recovery.metrics.restingHrDeltaBpm != null && (
            <span style={{ marginLeft: ".25rem", fontSize: ".75rem" }}>
              ({recovery.metrics.restingHrDeltaBpm > 0 ? "+" : ""}
              {recovery.metrics.restingHrDeltaBpm})
            </span>
          )}
        </div>
        <div>
          <div>HRV</div>
          <strong className="num" style={{ color: "var(--text)" }}>
            {recovery.metrics.hrvRmssdMs != null
              ? `${Math.round(recovery.metrics.hrvRmssdMs)} ms`
              : "—"}
          </strong>
          {recovery.metrics.hrvDeltaMs != null && (
            <span style={{ marginLeft: ".25rem", fontSize: ".75rem" }}>
              ({recovery.metrics.hrvDeltaMs > 0 ? "+" : ""}
              {recovery.metrics.hrvDeltaMs})
            </span>
          )}
        </div>
      </div>

      <p className="muted" style={{ fontSize: ".8rem", marginTop: ".65rem", marginBottom: 0 }}>
        {recovery.summary}
      </p>
      <p className="muted" style={{ fontSize: ".72rem", marginTop: ".35rem", marginBottom: 0 }}>
        {recovery.disclaimer}
      </p>
    </section>
  );
}
