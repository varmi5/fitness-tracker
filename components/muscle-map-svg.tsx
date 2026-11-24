"use client";

import { useState } from "react";
import type { MuscleGroup } from "../lib/muscle-map";
import type { MuscleFreshnessEntry } from "../lib/training-load";

function recoveryColor(entry?: MuscleFreshnessEntry): string {
  if (!entry || (entry.weeklyWorkingSets === 0 && entry.recentLoad === 0)) {
    return "var(--muscle-idle)";
  }
  if (entry.status === "fresh") return "var(--muscle-fresh)";
  if (entry.status === "recovering") return "var(--muscle-recovering)";
  return "var(--muscle-fatigued)";
}

function statusLabel(entry: MuscleFreshnessEntry): string {
  if (entry.weeklyWorkingSets === 0 && entry.recentLoad === 0) return "Ready";
  if (entry.status === "fresh") return "Recovered";
  if (entry.status === "recovering") return "Recovering";
  return "Fatigued";
}

function statusBadgeClass(entry: MuscleFreshnessEntry): string {
  if (entry.weeklyWorkingSets === 0 && entry.recentLoad === 0) return "";
  if (entry.status === "fresh") return "teal-soft";
  if (entry.status === "recovering") return "amber-soft";
  return "danger-soft";
}

export function MuscleFreshnessMap({ entries }: { entries: MuscleFreshnessEntry[] }) {
  const byMuscle = new Map(entries.map((e) => [e.muscle, e]));
  const mostWorked =
    [...entries].sort((a, b) => a.freshnessPct - b.freshnessPct || b.recentLoad - a.recentLoad)[0]?.muscle ?? "Chest";
  const [selected, setSelected] = useState<MuscleGroup>(mostWorked);
  const active = byMuscle.get(selected);

  const fillFor = (m: MuscleGroup) => recoveryColor(byMuscle.get(m));
  const strokeFor = (m: MuscleGroup) => (selected === m ? "var(--text)" : "transparent");

  return (
    <div className="muscle-map-wrap">
      {/* Clean Recovery Legend */}
      <div className="split-row" style={{ fontSize: ".74rem", color: "var(--muted)", paddingInline: ".25rem" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: ".32rem" }}>
          <span className="muscle-chip-dot" style={{ background: "var(--muscle-fatigued)" }} /> Fatigued
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: ".32rem" }}>
          <span className="muscle-chip-dot" style={{ background: "var(--muscle-recovering)" }} /> Recovering
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: ".32rem" }}>
          <span className="muscle-chip-dot" style={{ background: "var(--muscle-fresh)" }} /> Ready (80%+)
        </span>
      </div>

      <div className="muscle-map-figures" role="group" aria-label="Anatomical muscle recovery map">
        {/* Front silhouette */}
        <figure className="muscle-figure">
          <svg viewBox="0 0 120 232" className="muscle-svg" aria-label="Front muscle groups">
            <circle cx="60" cy="20" r="12" fill="var(--muscle-body)" />
            <rect x="53" y="32" width="14" height="9" rx="4" fill="var(--muscle-body)" />
            <path d="M33 44 C33 39 87 39 87 44 L83 119 L37 119 Z" fill="var(--muscle-body)" />
            <rect x="19" y="50" width="12" height="58" rx="6" fill="var(--muscle-body)" />
            <rect x="89" y="50" width="12" height="58" rx="6" fill="var(--muscle-body)" />
            <rect x="38" y="119" width="19" height="98" rx="9" fill="var(--muscle-body)" />
            <rect x="63" y="119" width="19" height="98" rx="9" fill="var(--muscle-body)" />

            {/* Shoulders */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Shoulders")}
              role="button"
              tabIndex={0}
              aria-label={`Shoulders ${byMuscle.get("Shoulders")?.freshnessPct ?? 100}% recovered`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Shoulders")}
            >
              <ellipse cx="29" cy="52" rx="9" ry="11" fill={fillFor("Shoulders")} stroke={strokeFor("Shoulders")} strokeWidth="2" />
              <ellipse cx="91" cy="52" rx="9" ry="11" fill={fillFor("Shoulders")} stroke={strokeFor("Shoulders")} strokeWidth="2" />
            </g>

            {/* Chest */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Chest")}
              role="button"
              tabIndex={0}
              aria-label={`Chest ${byMuscle.get("Chest")?.freshnessPct ?? 100}% recovered`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Chest")}
            >
              <path d="M39 48 C39 45 58 45 58 49 L58 66 C58 68 41 68 39 63 Z" fill={fillFor("Chest")} stroke={strokeFor("Chest")} strokeWidth="2" />
              <path d="M81 48 C81 45 62 45 62 49 L62 66 C62 68 79 68 81 63 Z" fill={fillFor("Chest")} stroke={strokeFor("Chest")} strokeWidth="2" />
            </g>

            {/* Biceps */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Biceps")}
              role="button"
              tabIndex={0}
              aria-label={`Biceps ${byMuscle.get("Biceps")?.freshnessPct ?? 100}% recovered`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Biceps")}
            >
              <rect x="20" y="65" width="10" height="24" rx="5" fill={fillFor("Biceps")} stroke={strokeFor("Biceps")} strokeWidth="2" />
              <rect x="90" y="65" width="10" height="24" rx="5" fill={fillFor("Biceps")} stroke={strokeFor("Biceps")} strokeWidth="2" />
            </g>

            {/* Core */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Core")}
              role="button"
              tabIndex={0}
              aria-label={`Core ${byMuscle.get("Core")?.freshnessPct ?? 100}% recovered`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Core")}
            >
              <rect x="46" y="71" width="28" height="40" rx="8" fill={fillFor("Core")} stroke={strokeFor("Core")} strokeWidth="2" />
            </g>

            {/* Quads */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Quads")}
              role="button"
              tabIndex={0}
              aria-label={`Quads ${byMuscle.get("Quads")?.freshnessPct ?? 100}% recovered`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Quads")}
            >
              <rect x="39" y="123" width="17" height="45" rx="8" fill={fillFor("Quads")} stroke={strokeFor("Quads")} strokeWidth="2" />
              <rect x="64" y="123" width="17" height="45" rx="8" fill={fillFor("Quads")} stroke={strokeFor("Quads")} strokeWidth="2" />
            </g>
          </svg>
          <figcaption>Front</figcaption>
        </figure>

        {/* Back silhouette */}
        <figure className="muscle-figure">
          <svg viewBox="0 0 120 232" className="muscle-svg" aria-label="Back muscle groups">
            <circle cx="60" cy="20" r="12" fill="var(--muscle-body)" />
            <rect x="53" y="32" width="14" height="9" rx="4" fill="var(--muscle-body)" />
            <path d="M33 44 C33 39 87 39 87 44 L83 119 L37 119 Z" fill="var(--muscle-body)" />
            <rect x="19" y="50" width="12" height="58" rx="6" fill="var(--muscle-body)" />
            <rect x="89" y="50" width="12" height="58" rx="6" fill="var(--muscle-body)" />
            <rect x="38" y="119" width="19" height="98" rx="9" fill="var(--muscle-body)" />
            <rect x="63" y="119" width="19" height="98" rx="9" fill="var(--muscle-body)" />

            {/* Back */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Back")}
              role="button"
              tabIndex={0}
              aria-label={`Back ${byMuscle.get("Back")?.freshnessPct ?? 100}% recovered`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Back")}
            >
              <path d="M37 45 L83 45 L77 99 L43 99 Z" fill={fillFor("Back")} stroke={strokeFor("Back")} strokeWidth="2" />
            </g>

            {/* Triceps */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Triceps")}
              role="button"
              tabIndex={0}
              aria-label={`Triceps ${byMuscle.get("Triceps")?.freshnessPct ?? 100}% recovered`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Triceps")}
            >
              <rect x="20" y="64" width="10" height="25" rx="5" fill={fillFor("Triceps")} stroke={strokeFor("Triceps")} strokeWidth="2" />
              <rect x="90" y="64" width="10" height="25" rx="5" fill={fillFor("Triceps")} stroke={strokeFor("Triceps")} strokeWidth="2" />
            </g>

            {/* Glutes */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Glutes")}
              role="button"
              tabIndex={0}
              aria-label={`Glutes ${byMuscle.get("Glutes")?.freshnessPct ?? 100}% recovered`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Glutes")}
            >
              <rect x="39" y="103" width="19" height="22" rx="9" fill={fillFor("Glutes")} stroke={strokeFor("Glutes")} strokeWidth="2" />
              <rect x="62" y="103" width="19" height="22" rx="9" fill={fillFor("Glutes")} stroke={strokeFor("Glutes")} strokeWidth="2" />
            </g>

            {/* Hamstrings */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Hamstrings")}
              role="button"
              tabIndex={0}
              aria-label={`Hamstrings ${byMuscle.get("Hamstrings")?.freshnessPct ?? 100}% recovered`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Hamstrings")}
            >
              <rect x="40" y="129" width="16" height="38" rx="7" fill={fillFor("Hamstrings")} stroke={strokeFor("Hamstrings")} strokeWidth="2" />
              <rect x="64" y="129" width="16" height="38" rx="7" fill={fillFor("Hamstrings")} stroke={strokeFor("Hamstrings")} strokeWidth="2" />
            </g>

            {/* Calves */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Calves")}
              role="button"
              tabIndex={0}
              aria-label={`Calves ${byMuscle.get("Calves")?.freshnessPct ?? 100}% recovered`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Calves")}
            >
              <rect x="41" y="173" width="14" height="34" rx="7" fill={fillFor("Calves")} stroke={strokeFor("Calves")} strokeWidth="2" />
              <rect x="65" y="173" width="14" height="34" rx="7" fill={fillFor("Calves")} stroke={strokeFor("Calves")} strokeWidth="2" />
            </g>
          </svg>
          <figcaption>Back</figcaption>
        </figure>
      </div>

      {/* Selected muscle focus bar */}
      {active && (
        <div className="muscle-detail-bar">
          <div className="split-row">
            <div style={{ display: "flex", alignItems: "center", gap: ".45rem" }}>
              <strong>{active.muscle}</strong>
              <span className={`pill ${statusBadgeClass(active)}`}>{statusLabel(active)}</span>
            </div>
            <strong className="num" style={{ fontSize: "1.05rem" }}>
              {active.freshnessPct}% recovered
            </strong>
          </div>
          <div className="muscle-bar-track">
            <div
              className="muscle-bar-fill"
              style={{
                width: `${active.freshnessPct}%`,
                background: fillFor(active.muscle),
              }}
            />
          </div>
          <div className="split-row" style={{ fontSize: ".75rem", color: "var(--muted)" }}>
            <span>
              {active.daysSinceTrained == null
                ? "Ready — not trained in last 7d"
                : active.daysSinceTrained === 0
                  ? "Trained today"
                  : active.daysSinceTrained === 1
                    ? "Trained yesterday"
                    : `Trained ${active.daysSinceTrained}d ago`}
            </span>
            <span className="num">{active.weeklyWorkingSets} sets (7d)</span>
          </div>
        </div>
      )}

      {/* Compact clickable list of all 10 muscles */}
      <div className="muscle-chip-grid">
        {entries.map((entry) => (
          <button
            key={entry.muscle}
            type="button"
            className={`muscle-chip ${selected === entry.muscle ? "is-selected" : ""}`}
            onClick={() => setSelected(entry.muscle)}
          >
            <span className="muscle-chip-dot" style={{ background: fillFor(entry.muscle) }} />
            <span className="muscle-chip-name">{entry.muscle}</span>
            <span className="num muscle-chip-pct">{entry.freshnessPct}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}
