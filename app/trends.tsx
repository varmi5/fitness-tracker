"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { displayUnit, displayValue, metrics, movingAverage, readingsFor, shiftDate, type Reading, type Units } from "../lib/metrics";

export function TrendChart({ readings, today, units, height }: { readings: Reading[]; today: string; units: Units; height: number | null }) {
  const [metricKey, setMetric] = useState<string>("waist");
  const [period, setPeriod] = useState(28);
  const metric = metrics.find((item) => item.key === metricKey)!;
  const chart = useMemo(() => movingAverage(readingsFor(readings, metric))
    .filter((row) => row.date <= today && (!period || row.date >= shiftDate(today, 1 - period)))
    .map((row) => ({ ...row, value: displayValue(row.value, metric, units), average: displayValue(row.average, metric, units) })),
  [readings, metric, period, today, units]);
  return <section className="card chart-card">
    <div className="chart-controls">
      <label>Metric<select value={metricKey} onChange={(e) => setMetric(e.target.value)}>{metrics.map((m) =>
        <option key={m.key} value={m.key}>{m.label}</option>)}</select></label>
      <div className="segments" aria-label="Date range">{[[28, "4w"], [84, "12w"], [0, "All"]].map(([value, label]) =>
        <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(Number(value))}>{label}</button>)}</div>
    </div>
    {chart.length === 0 ? <p className="empty">No {metric.label.toLowerCase()} measurements in this range.</p> :
      <>
        <div className="chart" role="img" aria-label={`${metric.label} raw data and 7-day moving average in ${displayUnit(metric, units)}`}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chart} margin={{ left: -15, right: 12, top: 20 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="date" tickFormatter={(date) => date.slice(5)} stroke="var(--muted)" tick={{ fontSize: 11 }} />
              <YAxis width={56} domain={["auto", "auto"]} stroke="var(--muted)" tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => value == null ? "" : `${Number(value).toFixed(1)} ${displayUnit(metric, units)}`}
                contentStyle={{ background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 12, color: "var(--text)" }} />
              {metric.key === "waist" && height && <ReferenceLine ifOverflow="extendDomain" y={displayValue(height / 2, metric, units)} stroke="var(--amber)" strokeDasharray="5 5" />}
              <Line name="Raw" type="linear" dataKey="value" stroke="var(--accent-2)" strokeWidth={1.7} dot={{ r: 3 }} isAnimationActive={false} />
              <Line name="7-day average" type="linear" dataKey="average" stroke="var(--accent)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="chart-legend">
          <span style={{ color: "var(--accent-2)" }}>Raw · {displayUnit(metric, units)}</span>
          <span style={{ color: "var(--accent)" }}>7-day average</span>
          {metric.key === "waist" && height && <span style={{ color: "var(--amber)" }}>Waist reference</span>}
        </div>
      </>}
  </section>;
}
