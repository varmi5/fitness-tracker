"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Lightbulb } from "lucide-react";
import { MUSCLE_GROUPS, type MuscleGroup } from "../lib/muscle-map";
import type { MuscleFreshnessEntry } from "../lib/training-load";

const BACK_ONLY_MUSCLES = new Set<MuscleGroup>(["Back", "Triceps", "Glutes", "Hamstrings", "Calves"]);

function recoveryColor(entry?: MuscleFreshnessEntry): string {
  if (!entry || (entry.weeklyWorkingSets === 0 && entry.recentLoad === 0)) {
    return "var(--muscle-fresh)";
  }
  if (entry.status === "fresh") return "var(--muscle-fresh)";
  if (entry.status === "recovering") return "var(--muscle-recovering)";
  return "var(--muscle-fatigued)";
}

function fillOpacityFor(entry?: MuscleFreshnessEntry): number {
  if (!entry || (entry.weeklyWorkingSets === 0 && entry.recentLoad === 0)) return 0.72;
  return 0.9;
}

function statusLabel(entry: MuscleFreshnessEntry): string {
  if (entry.weeklyWorkingSets === 0 && entry.recentLoad === 0) return "Ready";
  if (entry.status === "fresh") return "Recovered";
  if (entry.status === "recovering") return "Recovering";
  return "Fatigued";
}

function statusBadgeClass(entry: MuscleFreshnessEntry): string {
  if (entry.weeklyWorkingSets === 0 && entry.recentLoad === 0) return "teal-soft";
  if (entry.status === "fresh") return "teal-soft";
  if (entry.status === "recovering") return "amber-soft";
  return "danger-soft";
}

function buildPacingSummary(entries: MuscleFreshnessEntry[]): string {
  const fatigued = entries.filter((e) => e.status === "fatigued");
  const recovering = entries.filter((e) => e.status === "recovering");
  const freshTrainedOrReady = entries.filter((e) => e.status === "fresh");

  if (fatigued.length === 0 && recovering.length === 0) {
    return "All major muscle groups are fresh and ready for peak strength or power work.";
  }

  const parts: string[] = [];
  if (fatigued.length > 0) {
    const names = fatigued.slice(0, 3).map((m) => m.muscle).join(", ");
    parts.push(`${names} ${fatigued.length === 1 ? "is" : "are"} carrying high fatigue — allow 24–48h before heavy loading.`);
  } else if (recovering.length > 0) {
    const names = recovering.slice(0, 3).map((m) => m.muscle).join(", ");
    parts.push(`${names} ${recovering.length === 1 ? "is" : "are"} still recovering (~12–24h to peak readiness).`);
  }

  if (freshTrainedOrReady.length > 0) {
    const freshNames = freshTrainedOrReady
      .sort((a, b) => b.freshnessPct - a.freshnessPct)
      .slice(0, 3)
      .map((m) => m.muscle)
      .join(", ");
    parts.push(`Fresh capacity: ${freshNames}.`);
  }

  return parts.join(" ");
}

interface MuscleFreshnessMapProps {
  entries: MuscleFreshnessEntry[];
  compact?: boolean;
  onExpandAll?: () => void;
}

export function MuscleFreshnessMap({ entries, compact = false, onExpandAll }: MuscleFreshnessMapProps) {
  const normalizedEntries = useMemo<MuscleFreshnessEntry[]>(() => {
    const map = new Map(entries.map((e) => [e.muscle, e]));
    return MUSCLE_GROUPS.map(
      (muscle) =>
        map.get(muscle) ?? {
          muscle,
          freshnessPct: 100,
          status: "fresh",
          daysSinceTrained: null,
          lastTrainedDay: null,
          weeklyWorkingSets: 0,
          recentLoad: 0,
        },
    );
  }, [entries]);

  const byMuscle = useMemo(
    () => new Map(normalizedEntries.map((e) => [e.muscle, e])),
    [normalizedEntries],
  );

  const mostWorked = useMemo(() => {
    return (
      [...normalizedEntries].sort(
        (a, b) => a.freshnessPct - b.freshnessPct || b.recentLoad - a.recentLoad,
      )[0]?.muscle ?? "Chest"
    );
  }, [normalizedEntries]);

  const [selected, setSelected] = useState<MuscleGroup>(mostWorked);
  const [viewSide, setViewSide] = useState<"front" | "back">(() =>
    BACK_ONLY_MUSCLES.has(mostWorked) ? "back" : "front",
  );

  const active = byMuscle.get(selected) ?? normalizedEntries[0];
  const pacingNote = useMemo(() => buildPacingSummary(normalizedEntries), [normalizedEntries]);

  const selectMuscle = (muscle: MuscleGroup, preferredSide?: "front" | "back") => {
    setSelected(muscle);
    if (preferredSide) setViewSide(preferredSide);
    else if (BACK_ONLY_MUSCLES.has(muscle)) setViewSide("back");
    else setViewSide("front");
  };

  const fillFor = (m: MuscleGroup) => recoveryColor(byMuscle.get(m));
  const opacityFor = (m: MuscleGroup) => fillOpacityFor(byMuscle.get(m));
  const strokeFor = (m: MuscleGroup) => (selected === m ? "var(--text)" : "rgba(255,255,255,0.45)");
  const strokeWidthFor = (m: MuscleGroup) => (selected === m ? 1.8 : 0.7);

  const interactiveProps = (m: MuscleGroup, side: "front" | "back") => ({
    className: `muscle-zone ${selected === m ? "is-selected" : ""}`,
    onClick: () => selectMuscle(m, side),
    onKeyDown: (e: React.KeyboardEvent<SVGGElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectMuscle(m, side);
      }
    },
    role: "button" as const,
    tabIndex: 0,
    "aria-label": `${m} ${byMuscle.get(m)?.freshnessPct ?? 100}% recovered`,
  });

  return (
    <div className="muscle-map-wrap">
      {/* Header row with Front/Back Silk segmented pill */}
      <div className="split-row" style={{ alignItems: "center" }}>
        <div className="muscle-view-toggle" role="tablist" aria-label="Anatomical view side">
          <button
            type="button"
            role="tab"
            aria-selected={viewSide === "front"}
            className={`muscle-toggle-btn ${viewSide === "front" ? "is-active" : ""}`}
            onClick={() => setViewSide("front")}
          >
            Front
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewSide === "back"}
            className={`muscle-toggle-btn ${viewSide === "back" ? "is-active" : ""}`}
            onClick={() => setViewSide("back")}
          >
            Back
          </button>
        </div>

        {onExpandAll && (
          <button
            type="button"
            className="silk-chip-btn"
            onClick={onExpandAll}
            aria-label="Open full muscle breakdown"
          >
            All muscles <ChevronRight size={13} />
          </button>
        )}
      </div>

      {/* Inset Silk Anatomical Stage + Stacked 3-State Legend */}
      <div className="muscle-stage">
        <div className="muscle-stage-figure">
          {viewSide === "front" ? (
            <svg viewBox="0 0 160 226" className="muscle-svg" aria-label="Front anatomical muscle map">
              {/* Neutral head, neck, forearms, hands, shins/feet silhouette */}
              <ellipse cx="80" cy="21" rx="12" ry="14" fill="var(--muscle-body)" />
              <path d="M72 34 L88 34 L91 45 L69 45 Z" fill="var(--muscle-body)" />
              {/* Neutral forearms + hands */}
              <path
                d="M32 98 C28 108 26 122 25 134 C24 139 28 142 32 138 C35 127 38 112 41 100 Z"
                fill="var(--muscle-body)"
              />
              <path
                d="M128 98 C132 108 134 122 135 134 C136 139 132 142 128 138 C125 127 122 112 119 100 Z"
                fill="var(--muscle-body)"
              />
              {/* Neutral hips + knees + shins + ankles */}
              <path
                d="M58 116 L102 116 L106 126 C92 130 85 130 80 128 C75 130 68 130 54 126 Z"
                fill="var(--muscle-body)"
              />
              <path
                d="M57 173 C64 172 70 173 73 177 C75 190 73 206 69 216 C64 218 59 216 58 206 C56 194 55 182 57 173 Z"
                fill="var(--muscle-body)"
              />
              <path
                d="M103 173 C96 172 90 173 87 177 C85 190 87 206 91 216 C96 218 101 216 102 206 C104 194 105 182 103 173 Z"
                fill="var(--muscle-body)"
              />

              {/* Shoulders (Deltoids) */}
              <g {...interactiveProps("Shoulders", "front")}>
                <path
                  d="M41 48 C48 44 55 46 56 54 C54 64 46 70 38 67 C34 61 36 52 41 48 Z"
                  fill={fillFor("Shoulders")}
                  fillOpacity={opacityFor("Shoulders")}
                  stroke={strokeFor("Shoulders")}
                  strokeWidth={strokeWidthFor("Shoulders")}
                />
                <path
                  d="M119 48 C112 44 105 46 104 54 C106 64 114 70 122 67 C126 61 124 52 119 48 Z"
                  fill={fillFor("Shoulders")}
                  fillOpacity={opacityFor("Shoulders")}
                  stroke={strokeFor("Shoulders")}
                  strokeWidth={strokeWidthFor("Shoulders")}
                />
              </g>

              {/* Chest (Pectorals - split left/right anatomical contours) */}
              <g {...interactiveProps("Chest", "front")}>
                <path
                  d="M57 49 C66 47 75 51 78 57 L78 73 C68 77 56 73 53 63 C52 57 54 51 57 49 Z"
                  fill={fillFor("Chest")}
                  fillOpacity={opacityFor("Chest")}
                  stroke={strokeFor("Chest")}
                  strokeWidth={strokeWidthFor("Chest")}
                />
                <path
                  d="M103 49 C94 47 85 51 82 57 L82 73 C92 77 104 73 107 63 C108 57 106 51 103 49 Z"
                  fill={fillFor("Chest")}
                  fillOpacity={opacityFor("Chest")}
                  stroke={strokeFor("Chest")}
                  strokeWidth={strokeWidthFor("Chest")}
                />
              </g>

              {/* Biceps */}
              <g {...interactiveProps("Biceps", "front")}>
                <path
                  d="M36 69 C43 69 47 76 46 86 C45 92 42 97 36 97 C32 94 31 81 36 69 Z"
                  fill={fillFor("Biceps")}
                  fillOpacity={opacityFor("Biceps")}
                  stroke={strokeFor("Biceps")}
                  strokeWidth={strokeWidthFor("Biceps")}
                />
                <path
                  d="M124 69 C117 69 113 76 114 86 C115 92 118 97 124 97 C128 94 129 81 124 69 Z"
                  fill={fillFor("Biceps")}
                  fillOpacity={opacityFor("Biceps")}
                  stroke={strokeFor("Biceps")}
                  strokeWidth={strokeWidthFor("Biceps")}
                />
              </g>

              {/* Core (Rectus Abdominis & Obliques) */}
              <g {...interactiveProps("Core", "front")}>
                <path
                  d="M61 77 C68 79 75 79 80 78 C85 79 92 79 99 77 C101 90 100 104 97 115 C88 120 72 120 63 115 C60 104 59 90 61 77 Z"
                  fill={fillFor("Core")}
                  fillOpacity={opacityFor("Core")}
                  stroke={strokeFor("Core")}
                  strokeWidth={strokeWidthFor("Core")}
                />
                <path d="M80 79 L80 116 M66 89 L94 89 M67 100 L93 100" stroke="rgba(255,255,255,0.32)" strokeWidth="1" fill="none" />
              </g>

              {/* Quads */}
              <g {...interactiveProps("Quads", "front")}>
                <path
                  d="M55 127 C64 125 74 129 76 139 C77 152 75 164 71 171 C64 173 57 170 54 161 C51 148 52 135 55 127 Z"
                  fill={fillFor("Quads")}
                  fillOpacity={opacityFor("Quads")}
                  stroke={strokeFor("Quads")}
                  strokeWidth={strokeWidthFor("Quads")}
                />
                <path
                  d="M105 127 C96 125 86 129 84 139 C83 152 85 164 89 171 C96 173 103 170 106 161 C109 148 108 135 105 127 Z"
                  fill={fillFor("Quads")}
                  fillOpacity={opacityFor("Quads")}
                  stroke={strokeFor("Quads")}
                  strokeWidth={strokeWidthFor("Quads")}
                />
              </g>
            </svg>
          ) : (
            <svg viewBox="0 0 160 226" className="muscle-svg" aria-label="Back anatomical muscle map">
              {/* Neutral head, neck, forearms/hands, heels */}
              <ellipse cx="80" cy="21" rx="12" ry="14" fill="var(--muscle-body)" />
              <path d="M71 34 L89 34 L94 43 L66 43 Z" fill="var(--muscle-body)" />
              <path
                d="M32 98 C28 108 26 122 25 134 C24 139 28 142 32 138 C35 127 38 112 41 100 Z"
                fill="var(--muscle-body)"
              />
              <path
                d="M128 98 C132 108 134 122 135 134 C136 139 132 142 128 138 C125 127 122 112 119 100 Z"
                fill="var(--muscle-body)"
              />
              <path d="M61 206 L70 206 L69 218 L60 218 Z" fill="var(--muscle-body)" />
              <path d="M90 206 L99 206 L100 218 L91 218 Z" fill="var(--muscle-body)" />

              {/* Rear Shoulders */}
              <g {...interactiveProps("Shoulders", "back")}>
                <path
                  d="M40 48 C47 44 55 46 56 54 C54 63 46 69 38 66 C34 60 36 52 40 48 Z"
                  fill={fillFor("Shoulders")}
                  fillOpacity={opacityFor("Shoulders")}
                  stroke={strokeFor("Shoulders")}
                  strokeWidth={strokeWidthFor("Shoulders")}
                />
                <path
                  d="M120 48 C113 44 105 46 104 54 C106 63 114 69 122 66 C126 60 124 52 120 48 Z"
                  fill={fillFor("Shoulders")}
                  fillOpacity={opacityFor("Shoulders")}
                  stroke={strokeFor("Shoulders")}
                  strokeWidth={strokeWidthFor("Shoulders")}
                />
              </g>

              {/* Back (Traps + Lats + Erectors V-taper) */}
              <g {...interactiveProps("Back", "back")}>
                <path
                  d="M65 40 C73 43 87 43 95 40 L106 53 C106 69 98 84 93 96 L94 111 C86 113 74 113 66 111 L67 96 C62 84 54 69 54 53 Z"
                  fill={fillFor("Back")}
                  fillOpacity={opacityFor("Back")}
                  stroke={strokeFor("Back")}
                  strokeWidth={strokeWidthFor("Back")}
                />
                <path d="M80 44 L80 110" stroke="rgba(255,255,255,0.34)" strokeWidth="1" fill="none" />
              </g>

              {/* Triceps */}
              <g {...interactiveProps("Triceps", "back")}>
                <path
                  d="M36 68 C43 68 47 75 46 86 C45 92 42 97 36 97 C32 94 31 80 36 68 Z"
                  fill={fillFor("Triceps")}
                  fillOpacity={opacityFor("Triceps")}
                  stroke={strokeFor("Triceps")}
                  strokeWidth={strokeWidthFor("Triceps")}
                />
                <path
                  d="M124 68 C117 68 113 75 114 86 C115 92 118 97 124 97 C128 94 129 80 124 68 Z"
                  fill={fillFor("Triceps")}
                  fillOpacity={opacityFor("Triceps")}
                  stroke={strokeFor("Triceps")}
                  strokeWidth={strokeWidthFor("Triceps")}
                />
              </g>

              {/* Glutes */}
              <g {...interactiveProps("Glutes", "back")}>
                <path
                  d="M57 115 C67 113 76 116 78 125 L78 139 C71 144 60 142 55 133 C54 125 55 118 57 115 Z"
                  fill={fillFor("Glutes")}
                  fillOpacity={opacityFor("Glutes")}
                  stroke={strokeFor("Glutes")}
                  strokeWidth={strokeWidthFor("Glutes")}
                />
                <path
                  d="M103 115 C93 113 84 116 82 125 L82 139 C89 144 100 142 105 133 C106 125 105 118 103 115 Z"
                  fill={fillFor("Glutes")}
                  fillOpacity={opacityFor("Glutes")}
                  stroke={strokeFor("Glutes")}
                  strokeWidth={strokeWidthFor("Glutes")}
                />
              </g>

              {/* Hamstrings */}
              <g {...interactiveProps("Hamstrings", "back")}>
                <path
                  d="M56 142 C65 144 74 143 76 151 L73 171 C66 173 59 170 55 161 C54 152 54 146 56 142 Z"
                  fill={fillFor("Hamstrings")}
                  fillOpacity={opacityFor("Hamstrings")}
                  stroke={strokeFor("Hamstrings")}
                  strokeWidth={strokeWidthFor("Hamstrings")}
                />
                <path
                  d="M104 142 C95 144 86 143 84 151 L87 171 C94 173 101 170 105 161 C106 152 106 146 104 142 Z"
                  fill={fillFor("Hamstrings")}
                  fillOpacity={opacityFor("Hamstrings")}
                  stroke={strokeFor("Hamstrings")}
                  strokeWidth={strokeWidthFor("Hamstrings")}
                />
              </g>

              {/* Calves */}
              <g {...interactiveProps("Calves", "back")}>
                <path
                  d="M56 175 C64 173 71 175 73 183 C73 194 69 203 65 206 C59 204 55 194 56 175 Z"
                  fill={fillFor("Calves")}
                  fillOpacity={opacityFor("Calves")}
                  stroke={strokeFor("Calves")}
                  strokeWidth={strokeWidthFor("Calves")}
                />
                <path
                  d="M104 175 C96 173 89 175 87 183 C87 194 91 203 95 206 C101 204 105 194 104 175 Z"
                  fill={fillFor("Calves")}
                  fillOpacity={opacityFor("Calves")}
                  stroke={strokeFor("Calves")}
                  strokeWidth={strokeWidthFor("Calves")}
                />
              </g>
            </svg>
          )}
        </div>

        {/* Clean 3-State Legend */}
        <div className="muscle-legend">
          <div className="muscle-legend-item">
            <span className="muscle-chip-dot" style={{ background: "var(--muscle-fatigued)" }} />
            <div>
              <strong>Fatigued</strong>
              <span>High recent load</span>
            </div>
          </div>
          <div className="muscle-legend-item">
            <span className="muscle-chip-dot" style={{ background: "var(--muscle-recovering)" }} />
            <div>
              <strong>Recovering</strong>
              <span>Rebuilding capacity</span>
            </div>
          </div>
          <div className="muscle-legend-item">
            <span className="muscle-chip-dot" style={{ background: "var(--muscle-fresh)" }} />
            <div>
              <strong>Fresh</strong>
              <span>80%+ ready to train</span>
            </div>
          </div>
        </div>
      </div>

      {/* Selected muscle focus bar */}
      {active && (
        <div className="muscle-detail-bar">
          <div className="split-row">
            <div style={{ display: "flex", alignItems: "center", gap: ".45rem" }}>
              <strong>{active.muscle}</strong>
              <span className={`pill ${statusBadgeClass(active)}`}>{statusLabel(active)}</span>
            </div>
            <strong className="num" style={{ fontSize: "1.02rem" }}>
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

      {/* Pacing Insight Banner */}
      <div className="muscle-pacing-banner">
        <span className="muscle-pacing-icon" aria-hidden="true">
          <Lightbulb size={15} />
        </span>
        <div>
          <strong>Pacing &amp; Readiness</strong>
          <p>{pacingNote}</p>
        </div>
      </div>

      {/* Clickable list of all 10 muscles (shown in full drilldown view) */}
      {!compact && (
        <div className="muscle-chip-grid">
          {normalizedEntries.map((entry) => (
            <button
              key={entry.muscle}
              type="button"
              className={`muscle-chip ${selected === entry.muscle ? "is-selected" : ""}`}
              onClick={() => selectMuscle(entry.muscle)}
            >
              <span className="muscle-chip-dot" style={{ background: fillFor(entry.muscle) }} />
              <span className="muscle-chip-name">{entry.muscle}</span>
              <span className="num muscle-chip-pct">{entry.freshnessPct}%</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
