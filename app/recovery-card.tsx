"use client";

import { RefreshCw } from "lucide-react";
import { recoveryAvailabilityLabel, type RecoveryInsightView } from "./types";

function fmtSleep(minutes: number | null): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function RecoveryCard({
  recovery,
  onSync,
  syncing,
}: {
  recovery?: RecoveryInsightView;
  onSync?: () => void;
  syncing?: boolean;
}) {
  if (!recovery) return null;

  const isPending = recovery.score == null;

  if (isPending) {
    return (
      <section className="bevel-awaiting-strip" aria-label="Recovery Insights">
        <div>
          <strong>Recovery</strong> · {recovery.summary || recoveryAvailabilityLabel(null)}
        </div>
        {onSync && (
          <button
            type="button"
            className="secondary compact"
            style={{ minHeight: "30px", padding: ".2rem .55rem", fontSize: ".74rem" }}
            disabled={syncing}
            onClick={onSync}
            aria-label="Sync vitals now"
          >
            <RefreshCw size={12} /> Sync
          </button>
        )}
      </section>
    );
  }

  const bandLabel =
    recovery.band === "optimal"
      ? "Higher readiness"
      : recovery.band === "moderate"
        ? "Moderate"
        : recovery.band === "strained"
          ? "Strained"
          : "Pending";

  const bandClass =
    recovery.band === "optimal"
      ? "teal-soft"
      : recovery.band === "moderate"
        ? "amber-soft"
        : recovery.band === "strained"
          ? "danger-soft"
          : "";

  return (
    <section aria-label="Recovery Insights">
      <details className="card settings-accordion">
        <summary className="settings-accordion-summary">
        <div className="settings-accordion-title">
          <span className="eyebrow">Readiness estimate</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: ".45rem" }}>
            <strong className="num" style={{ fontSize: "1.25rem", letterSpacing: "-0.02em" }}>
              {recovery.score != null ? `${recovery.score}%` : "—"}
            </strong>
            <span style={{ fontSize: ".78rem", color: "var(--muted)", fontWeight: 450 }}>
              {fmtSleep(recovery.metrics.sleepMinutes)} sleep
              {recovery.metrics.restingHrBpm != null
                ? ` · ${Math.round(recovery.metrics.restingHrBpm)} bpm RHR`
                : ""}
            </span>
          </div>
        </div>
        <div className="settings-accordion-right">
          <span className={`pill ${bandClass}`}>{bandLabel}</span>
        </div>
      </summary>
      <div className="settings-accordion-body">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: ".6rem",
            fontSize: ".82rem",
          }}
        >
          <div>
            <div className="muted">Sleep</div>
            <strong className="num">{fmtSleep(recovery.metrics.sleepMinutes)}</strong>
          </div>
          <div>
            <div className="muted">Resting HR</div>
            <strong className="num">
              {recovery.metrics.restingHrBpm != null
                ? `${Math.round(recovery.metrics.restingHrBpm)} bpm`
                : "—"}
            </strong>
            {recovery.metrics.restingHrDeltaBpm != null && (
              <span className="muted" style={{ marginLeft: ".25rem", fontSize: ".74rem" }}>
                ({recovery.metrics.restingHrDeltaBpm > 0 ? "+" : ""}
                {recovery.metrics.restingHrDeltaBpm})
              </span>
            )}
          </div>
          <div>
            <div className="muted">HRV</div>
            <strong className="num">
              {recovery.metrics.hrvRmssdMs != null
                ? `${Math.round(recovery.metrics.hrvRmssdMs)} ms`
                : "—"}
            </strong>
            {recovery.metrics.hrvDeltaMs != null && (
              <span className="muted" style={{ marginLeft: ".25rem", fontSize: ".74rem" }}>
                ({recovery.metrics.hrvDeltaMs > 0 ? "+" : ""}
                {recovery.metrics.hrvDeltaMs})
              </span>
            )}
          </div>
        </div>
        <p className="muted" style={{ fontSize: ".78rem", margin: 0 }}>
          {recovery.summary} {recovery.disclaimer}
        </p>
      </div>
      </details>
    </section>
  );
}
