"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  Activity, ArrowDownToLine, CalendarDays, ChevronRight, Crosshair, Fingerprint, Plus, Ruler, Settings, TrendingUp,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { authClient } from "../lib/auth-client";
import {
  displayUnit, displayValue, metrics, readingsFor, recomp, summary, type Metric, type Reading, type Units,
} from "../lib/metrics";
import type { trackerData } from "../lib/tracker-data";
import { TrendChart } from "./trends";

type Snapshot = Awaited<ReturnType<ReturnType<typeof trackerData>["snapshot"]>>;
const tabs = [
  { title: "Today", icon: Activity }, { title: "Trends", icon: TrendingUp },
  { title: "Log", icon: Plus }, { title: "Settings", icon: Settings },
] as const;
type Tab = (typeof tabs)[number]["title"];
const number = new Intl.NumberFormat("en", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
function localDate() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
const readout = (value: number | null | undefined, metric: Metric, units: Units) =>
  value == null ? "—" : number.format(displayValue(value, metric, units));

export function Dashboard({ initial }: { initial: Snapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [tab, setTab] = useState<Tab>("Today");
  const [today, setToday] = useState(() => new Date().toISOString().slice(0, 10));
  const [date, setDate] = useState(today);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const { readings, settings } = snapshot;
  useEffect(() => { const day = localDate(); setToday(day); setDate(day); }, []);

  function navigate(next: Tab) {
    setMessage("");
    setTab(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function save(action: object, success: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/tracker", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Could not save.");
      if (payload.deleted) { location.reload(); return; }
      setSnapshot(payload);
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  function submitLog(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const values = metrics.flatMap((metric) => {
      const raw = String(form.get(metric.key) ?? "").trim();
      if (raw === "") return [];
      const value = /^\d+(?:[.,]\d+)?$/.test(raw) ? Number(raw.replace(",", ".")) : NaN;
      return [{ key: metric.key, value: value / displayValue(1, metric, settings.units) }];
    });
    if (!values.length) { setMessage("Enter at least one measurement."); return; }
    if (values.some(({ value }) => !Number.isFinite(value) || value <= 0)) {
      setMessage("Enter positive numbers for measurements.");
      return;
    }
    const note = String(form.get("note") ?? "");
    void save({
      action: "log", data: { date, values, note: note || (form.get("clearNotes") ? "" : undefined) },
    }, "Measurements saved.");
  }

  function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    void save({
      action: "settings", data: { heightCm: fields.get("height") ? Number(fields.get("height")) : null,
        units: fields.get("units"), goals: fields.get("goals") },
    }, "Settings saved.");
  }

  const selected = readings.filter((reading) => reading.date === date);
  const [waistMetric, leftMetric, rightMetric] = metrics;
  const [waist, left, right] = [waistMetric, leftMetric, rightMetric].map((metric) =>
    summary(readingsFor(readings, metric), today).latest?.value);
  const ratio = (value: number | undefined, base: number | null | undefined) =>
    value != null && base != null && base > 0 ? (value / base).toFixed(2) : "Insufficient data";

  return <main className="shell">
    <header className="masthead"><span className="mark"><Activity size={20} /></span><span>Fitness</span></header>
    <div className="screen" key={tab}>
      <div className="page-title"><h1>{tab}</h1>{tab === "Today" &&
        <Button variant="secondary" className="compact" onClick={() => navigate("Log")}><Plus size={18} /> Log</Button>}</div>
      {tab === "Today" && <>
        <p className="today-date"><CalendarDays size={17} /> {new Date(today + "T12:00:00Z").toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" })}</p>
        <div className="measure-grid">{metrics.filter((metric, index) => index < 3 || readingsFor(readings, metric).length > 0).map((metric) => {
          const { latest, change, weekly } = summary(readingsFor(readings, metric), today);
          return <article className="card metric-card" key={metric.key}>
            <h2>{metric.label}</h2>
            <div className="reading">{readout(latest?.value, metric, settings.units)} <small>{displayUnit(metric, settings.units)}</small></div>
            <div className="metric-meta"><span>7-day change</span><span>{change != null && change > 0 ? "+" : ""}{readout(change, metric, settings.units)}</span></div>
            <div className="metric-meta"><span>7-day average</span><span>{readout(weekly, metric, settings.units)}</span></div>
          </article>;
        })}</div>
        <h2 className="section-title">Insights</h2>
        <div className="insight-grid">
          <article className="card"><Ruler className="accent" size={20} /><h3>Waist-to-height</h3><strong>{ratio(waist, settings.heightCm)}</strong></article>
          <article className="card"><Activity className="accent" size={20} /><h3>Arm-to-waist</h3><strong>{ratio(left == null || right == null ? undefined : (left + right) / 2, waist)}</strong></article>
          <article className="card recomp"><Crosshair className="accent" size={20} /><h3>Recomp direction</h3><strong>{recomp(readings, today)}</strong><p>Compares the last 4 weeks with the 4 weeks before. Changes up to 0.5 cm count as flat. Each period needs two readings per metric.</p></article>
        </div>
      </>}
      {tab === "Trends" && <TrendChart readings={readings} today={today} units={settings.units} height={settings.heightCm} />}
      {tab === "Log" && <>
        <form className="card" key={date + JSON.stringify(selected)} onSubmit={submitLog} method="post">
          <label>Date<input type="date" required value={date} max={today} onChange={(e) => { if (e.target.value) setDate(e.target.value); }} /></label>
          <div className="input-grid">{metrics.map((metric) => {
            const value = readingsFor(selected, metric)[0]?.value;
            return <label key={metric.key}>{metric.label} ({displayUnit(metric, settings.units)})
              <input name={metric.key} inputMode="decimal" placeholder="—" defaultValue={value == null ? "" : String(Number(displayValue(value, metric, settings.units).toFixed(4)))} />
            </label>;
          })}</div>
          <label>Note <small>Optional</small><textarea name="note" rows={2} maxLength={1000} placeholder="Leave blank to keep existing notes" /></label>
          {selected.some((reading) => reading.note) && <label className="check-row"><input type="checkbox" name="clearNotes" /> Clear existing notes when the note field is blank</label>}
          <Button disabled={busy} type="submit">Save measurements</Button>
        </form>
        {readings.length > 0 && <section className="card activity-list">
          <h2>Recent entries</h2>
          {[...new Set(readings.map((r) => r.date))].slice(0, 10).map((day) =>
            <button className="list-item" key={day} onClick={() => setDate(day)}>{day}<ChevronRight size={18} /></button>)}
        </section>}
        {selected.length > 0 && <section className="card activity-list">
          <h2>Entries on {date}</h2>
          {selected.map((row) => {
            const metric = metrics.find((m) => m.metric === row.metric && m.side === row.side)!;
            return <div className="list-item" key={row.id}><span>{metric.label}{row.note && <small className="row-note">{row.note}</small>}</span>
              <button className="secondary compact" disabled={busy} onClick={() => {
                if (window.confirm(`Delete ${metric.label} for ${date}?`)) void save({ action: "delete-reading", id: row.id }, "Measurement deleted.");
              }}>Delete</button></div>;
          })}
        </section>}
      </>}
      {tab === "Settings" && <>
        <form className="card" onSubmit={submitSettings} method="post">
          <h2>Profile</h2>
          <label>Height (cm)<input name="height" type="number" inputMode="decimal" min="1" max="300" step="0.1" defaultValue={settings.heightCm ?? ""} /></label>
          <label>Units<select name="units" defaultValue={settings.units}><option value="metric">Metric (cm, kg)</option><option value="imperial">Imperial (in, lb)</option></select></label>
          <label>Goals<textarea name="goals" maxLength={2000} rows={3} defaultValue={settings.goals} /></label>
          {settings.heightCm && <p>Waist reference (half of height) · {readout(settings.heightCm / 2, waistMetric, settings.units)} {displayUnit(waistMetric, settings.units)}</p>}
          <Button disabled={busy} type="submit">Save settings</Button>
        </form>
        <details className="card"><summary>How to measure consistently</summary>
          <p>Use the same tape, landmarks, and time of day. Keep the tape level and snug. Measure your waist after a normal exhale and your arms relaxed at the same point each time. Use the same scale and similar clothing for weight.</p>
        </details>
        <Passkeys onMessage={setMessage} />
        <section className="card"><h2>Your data</h2>
          <div className="button-row"><button className="secondary" onClick={() => download(snapshot, "csv")}><ArrowDownToLine size={18} /> CSV</button>
          <button className="secondary" onClick={() => download(snapshot, "json")}><ArrowDownToLine size={18} /> JSON</button></div>
          <button className="secondary wide" onClick={async () => {
            const result = await authClient.signOut({});
            if (result.error) setMessage("Could not sign out.");
            else location.reload();
          }}>Sign out</button>
          <button className="danger wide" onClick={() => setShowDelete(!showDelete)}>Delete my account and data</button>
          {showDelete && <form onSubmit={(event) => {
            event.preventDefault();
            const confirmation = new FormData(event.currentTarget).get("confirmation");
            void save({ action: "delete-account", confirmation }, "");
          }} method="post">
            <label>Type DELETE to permanently remove your account and all measurements.
              <input name="confirmation" required pattern="DELETE" autoComplete="off" />
            </label>
            <Button variant="destructive" disabled={busy} type="submit">Confirm deletion</Button>
          </form>}
        </section>
      </>}
      {!!message && <div className="feedback" role="status">{message}</div>}
    </div>
    <nav className="tabs" aria-label="Fitness views">
      {tabs.map(({ title, icon: Icon }) => <button key={title} aria-current={tab === title ? "page" : undefined} onClick={() => navigate(title)}>
        <Icon size={22} aria-hidden="true" /><span>{title}</span>
      </button>)}
    </nav>
  </main>;
}

function Passkeys({ onMessage }: { onMessage: (message: string) => void }) {
  const keys = authClient.useListPasskeys();
  return <section className="card"><h2>Passkeys</h2>
    {keys.isPending && <p>Loading passkeys…</p>}
    {keys.error && <p>Could not load passkeys.</p>}
    {keys.data?.map((key) => <div className="list-item" key={key.id}>
      <span>{key.name || "Passkey"}</span>
      <button className="secondary compact" onClick={async () => {
        if (!window.confirm("Remove this passkey?")) return;
        const result = await authClient.passkey.deletePasskey({ id: key.id });
        onMessage(result.error ? "Could not remove passkey." : "Passkey removed.");
      }}>Remove</button>
    </div>)}
    <button className="secondary wide" onClick={async () => {
      try {
        const result = await authClient.passkey.addPasskey({});
        onMessage(result?.error || !result?.data ? "Could not add passkey." : "Passkey added.");
      } catch { onMessage("Could not add passkey."); }
    }}><Fingerprint size={18} /> Add passkey</button>
  </section>;
}

function download(snapshot: Snapshot, format: "json" | "csv") {
  const csvCell = (cell: unknown) => {
    const value = String(cell ?? "");
    const safe = /^[\s]*[=+\-@]|^[\t\r]/.test(value) ? "'" + value : value;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const data = format === "json" ? JSON.stringify(snapshot, null, 2) :
    ["date,metric,side,value,unit,note", ...snapshot.readings.map((row: Reading) =>
      [row.date, row.metric, row.side, row.value, row.metric === "weight" ? "kg" : "cm", row.note].map(csvCell).join(","))].join("\r\n");
  const url = URL.createObjectURL(new Blob([data], { type: format === "json" ? "application/json" : "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `fitness.${format}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
