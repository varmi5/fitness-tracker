"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { SOURCE_METRICS, type SourceMetric, type SourceRule, type SourceSettings } from "../lib/data-source-settings";
import { DEFAULT_ENERGY_PRIORITY, DEFAULT_RECOVERY_PRIORITY, DEFAULT_WORKOUT_PRIORITY, formatSourceLabel, rankSources } from "../lib/source-priority";
import type { DailyNutritionView } from "../lib/nutrition-data";
import type { NutritionSettings, PulseInsightsView } from "./types";

const metrics = Object.entries(SOURCE_METRICS) as [SourceMetric, string][];
const automatic: SourceRule = { priority: [], hidden: [] };

function defaults(metric: SourceMetric) {
  if (metric === "workouts") return ["hevy", ...DEFAULT_WORKOUT_PRIORITY];
  if (metric === "weight") return ["manual", ...DEFAULT_ENERGY_PRIORITY];
  if (metric === "energy" || metric === "steps") return DEFAULT_ENERGY_PRIORITY;
  return DEFAULT_RECOVERY_PRIORITY;
}

export function DataSourcesView({ settings, day, pulse, connected, busy, onSave, onBack }: {
  settings: NutritionSettings;
  day?: DailyNutritionView;
  pulse?: PulseInsightsView | null;
  connected: string[];
  busy: boolean;
  onSave: (settings: SourceSettings) => Promise<boolean>;
  onBack: () => void;
}) {
  const [rules, setRules] = useState<SourceSettings>(settings.sourceSettings ?? {});
  const [opened, setOpened] = useState<SourceMetric | null>(null);
  const [saving, setSaving] = useState(false);
  const used: Partial<Record<SourceMetric, string[]>> = {};
  for (const [field, value] of Object.entries(day?.recovery?.metricSources ?? {})) used[field as SourceMetric] = [value];
  if (day?.sleep) used.sleep = [day.sleep.source];
  if (day?.energy?.totalKcal != null) used.energy = [day.energy.source];
  if (day?.stepSource) used.steps = [day.stepSource];
  if (day?.workouts.length) used.workouts = [...new Set(day.workouts.map((row) => row.source))];
  if (pulse?.heartRateSources?.length) used.heartRate = pulse.heartRateSources;

  function update(metric: SourceMetric, next: SourceRule) {
    setRules((current) => ({ ...current, [metric]: next }));
  }

  return (
    <section className="card data-sources-page" aria-label="Data Sources">
      <p className="metric-provenance">Choose which sources contribute to each metric. Move a source up to prefer it when readings overlap. Hidden sources stay in your import history.</p>
      {metrics.map(([metric, label]) => {
        const legacy = metric === "workouts" || metric === "heartRate" ? settings.primaryWorkoutSource
          : metric === "weight" ? undefined : settings.primaryRecoverySource;
        const rule = rules[metric] ?? { ...automatic, priority: legacy && legacy !== "auto" ? [legacy] : [] };
        const current = used[metric] ?? [];
        const available = new Set([...connected, ...Object.keys(day?.energySources ?? {}), ...current, ...rule.priority, ...rule.hidden, "manual"]);
        if (metric !== "workouts") available.delete("hevy");
        const order = rankSources(rule.priority.length ? { ...rule, hidden: [] } : null, defaults(metric));
        const sources = [...order.filter((source) => available.has(source)), ...[...available].filter((source) => !order.includes(source))];
        const isOpen = opened === metric;
        function move(index: number, delta: number) {
          const priority = [...sources];
          [priority[index], priority[index + delta]] = [priority[index + delta], priority[index]];
          update(metric, { ...rule, priority });
        }
        return (
          <div key={metric} className="data-source-metric">
            <button type="button" className="compact-row-btn" onClick={() => setOpened(isOpen ? null : metric)} aria-expanded={isOpen}>
              <strong>{label}</strong>
              <small>{current.length ? current.map(formatSourceLabel).join(", ") : rule.priority.length ? "Custom priority" : "Auto"}</small>
            </button>
            {isOpen && (
              <div className="data-source-controls">
                <div className="split-row">
                  <span className="metric-provenance">{rule.priority.length ? "Custom priority" : "Automatic priority"}</span>
                  <button type="button" className="secondary compact" onClick={() => update(metric, { ...rule, priority: [] })}>Use Auto</button>
                </div>
                {sources.map((source, index) => (
                  <div key={source} className="data-source-option">
                    <label className="check-row">
                      <input type="checkbox" aria-label={`Use ${formatSourceLabel(source)} for ${label}`} checked={!rule.hidden.includes(source)}
                        onChange={(event) => update(metric, { ...rule, hidden: event.target.checked ? rule.hidden.filter((item) => item !== source) : [...rule.hidden, source] })} />
                      {formatSourceLabel(source)}
                    </label>
                    <button type="button" className="secondary icon-btn" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${formatSourceLabel(source)} up`}><ArrowUp size={15} /></button>
                    <button type="button" className="secondary icon-btn" disabled={index === sources.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${formatSourceLabel(source)} down`}><ArrowDown size={15} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="data-source-save">
        <button type="button" disabled={busy || saving} onClick={async () => {
          setSaving(true);
          try {
            if (await onSave(rules)) onBack();
          } finally {
            setSaving(false);
          }
        }}>{saving ? "Saving…" : "Save data source settings"}</button>
      </div>
    </section>
  );
}
