"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { MUSCLE_GROUPS, type MuscleGroup } from "../lib/muscle-map";
import type { MuscleFreshnessEntry } from "../lib/training-load";
import { bodyBack, bodyFront, type AnatomyPart } from "./anatomy-paths";

const BACK_ONLY_MUSCLES = new Set<MuscleGroup>(["Back", "Glutes", "Hamstrings", "Calves"]);
const PART_GROUP: Partial<Record<string, MuscleGroup>> = {
  chest: "Chest", obliques: "Core", abs: "Core", biceps: "Biceps", triceps: "Triceps",
  trapezius: "Back", "upper-back": "Back", "lower-back": "Back", deltoids: "Shoulders",
  quadriceps: "Quads", hamstring: "Hamstrings", gluteal: "Glutes", calves: "Calves",
};
const pathsFor = (part: AnatomyPart) => [...(part.path.common ?? []), ...(part.path.left ?? []), ...(part.path.right ?? [])];

function observed(entry?: MuscleFreshnessEntry) {
  return entry?.lastTrainedDay != null;
}
function colorFor(entry?: MuscleFreshnessEntry) {
  if (!observed(entry)) return "var(--muscle-body)";
  return entry?.status === "tracked" ? "var(--accent)" : "var(--muscle-recovering)";
}
function labelFor(entry: MuscleFreshnessEntry) {
  if (!observed(entry)) return "No history";
  return entry.status === "tracked" ? "Personal baseline" : "Building baseline";
}
function elapsedLabel(entry: MuscleFreshnessEntry) {
  if (entry.hoursSinceTrained == null) return "No mapped session in 42 days";
  if (entry.hoursSinceTrained < 1) return "Trained less than an hour ago";
  if (entry.hoursSinceTrained < 48) return `Trained ${Math.floor(entry.hoursSinceTrained)}h ago`;
  return `Trained ${Math.floor(entry.hoursSinceTrained / 24)}d ago`;
}

interface MuscleFreshnessMapProps {
  entries: MuscleFreshnessEntry[];
  compact?: boolean;
  onExpandAll?: () => void;
}

export function MuscleFreshnessMap({ entries, compact = false, onExpandAll }: MuscleFreshnessMapProps) {
  const normalized = useMemo<MuscleFreshnessEntry[]>(() => {
    const byMuscle = new Map(entries.map((entry) => [entry.muscle, entry]));
    return MUSCLE_GROUPS.map((muscle) => byMuscle.get(muscle) ?? {
      muscle, freshnessPct: null, status: "unknown", lastTrainedDay: null,
      daysSinceTrained: null, weeklyWorkingSets: 0, recentLoad: 0,
    });
  }, [entries]);
  const mostWorked = [...normalized].sort((a, b) => b.recentLoad - a.recentLoad)[0]?.muscle ?? "Chest";
  const [selected, setSelected] = useState<MuscleGroup>(mostWorked);
  const [side, setSide] = useState<"front" | "back">(BACK_ONLY_MUSCLES.has(mostWorked) ? "back" : "front");
  const byMuscle = new Map(normalized.map((entry) => [entry.muscle, entry]));
  const active = byMuscle.get(selected)!;
  const anatomy = side === "front" ? bodyFront : bodyBack;
  const select = (muscle: MuscleGroup, switchSide = false) => {
    setSelected(muscle);
    if (switchSide) setSide(BACK_ONLY_MUSCLES.has(muscle) ? "back" : "front");
  };

  return (
    <div className="muscle-map-wrap">
      <div className="split-row" style={{ alignItems: "center" }}>
        <div className="muscle-view-toggle" role="group" aria-label="Anatomical view">
          {(["front", "back"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={side === value}
              className={`muscle-toggle-btn ${side === value ? "is-active" : ""}`} onClick={() => setSide(value)}>
              {value === "front" ? "Front" : "Back"}
            </button>
          ))}
        </div>
        {onExpandAll && <button type="button" className="silk-chip-btn" onClick={onExpandAll}>
          All muscles <ChevronRight size={13} aria-hidden="true" />
        </button>}
      </div>
      <div className="muscle-stage">
        <div className="muscle-stage-figure">
          <svg viewBox={side === "front" ? "0 70 724 1320" : "724 70 724 1320"}
            className="muscle-svg" role="group" aria-label={`${side === "front" ? "Front" : "Back"} muscle training history; select a group for details`}>
            <title>{`Muscle training history — ${side} view`}</title>
            <desc>Colours show recorded training and baseline availability. They do not show physiological recovery.</desc>
            {anatomy.filter((part) => !PART_GROUP[part.slug]).flatMap((part) => pathsFor(part).map((d, index) => (
              <path key={`${part.slug}-${index}`} d={d} fill="var(--muscle-body)" opacity={0.65} />
            )))}
            {MUSCLE_GROUPS.map((muscle) => {
              const parts = anatomy.filter((part) => PART_GROUP[part.slug] === muscle);
              if (!parts.length) return null;
              const entry = byMuscle.get(muscle)!;
              return <g key={muscle} role="button" tabIndex={0} aria-pressed={selected === muscle}
                aria-label={`${muscle}: ${labelFor(entry)}, ${entry.weeklyWorkingSets} working sets in seven days`}
                className={`muscle-zone ${selected === muscle ? "is-selected" : ""}`}
                onClick={() => select(muscle)} onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(muscle); }
                }}>
                {parts.flatMap((part) => pathsFor(part).map((d, index) => <path key={`${part.slug}-${index}`}
                  d={d} fill={colorFor(entry)} fillOpacity={selected === muscle ? 1 : 0.75}
                  stroke={selected === muscle ? "var(--text)" : "var(--surface)"}
                  strokeWidth={selected === muscle ? 1.4 : 0.6} vectorEffect="non-scaling-stroke" />))}
              </g>;
            })}
          </svg>
        </div>
        <div className="muscle-legend">
          {[
            ["var(--accent)", "Personal baseline", "3+ training days recorded"],
            ["var(--muscle-recovering)", "Building baseline", "More history needed"],
            ["var(--muscle-body)", "No history", "Recovery unknown"],
          ].map(([color, title, description]) => <div key={title} className="muscle-legend-item">
            <span className="muscle-chip-dot" style={{ background: color }} aria-hidden="true" />
            <div><strong>{title}</strong><span>{description}</span></div>
          </div>)}
        </div>
      </div>
      <div className="muscle-detail-bar" aria-live="polite" aria-atomic="true">
        <div className="split-row"><strong>{active.muscle}</strong>
          <span className="pill">{labelFor(active)}</span>
        </div>
        <div className="split-row" style={{ fontSize: ".8rem", color: "var(--muted)", gap: ".5rem", flexWrap: "wrap" }}>
          <span>{elapsedLabel(active)}</span><span className="num">{active.weeklyWorkingSets} sets (7d)</span>
        </div>
        <p className="muted" style={{ fontSize: ".75rem", margin: 0 }}>
          {active.sessionLoadRatio != null
            ? `Latest session: ${active.sessionLoadRatio.toFixed(2)}× your prior typical load for this muscle. `
            : `${active.trainingDays ?? 0} distinct training days recorded. `}
          Recovery percentage unavailable.
        </p>
      </div>
      <div className="muscle-pacing-banner">
        <span className="muscle-pacing-icon" aria-hidden="true"><Info size={15} /></span>
        <div><strong>Training history, not tissue recovery</strong>
          <p>Exercise names estimate the muscles worked. Sets and elapsed time cannot confirm readiness or repair. Use soreness, performance and how you feel alongside this history.</p>
        </div>
      </div>
      {!compact && <div className="muscle-chip-grid">
        {normalized.map((entry) => <button key={entry.muscle} type="button" aria-pressed={selected === entry.muscle}
          className={`muscle-chip ${selected === entry.muscle ? "is-selected" : ""}`} onClick={() => select(entry.muscle, true)}>
          <span className="muscle-chip-dot" style={{ background: colorFor(entry) }} aria-hidden="true" />
          <span className="muscle-chip-name">{entry.muscle}</span>
          <span className="num muscle-chip-pct">{entry.weeklyWorkingSets} sets</span>
        </button>)}
      </div>}
    </div>
  );
}
