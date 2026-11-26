"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { PulseInsightsView } from "./types";

function coveredTime(minutes: number | null | undefined) {
  if (minutes == null) return "—";
  if (minutes > 0 && minutes < 1) return "<1 min";
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const remaining = rounded % 60;
  return hours ? `${hours}h ${remaining}m` : `${remaining} min`;
}

function percent(value: number | null) {
  return value == null ? "—" : `${value}%`;
}

export function EnergyCard({ pulse }: { pulse: PulseInsightsView }) {
  const [openMetric, setOpenMetric] = useState<string | null>(null);
  const sectionId = useId();
  const { energyBank, stress, sleep, recovery } = pulse;
  const hasIndex = stress.avgStress != null;
  const metrics = [
    {
      label: "Energy",
      value: percent(energyBank.currentPct),
      rows: [
        ["Starting estimate", percent(energyBank.peakPct)],
        ["Recovery input", percent(recovery.score)],
        ["Sleep input", percent(sleep.score)],
        ["Estimated energy used", energyBank.currentPct == null ? "—" : `${energyBank.drainedPct} pts`],
        ["Waking HR coverage", coveredTime(energyBank.observedMinutes)],
      ],
      note: "Energy starts from your recovery and sleep estimates. Recorded waking activity draws it down during the day.",
    },
    {
      label: "HR Index",
      value: hasIndex ? `${stress.avgStress!.toFixed(2)} / 3` : "—",
      rows: [
        ["Resting HR reference", stress.restingHrBpm != null ? `${stress.restingHrBpm} bpm` : "—"],
        ["Average HR used", stress.observedAvgHrBpm != null ? `${stress.observedAvgHrBpm} bpm` : "—"],
        ["HR coverage", coveredTime(stress.observedMinutes)],
        ["Time at low / moderate / high index", hasIndex ? `${stress.lowMinutes} / ${stress.mediumMinutes} / ${stress.highMinutes} min` : "—"],
      ],
      note: "The index compares recorded waking heart rate with your resting reference and excludes workouts. An average of 1.80 or more is elevated on this scale.",
    },
    {
      label: "Sleep Debt",
      value: sleep.sleepDebtHours != null ? `${sleep.sleepDebtHours}h` : "—",
      rows: [
        ["Nights with sleep data", `${sleep.observedDays} of 7`],
        ["Coverage", sleep.debtCoverage],
        ["Sleep goal on this date", `${sleep.sleepNeedHours}h`],
        ["Naps on this date", coveredTime(sleep.napMinutes)],
      ],
      note: "This compares logged sleep, including naps, with the goals for the recorded nights in the past week.",
    },
  ];
  const selected = metrics.find((metric) => metric.label === openMetric);

  return (
    <section className="card energy-summary" aria-labelledby={`${sectionId}-title`}>
      <div className="split-row">
        <h3 className="eyebrow" id={`${sectionId}-title`}>Energy &amp; Autonomic Load</h3>
        <span className={`pill ${stress.band === "high" || stress.band === "moderate" ? "amber-soft" : "teal-soft"}`}>
          {hasIndex ? `${stress.band === "high" ? "Elevated" : stress.band === "moderate" ? "Moderate" : "Low"} HR index` : "No HR index"}
        </span>
      </div>
      <div className="compact-telemetry-grid">
        {metrics.map((metric) => (
          <button
            type="button"
            className="health-vital-cell energy-metric-button"
            key={metric.label}
            aria-expanded={openMetric === metric.label}
            aria-controls={`${sectionId}-details`}
            onClick={() => setOpenMetric(openMetric === metric.label ? null : metric.label)}
          >
            <span className="health-vital-label">{metric.label}</span>
            <span className="health-vital-val num">{metric.value}</span>
            <ChevronDown size={12} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div hidden={!selected} id={`${sectionId}-details`} className="metric-detail">
        {selected && (
          <>
            <p className="metric-provenance">{selected.note}</p>
            <dl>
              {selected.rows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd className="num">{value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </section>
  );
}
