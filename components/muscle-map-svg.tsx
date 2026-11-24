"use client";

import { useState } from "react";
import type { MuscleGroup } from "../lib/muscle-map";
import type { MuscleFreshnessEntry } from "../lib/training-load";

function freshnessColor(entry?: MuscleFreshnessEntry): string {
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
  const mostFatigued =
    [...entries].sort((a, b) => a.freshnessPct - b.freshnessPct)[0]?.muscle ?? "Chest";
  const [selected, setSelected] = useState<MuscleGroup>(mostFatigued);
  const active = byMuscle.get(selected);

  const fillFor = (m: MuscleGroup) => freshnessColor(byMuscle.get(m));
  const strokeFor = (m: MuscleGroup) => (selected === m ? "var(--text)" : "transparent");

  return (
    <div className="muscle-map-wrap">
      <div className="muscle-map-figures" role="group" aria-label="Anatomical muscle recovery map">
        {/* Front silhouette */}
        <figure className="muscle-figure">
          <svg viewBox="0 0 120 230" className="muscle-svg" aria-label="Front muscle groups">
            {/* Neutral body silhouette */}
            <circle cx="60" cy="20" r="12" fill="var(--muscle-body)" />
            <rect x="53" y="32" width="14" height="9" rx="4" fill="var(--muscle-body)" />
            <path d="M34 44 C34 40 86 40 86 44 L83 118 L37 118 Z" fill="var(--muscle-body)" />
            <rect x="20" y="50" width="12" height="58" rx="6" fill="var(--muscle-body)" />
            <rect x="88" y="50" width="12" height="58" rx="6" fill="var(--muscle-body)" />
            <rect x="38" y="118" width="19" height="96" rx="9" fill="var(--muscle-body)" />
            <rect x="63" y="118" width="19" height="96" rx="9" fill="var(--muscle-body)" />

            {/* Shoulders */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Shoulders")}
              role="button"
              tabIndex={0}
              aria-label={`Shoulders ${byMuscle.get("Shoulders")?.freshnessPct ?? 100}% fresh`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Shoulders")}
            >
              <ellipse cx="30" cy="52" rx="9" ry="11" fill={fillFor("Shoulders")} stroke={strokeFor("Shoulders")} strokeWidth="2" />
              <ellipse cx="90" cy="52" rx="9" ry="11" fill={fillFor("Shoulders")} stroke={strokeFor("Shoulders")} strokeWidth="2" />
            </g>

            {/* Chest */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Chest")}
              role="button"
              tabIndex={0}
              aria-label={`Chest ${byMuscle.get("Chest")?.freshnessPct ?? 100}% fresh`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Chest")}
            >
              <rect x="39" y="47" width="19" height="20" rx="6" fill={fillFor("Chest")} stroke={strokeFor("Chest")} strokeWidth="2" />
              <rect x="62" y="47" width="19" height="20" rx="6" fill={fillFor("Chest")} stroke={strokeFor("Chest")} strokeWidth="2" />
            </g>

            {/* Biceps */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Biceps")}
              role="button"
              tabIndex={0}
              aria-label={`Biceps ${byMuscle.get("Biceps")?.freshnessPct ?? 100}% fresh`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Biceps")}
            >
              <rect x="21" y="64" width="10" height="24" rx="5" fill={fillFor("Biceps")} stroke={strokeFor("Biceps")} strokeWidth="2" />
              <rect x="89" y="64" width="10" height="24" rx="5" fill={fillFor("Biceps")} stroke={strokeFor("Biceps")} strokeWidth="2" />
            </g>

            {/* Core */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Core")}
              role="button"
              tabIndex={0}
              aria-label={`Core ${byMuscle.get("Core")?.freshnessPct ?? 100}% fresh`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Core")}
            >
              <rect x="46" y="71" width="28" height="39" rx="7" fill={fillFor("Core")} stroke={strokeFor("Core")} strokeWidth="2" />
            </g>

            {/* Quads */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Quads")}
              role="button"
              tabIndex={0}
              aria-label={`Quads ${byMuscle.get("Quads")?.freshnessPct ?? 100}% fresh`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Quads")}
            >
              <rect x="39" y="122" width="17" height="44" rx="8" fill={fillFor("Quads")} stroke={strokeFor("Quads")} strokeWidth="2" />
              <rect x="64" y="122" width="17" height="44" rx="8" fill={fillFor("Quads")} stroke={strokeFor("Quads")} strokeWidth="2" />
            </g>
          </svg>
          <figcaption>Front</figcaption>
        </figure>

        {/* Back silhouette */}
        <figure className="muscle-figure">
          <svg viewBox="0 0 120 230" className="muscle-svg" aria-label="Back muscle groups">
            <circle cx="60" cy="20" r="12" fill="var(--muscle-body)" />
            <rect x="53" y="32" width="14" height="9" rx="4" fill="var(--muscle-body)" />
            <path d="M34 44 C34 40 86 40 86 44 L83 118 L37 118 Z" fill="var(--muscle-body)" />
            <rect x="20" y="50" width="12" height="58" rx="6" fill="var(--muscle-body)" />
            <rect x="88" y="50" width="12" height="58" rx="6" fill="var(--muscle-body)" />
            <rect x="38" y="118" width="19" height="96" rx="9" fill="var(--muscle-body)" />
            <rect x="63" y="118" width="19" height="96" rx="9" fill="var(--muscle-body)" />

            {/* Back */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Back")}
              role="button"
              tabIndex={0}
              aria-label={`Back ${byMuscle.get("Back")?.freshnessPct ?? 100}% fresh`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Back")}
            >
              <path d="M38 45 L82 45 L76 98 L44 98 Z" rx="6" fill={fillFor("Back")} stroke={strokeFor("Back")} strokeWidth="2" />
            </g>

            {/* Triceps */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Triceps")}
              role="button"
              tabIndex={0}
              aria-label={`Triceps ${byMuscle.get("Triceps")?.freshnessPct ?? 100}% fresh`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Triceps")}
            >
              <rect x="21" y="63" width="10" height="25" rx="5" fill={fillFor("Triceps")} stroke={strokeFor("Triceps")} strokeWidth="2" />
              <rect x="89" y="63" width="10" height="25" rx="5" fill={fillFor("Triceps")} stroke={strokeFor("Triceps")} strokeWidth="2" />
            </g>

            {/* Glutes */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Glutes")}
              role="button"
              tabIndex={0}
              aria-label={`Glutes ${byMuscle.get("Glutes")?.freshnessPct ?? 100}% fresh`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Glutes")}
            >
              <rect x="39" y="102" width="19" height="22" rx="9" fill={fillFor("Glutes")} stroke={strokeFor("Glutes")} strokeWidth="2" />
              <rect x="62" y="102" width="19" height="22" rx="9" fill={fillFor("Glutes")} stroke={strokeFor("Glutes")} strokeWidth="2" />
            </g>

            {/* Hamstrings */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Hamstrings")}
              role="button"
              tabIndex={0}
              aria-label={`Hamstrings ${byMuscle.get("Hamstrings")?.freshnessPct ?? 100}% fresh`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Hamstrings")}
            >
              <rect x="40" y="128" width="16" height="38" rx="7" fill={fillFor("Hamstrings")} stroke={strokeFor("Hamstrings")} strokeWidth="2" />
              <rect x="64" y="128" width="16" height="38" rx="7" fill={fillFor("Hamstrings")} stroke={strokeFor("Hamstrings")} strokeWidth="2" />
            </g>

            {/* Calves */}
            <g
              className="muscle-zone"
              onClick={() => setSelected("Calves")}
              role="button"
              tabIndex={0}
              aria-label={`Calves ${byMuscle.get("Calves")?.freshnessPct ?? 100}% fresh`}
              onKeyDown={(e) => e.key === "Enter" && setSelected("Calves")}
            >
              <rect x="41" y="172" width="14" height="34" rx="7" fill={fillFor("Calves")} stroke={strokeFor("Calves")} strokeWidth="2" />
              <rect x="65" y="172" width="14" height="34" rx="7" fill={fillFor("Calves")} stroke={strokeFor("Calves")} strokeWidth="2" />
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
              {active.freshnessPct}%
            </strong>
          </div>
          <div className="muscle-bar-track">
            <div
              className="muscle-bar-fill"
              style={{
                width: `${active.freshnessPct}%`,
                background: freshnessColor(active),
              }}
            />
          </div>
          <div className="split-row" style={{ fontSize: ".75rem", color: "var(--muted)" }}>
            <span>
              {active.daysSinceTrained == null
                ? "Not trained in last 7d"
                : active.daysSinceTrained === 0
                  ? "Trained today"
                  : active.daysSinceTrained === 1
                    ? "Trained yesterday"
                    : `Trained ${active.daysSinceTrained}d ago`}
            </span>
            <span className="num">
              {active.weeklyWorkingSets} sets · Load {active.recentLoad}
            </span>
          </div>
        </div>
      )}

      {/* Compact clickable pill list of all 10 muscles */}
      <div className="muscle-chip-grid">
        {entries.map((entry) => (
          <button
            key={entry.muscle}
            type="button"
            className={`muscle-chip ${selected === entry.muscle ? "is-selected" : ""}`}
            onClick={() => setSelected(entry.muscle)}
          >
            <span className="muscle-chip-dot" style={{ background: freshnessColor(entry) }} />
            <span className="muscle-chip-name">{entry.muscle}</span>
            <span className="num muscle-chip-pct">{entry.freshnessPct}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}
