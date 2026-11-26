"use client";

import type { ReactNode } from "react";

export interface BevelScoreRingProps {
  label: string;
  value: number | null;
  displayText?: string;
  pct: number;
  color: string;
  trackColor?: string;
  targetRange?: [number, number] | null;
  size?: number;
  strokeWidth?: number;
  sublabel?: string;
  onClick?: () => void;
  expanded?: boolean;
  controls?: string;
}

export function BevelScoreRing({
  label,
  value,
  displayText,
  pct,
  color,
  trackColor = "var(--ring-track)",
  targetRange,
  size = 96,
  strokeWidth = 8.5,
  sublabel,
  onClick,
  expanded,
  controls,
}: BevelScoreRingProps) {
  const clampedPct = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ * (1 - clampedPct / 100);

  // Optional inner target-zone arc (e.g., Strain target range 55-75%)
  const innerR = r - strokeWidth * 0.92;
  const innerCirc = 2 * Math.PI * innerR;
  const hasTarget = targetRange != null && targetRange[1] > targetRange[0];
  const targetStart = hasTarget ? Math.max(0, Math.min(100, targetRange[0])) : 0;
  const targetSpan = hasTarget ? Math.max(2, Math.min(100 - targetStart, targetRange[1] - targetStart)) : 0;
  const targetArcLen = (targetSpan / 100) * innerCirc;
  const targetRotate = -90 + (targetStart / 100) * 360;

  const content = (
    <div className="bevel-ring-item">
      <div className="bevel-ring-svg-wrap" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={trackColor}
            strokeWidth={strokeWidth}
          />
          {hasTarget && innerR > 12 && (
            <>
              <circle
                cx={cx}
                cy={cy}
                r={innerR}
                fill="none"
                stroke={trackColor}
                strokeWidth={3}
                strokeOpacity={0.55}
              />
              <circle
                cx={cx}
                cy={cy}
                r={innerR}
                fill="none"
                stroke={color}
                strokeWidth={3}
                strokeOpacity={0.55}
                strokeLinecap="round"
                strokeDasharray={`${targetArcLen} ${innerCirc}`}
                transform={`rotate(${targetRotate} ${cx} ${cy})`}
              />
            </>
          )}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={value == null ? circ : dashOffset}
            transform={`rotate(-90 ${cx} ${cy})`}
            className="bevel-ring-progress"
          />
        </svg>
        <div className="bevel-ring-center">
          <strong className="num" style={{ color: value == null ? "var(--muted)" : "var(--text)" }}>
            {displayText ?? (value == null ? "—" : Math.round(value))}
          </strong>
        </div>
      </div>
      <span className="bevel-ring-label">{label}</span>
      {sublabel && <span className="bevel-ring-sub">{sublabel}</span>}
    </div>
  );

  if (onClick) {
    return (
      <button type="button" className="bevel-ring-btn" onClick={onClick} aria-label={`${label}: ${displayText ?? value ?? "no data"}`} aria-expanded={expanded} aria-controls={controls}>
        {content}
      </button>
    );
  }
  return content;
}

export interface MacroBarItem {
  label: string;
  valueText: string;
  pct: number;
  color: string;
  targetText?: string;
}

export interface CalorieSliderProps {
  title?: string;
  consumedText: string;
  targetText: string;
  statusText: string;
  fillPct: number;
  isOnTarget: boolean | null;
  isBulkMode: boolean;
  macros: MacroBarItem[];
  headerRight?: ReactNode;
  onClick?: () => void;
}

export function CalorieSlider({
  title = "Calorie Intake",
  consumedText,
  targetText,
  statusText,
  fillPct,
  isOnTarget,
  isBulkMode,
  macros,
  headerRight,
  onClick,
}: CalorieSliderProps) {
  // Position target tick at 85% of the track so slight overages (up to ~118%) visibly pass the tick
  const visualPct = Math.max(0, Math.min(100, Math.round((fillPct / 118) * 100)));
  const tickPct = Math.round((100 / 118) * 100);
  const barColor =
    isOnTarget === null
      ? "var(--accent)"
      : isOnTarget
        ? "var(--status-good)"
        : "var(--status-bad)";

  const body = (
    <div className="calorie-slider-inner">
      <div className="split-row" style={{ alignItems: "center" }}>
        <span className="eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: ".4rem" }}>
          {title}
          {isBulkMode && <span className="pill accent-soft" style={{ fontSize: ".66rem", padding: ".1rem .45rem" }}>Bulk</span>}
        </span>
        {headerRight ?? (
          <span
            className="num"
            style={{
              fontSize: ".82rem",
              fontWeight: 650,
              color: isOnTarget === null ? "var(--muted)" : isOnTarget ? "var(--status-good)" : "var(--status-bad)",
            }}
          >
            {statusText}
          </span>
        )}
      </div>

      <div className="calorie-slider-figures">
        <strong className="num">{consumedText}</strong>
        <span className="num">/ {targetText}</span>
      </div>

      <div className="calorie-slider-track" role="progressbar" aria-valuenow={Math.round(fillPct)} aria-valuemin={0} aria-valuemax={100}>
        <div
          className="calorie-slider-fill"
          style={{ width: `${visualPct}%`, background: barColor }}
        />
        <span
          className="calorie-slider-tick"
          style={{ left: `${tickPct}%` }}
          title={`Target: ${targetText}`}
        />
      </div>

      <div className="macro-bars-grid">
        {macros.map((m) => (
          <div className="macro-bar-cell" key={m.label}>
            <div className="macro-bar-track">
              <div
                className="macro-bar-fill"
                style={{ width: `${Math.max(0, Math.min(100, m.pct))}%`, background: m.color }}
              />
            </div>
            <div className="macro-bar-labels">
              <span>{m.label}</span>
              <strong className="num">{m.valueText}</strong>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  if (onClick) {
    return (
      <button type="button" className="card card-interactive calorie-slider-card" onClick={onClick}>
        {body}
      </button>
    );
  }
  return <section className="card calorie-slider-card">{body}</section>;
}

export interface EnergyBalanceScaleProps {
  title?: string;
  avgDeficitKcal: number | null; // positive = deficit (burn > intake), negative = surplus (intake > burn)
  isBulkMode: boolean;
  pairedDays: number;
  totalDays: number;
  onClick?: () => void;
}

export function evaluateEnergyBalance(avgDeficitKcal: number | null, isBulkMode: boolean): {
  label: string;
  tone: "teal" | "amber" | "blue" | "danger" | "neutral";
  summary: string;
} {
  if (avgDeficitKcal == null) {
    return {
      label: "Pending",
      tone: "neutral",
      summary: "Log meals & sync expenditure to track your balance.",
    };
  }
  void isBulkMode;
  if (avgDeficitKcal > 0) return {
    label: "Estimated deficit", tone: "neutral",
    summary: `Recorded intake is ~${Math.round(avgDeficitKcal)} kcal/d below estimated expenditure on comparable days.`,
  };
  if (avgDeficitKcal < 0) return {
    label: "Estimated surplus", tone: "neutral",
    summary: `Recorded intake is ~${Math.round(Math.abs(avgDeficitKcal))} kcal/d above estimated expenditure on comparable days.`,
  };
  return { label: "Estimated balance", tone: "neutral", summary: "Recorded intake and estimated expenditure match on comparable days; measurement uncertainty still applies." };
}

export function EnergyBalanceScale({
  title = "7-Day Energy Balance",
  avgDeficitKcal,
  isBulkMode,
  pairedDays,
  totalDays,
  onClick,
}: EnergyBalanceScaleProps) {
  const verdict = evaluateEnergyBalance(avgDeficitKcal, isBulkMode);
  const pillClass =
    verdict.tone === "teal"
      ? "teal-soft"
      : verdict.tone === "amber"
        ? "amber-soft"
        : verdict.tone === "blue"
          ? "protein-soft"
          : verdict.tone === "danger"
            ? "danger-soft"
            : "";

  // Scale spans from -1000 (left = Deficit) to +1000 (right = Surplus)
  // Note: avgDeficitKcal > 0 means deficit (left of center), < 0 means surplus (right of center)
  const netPositionKcal = avgDeficitKcal == null ? 0 : -avgDeficitKcal; // negative = left (deficit), positive = right (surplus)
  const clampedKcal = Math.max(-1000, Math.min(1000, netPositionKcal));
  const pinPct = Math.round(((clampedKcal + 1000) / 2000) * 100);

  const pinColor =
    verdict.tone === "teal"
      ? "var(--status-good)"
      : verdict.tone === "amber"
        ? "var(--amber)"
        : verdict.tone === "danger"
          ? "var(--status-bad)"
          : "var(--text)";

  const inner = (
    <div style={{ display: "grid", gap: ".55rem", width: "100%" }}>
      <div className="split-row" style={{ alignItems: "center" }}>
        <span className="eyebrow">{title}</span>
        <span className={`pill ${pillClass}`}>{verdict.label}</span>
      </div>

      {/* Visual Balance Scale */}
      <div className="balance-scale-wrap">
        <div className="balance-scale-track">
          {/* Center maintenance tick */}
          <span className="balance-scale-center" />
          {/* Current position pin */}
          {avgDeficitKcal != null && (
            <span
              className="balance-scale-pin"
              style={{ left: `${pinPct}%`, background: pinColor }}
            />
          )}
        </div>
        <div className="split-row" style={{ fontSize: ".7rem", color: "var(--muted)", marginTop: ".3rem" }}>
          <span>Deficit</span>
          <span>Maintenance</span>
          <span>Surplus</span>
        </div>
      </div>

      <div className="split-row" style={{ fontSize: ".76rem", color: "var(--muted)", alignItems: "center" }}>
        <span>{verdict.summary}</span>
        {onClick && (
          <span style={{ fontWeight: 600, color: "var(--text)", flexShrink: 0, marginLeft: ".5rem" }}>
            {pairedDays}/{totalDays}d →
          </span>
        )}
      </div>
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className="card card-interactive calorie-slider-card"
        onClick={onClick}
        aria-label={`${title}: ${verdict.label}`}
      >
        {inner}
      </button>
    );
  }
  return <section className="card">{inner}</section>;
}

