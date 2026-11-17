"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { NutritionHistory, TrackerSnapshot } from "./types";

interface NutritionTrendsProps {
  history: NutritionHistory;
  tracker: TrackerSnapshot;
}

export function NutritionTrends({ history, tracker }: NutritionTrendsProps) {
  const [span, setSpan] = useState<7 | 30>(30);
  const [view, setView] = useState<"energy" | "protein" | "body">("energy");

  const data = useMemo(() => {
    const days = span === 7 ? history.days.slice(-7) : history.days;
    const rollByDay = new Map(history.rolling.map((r) => [r.day, r]));
    const weightMap = new Map<string, number>();
    const waistMap = new Map<string, number>();
    for (const r of tracker.readings) {
      if (r.metric === "weight" && r.side === "none") weightMap.set(r.date, r.value);
      if (r.metric === "waist" && r.side === "none") waistMap.set(r.date, r.value);
    }

    return days.map((d) => {
      const roll = rollByDay.get(d.day);
      return {
        day: d.day.slice(5),
        intake: d.totals.calories,
        burn: d.energy?.totalKcal ?? null,
        deficit: d.deficit,
        rollingDeficit: roll?.rollingDeficit7d ?? null,
        protein: d.totals.proteinG,
        rollingProtein: roll?.rollingProtein7d ?? null,
        weight: weightMap.get(d.day) ?? d.energy?.weightKg ?? null,
        waist: waistMap.get(d.day) ?? null,
      };
    });
  }, [history, span, tracker.readings]);

  return (
    <section className="card chart-card">
      <div className="chart-controls">
        <div className="segments" aria-label="Trend metric">
          {(
            [
              ["energy", "Intake vs Burn"],
              ["protein", "Protein"],
              ["body", "Weight & Waist"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="segments" aria-label="Trend range">
          {([7, 30] as const).map((days) => (
            <button key={days} type="button" aria-pressed={span === days} onClick={() => setSpan(days)}>
              {days}d
            </button>
          ))}
        </div>
      </div>

      <div className="chart" style={{ marginTop: ".75rem" }}>
        {view === "energy" && (
          <>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={data} margin={{ left: -12, right: 10, top: 10 }}>
                <CartesianGrid vertical={false} stroke="#232d38" />
                <XAxis dataKey="day" stroke="#98a5b4" tick={{ fontSize: 11 }} />
                <YAxis width={50} stroke="#98a5b4" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#141b23", border: "1px solid #374657", borderRadius: 12 }} />
                <Bar name="Intake (kcal)" dataKey="intake" fill="#c9f58e" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Line name="Total TDEE (kcal)" type="monotone" dataKey="burn" stroke="#6fe3c8" strokeWidth={2.2} dot={{ r: 2.5 }} connectNulls isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="chart-legend">
              <span>Intake (kcal)</span>
              <span style={{ color: "var(--teal)" }}>Total TDEE (estimate)</span>
            </div>
          </>
        )}

        {view === "protein" && (
          <>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={data} margin={{ left: -12, right: 10, top: 10 }}>
                <CartesianGrid vertical={false} stroke="#232d38" />
                <XAxis dataKey="day" stroke="#98a5b4" tick={{ fontSize: 11 }} />
                <YAxis width={46} stroke="#98a5b4" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#141b23", border: "1px solid #374657", borderRadius: 12 }} />
                <Bar name="Protein (g)" dataKey="protein" fill="#7ab8ff" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Line name="7-day avg (g)" type="monotone" dataKey="rollingProtein" stroke="#c9f58e" strokeWidth={2.2} dot={false} connectNulls isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="chart-legend">
              <span>Daily protein (g)</span>
              <span>7-day rolling average</span>
            </div>
          </>
        )}

        {view === "body" && (
          <>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data} margin={{ left: -12, right: 10, top: 10 }}>
                <CartesianGrid vertical={false} stroke="#232d38" />
                <XAxis dataKey="day" stroke="#98a5b4" tick={{ fontSize: 11 }} />
                <YAxis width={48} domain={["auto", "auto"]} stroke="#98a5b4" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: "#141b23", border: "1px solid #374657", borderRadius: 12 }} />
                <Line name="Weight (kg)" type="monotone" dataKey="weight" stroke="#6fe3c8" strokeWidth={2.2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
                <Line name="Waist (cm)" type="monotone" dataKey="waist" stroke="#f3c979" strokeWidth={2.2} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            <div className="chart-legend">
              <span style={{ color: "var(--teal)" }}>Weight (kg)</span>
              <span style={{ color: "var(--amber)" }}>Waist (cm)</span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
