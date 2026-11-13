export const metrics = [
  { key: "waist", label: "Waist", metric: "waist", side: "none", unit: "cm" },
  { key: "left-bicep", label: "Left bicep", metric: "bicep", side: "left", unit: "cm" },
  { key: "right-bicep", label: "Right bicep", metric: "bicep", side: "right", unit: "cm" },
  { key: "chest", label: "Chest", metric: "chest", side: "none", unit: "cm" },
  { key: "hips", label: "Hips", metric: "hips", side: "none", unit: "cm" },
  { key: "left-thigh", label: "Left thigh", metric: "thigh", side: "left", unit: "cm" },
  { key: "right-thigh", label: "Right thigh", metric: "thigh", side: "right", unit: "cm" },
  { key: "neck", label: "Neck", metric: "neck", side: "none", unit: "cm" },
  { key: "weight", label: "Weight", metric: "weight", side: "none", unit: "kg" },
] as const;

export type Metric = (typeof metrics)[number];
export type Reading = { id: string; metric: string; side: string; date: string; value: number; note: string };
export type Units = "metric" | "imperial";

export function readingsFor(readings: Reading[], metric: Metric) {
  return readings.filter((r) => r.metric === metric.metric && r.side === metric.side);
}

export function shiftDate(day: string, offset: number) {
  const date = new Date(day + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function average(values: Reading[]) {
  return values.length ? values.reduce((sum, row) => sum + row.value, 0) / values.length : null;
}

export function movingAverage(readings: Reading[]) {
  const sorted = [...readings].sort((a, b) => a.date.localeCompare(b.date));
  let start = 0;
  let sum = 0;
  return sorted.map((row, index) => {
    sum += row.value;
    const cutoff = shiftDate(row.date, -6);
    while (sorted[start].date < cutoff) sum -= sorted[start++].value;
    return { date: row.date, value: row.value, average: sum / (index - start + 1) };
  });
}

export function summary(readings: Reading[], today: string) {
  const sorted = [...readings].filter((r) => r.date <= today).sort((a, b) => b.date.localeCompare(a.date));
  const latest = sorted[0];
  const prior = sorted.find((r) => r.date <= shiftDate(today, -7));
  return {
    latest,
    change: latest && prior && latest.date > prior.date ? latest.value - prior.value : null,
    weekly: average(sorted.filter((r) => r.date >= shiftDate(today, -6))),
  };
}

export function recomp(readings: Reading[], today: string) {
  const compared = metrics.slice(0, 3).map((metric) => {
    const rows = readingsFor(readings, metric);
    const recent = rows.filter((r) => r.date >= shiftDate(today, -27) && r.date <= today);
    const prior = rows.filter((r) => r.date >= shiftDate(today, -55) && r.date < shiftDate(today, -27));
    return recent.length >= 2 && prior.length >= 2 ? average(recent)! - average(prior)! : null;
  });
  const [waist, left, right] = compared;
  if (waist === null || left === null || right === null) return "Insufficient data";
  const arms = (left + right) / 2;
  if (waist <= 0.5 && arms >= -0.5) return "On track";
  if (waist > 0.5 && Math.abs(arms) <= 0.5) return "Drifting";
  return "Mixed direction";
}

export function displayValue(value: number, metric: Metric, units: Units) {
  return units === "metric" ? value : value * (metric.unit === "kg" ? 2.2046226218 : 1 / 2.54);
}

export function displayUnit(metric: Metric, units: Units) {
  return units === "metric" ? metric.unit : metric.unit === "kg" ? "lb" : "in";
}
