"use client";

import { ReminderSettings } from "./reminder-settings";
import { MacroTargetEditor } from "./macro-target-editor";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowDownToLine, Copy, Fingerprint, RefreshCw, Upload } from "lucide-react";
import { MoonThemeIcon, SunThemeIcon, TwoWaySyncIcon } from "../components/icons";
import { Button } from "../components/ui/button";
import { authClient } from "../lib/auth-client";
import { displayUnit, displayValue, metrics, type Reading } from "../lib/metrics";
import { type EnergySource, type TrackingMode } from "../lib/nutrition-model";
import {
  fmtRelativeSync,
  type AuditEntry,
  type GoogleIntegrationStatus,
  type NutritionSettings,
  type ThemeMode,
  type TrackerSnapshot,
} from "./types";

interface SettingsViewProps {
  today: string;
  tracker: TrackerSnapshot;
  settings: NutritionSettings;
  google: GoogleIntegrationStatus;
  audit: AuditEntry[];
  mcpEnabled: boolean;
  theme: ThemeMode;
  busy: boolean;
  onSetTheme: (mode: ThemeMode) => void;
  onToggleTheme: () => void;
  onSaveTracker: (action: object, successMessage: string) => Promise<void>;
  onNutritionAction: (action: object, successMessage: string) => Promise<boolean>;
  onSyncGoogle: (days?: number) => Promise<void>;
  onPushGoogle: (days?: number) => Promise<void>;
  onDisconnectGoogle: () => Promise<void>;
  onMessage: (msg: string) => void;
}

const CHATGPT_INSTRUCTIONS = `When I upload a food photo:
1. Search my saved recipes/foods first via search_saved_foods.
2. Prioritise weights (g/ml) and packet labels I give; estimate missing portions using objects for scale and account for oils, sauces, and cooking methods with a calMin/calMax uncertainty range.
3. Leave unknown micronutrients (such as fibre) as null rather than 0.
4. Only log when I ask, using log_meal with a unique idempotencyKey, and report the saved ID and database totals.
5. For "add another spoon/item", call update_meal with appendItems instead of creating a duplicate meal.`;

export function SettingsView({
  today,
  tracker,
  settings,
  google,
  audit,
  mcpEnabled,
  theme,
  busy,
  onSetTheme,
  onToggleTheme,
  onSaveTracker,
  onNutritionAction,
  onSyncGoogle,
  onPushGoogle,
  onDisconnectGoogle,
  onMessage,
}: SettingsViewProps) {
  const resolvedInitialMode: TrackingMode =
    settings.trackingMode ?? (settings.preferredEnergySource === "google" ? "fitbit" : "manual");
  const [targetCalories, setTargetCalories] = useState(String(settings.targetToday));
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [trackingMode, setTrackingMode] = useState<TrackingMode>(resolvedInitialMode);
  const [preferredSource, setPreferredSource] = useState<EnergySource>(
    resolvedInitialMode === "fitbit" ? "google" : "manual",
  );
  const [twoWaySync, setTwoWaySync] = useState(Boolean(settings.googleTwoWaySync));
  const [bulkMode, setBulkMode] = useState(Boolean(settings.bulkMode));

  useEffect(() => {
    const nextMode: TrackingMode =
      settings.trackingMode ?? (settings.preferredEnergySource === "google" ? "fitbit" : "manual");
    setTimezone(settings.timezone);
    setTrackingMode(nextMode);
    setPreferredSource(nextMode === "fitbit" ? "google" : "manual");
    setTwoWaySync(Boolean(settings.googleTwoWaySync));
    setBulkMode(Boolean(settings.bulkMode));
    setTargetCalories(String(settings.targetToday));
  }, [
    settings.timezone,
    settings.trackingMode,
    settings.preferredEnergySource,
    settings.googleTwoWaySync,
    settings.bulkMode,
    settings.targetToday,
  ]);

  const [manualDay, setManualDay] = useState(today);
  const [manualTotal, setManualTotal] = useState("");
  const [manualActive, setManualActive] = useState("");
  const [manualSteps, setManualSteps] = useState("");
  const [manualWeight, setManualWeight] = useState("");
  const [importText, setImportText] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [showDelete, setShowDelete] = useState(false);

  const waistMetric = metrics[0];
  const mcpUrl = typeof window !== "undefined" ? `${window.location.origin}/mcp` : "/mcp";

  function selectMode(mode: TrackingMode) {
    setTrackingMode(mode);
    setPreferredSource(mode === "fitbit" ? "google" : "manual");
  }

  function selectBulkMode(nextBulk: boolean) {
    setBulkMode(nextBulk);
    const resolvedMode: TrackingMode = trackingMode === "fitbit" || preferredSource === "google" ? "fitbit" : "manual";
    const resolvedSource: EnergySource = resolvedMode === "fitbit" ? "google" : "manual";
    void onNutritionAction(
      {
        action: "preferences",
        data: {
          timezone: timezone.trim(),
          trackingMode: resolvedMode,
          preferredEnergySource: resolvedSource,
          googleTwoWaySync: twoWaySync,
          bulkMode: nextBulk,
        },
      },
      nextBulk ? "Bulk mode enabled (green = at/over target, red = under)." : "Cut / Deficit mode enabled (green = under target, red = over).",
    );
  }

  function submitTarget(e: FormEvent) {
    e.preventDefault();
    const cal = Number(targetCalories);
    if (!Number.isInteger(cal) || cal < 500 || cal > 15000) {
      onMessage("Enter a whole-number target between 500 and 15,000 kcal.");
      return;
    }
    void onNutritionAction({ action: "target", data: { effectiveFrom, calories: cal } }, "Calorie target saved.");
  }

  function submitPreferences(e: FormEvent) {
    e.preventDefault();
    const resolvedMode: TrackingMode = trackingMode === "fitbit" || preferredSource === "google" ? "fitbit" : "manual";
    const resolvedSource: EnergySource = resolvedMode === "fitbit" ? "google" : "manual";
    void onNutritionAction(
      {
        action: "preferences",
        data: {
          timezone: timezone.trim(),
          trackingMode: resolvedMode,
          preferredEnergySource: resolvedSource,
          googleTwoWaySync: twoWaySync,
          bulkMode,
        },
      },
      "Preferences updated.",
    );
  }

  function submitManualEnergy(e: FormEvent) {
    e.preventDefault();
    const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
    const totalKcal = numOrNull(manualTotal);
    const activeKcal = numOrNull(manualActive);
    const steps = numOrNull(manualSteps);
    const weightKg = numOrNull(manualWeight);
    if (totalKcal == null && activeKcal == null && steps == null && weightKg == null) {
      onMessage("Enter at least a Total TDEE (kcal) or Weight (kg) value.");
      return;
    }
    void onNutritionAction(
      {
        action: "energy",
        data: {
          day: manualDay,
          source: "manual",
          totalKcal,
          activeKcal,
          steps: steps == null ? null : Math.round(steps),
          weightKg,
          complete: totalKcal != null,
        },
      },
      "Manual expenditure saved.",
    );
  }

  async function handleFileSelect(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      onMessage("Select a JSON or CSV export smaller than 2 MB.");
      return;
    }
    const text = await file.text();
    setImportFileName(file.name);
    setImportText(text);
  }

  async function submitHealthFileImport(e: FormEvent) {
    e.preventDefault();
    if (!importText.trim()) {
      onMessage("Select a Google Health / Takeout / Fitbit file or paste saved JSON/CSV.");
      return;
    }
    const saved = await onNutritionAction(
      { action: "import-health-file", rawText: importText },
      "Saved health data imported.",
    );
    if (saved) { setImportText(""); setImportFileName(""); }
  }

  function submitProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fields = new FormData(e.currentTarget);
    void onSaveTracker(
      {
        action: "settings",
        data: {
          heightCm: fields.get("height") ? Number(fields.get("height")) : null,
          units: fields.get("units"),
          goals: fields.get("goals"),
        },
      },
      "Body profile saved.",
    );
  }

  async function downloadAll(format: "json" | "csv") {
    if (format === "json") {
      const res = await fetch("/api/nutrition?export=json");
      if (!res.ok) { onMessage("Could not download your export. Please try again."); return; }
      const full = await res.json();
      triggerDownload(JSON.stringify(full, null, 2), "application/json", "mcplogger-export.json");
      return;
    }
    const csvCell = (cell: unknown) => {
      const value = String(cell ?? "");
      const safe = /^[\s]*[=+\-@]|^[\t\r]/.test(value) ? "'" + value : value;
      return '"' + safe.replaceAll('"', '""') + '"';
    };
    const data = [
      "date,metric,side,value,unit,note",
      ...tracker.readings.map((row: Reading) =>
        [row.date, row.metric, row.side, row.value, row.metric === "weight" ? "kg" : "cm", row.note]
          .map(csvCell)
          .join(","),
      ),
    ].join("\r\n");
    triggerDownload(data, "text/csv", "mcplogger-measurements.csv");
  }

  const missingWriteScopes = google.connected && (!google.canWriteNutrition || !google.canWriteWeights || !google.canReadSleep);

  return (
    <>
      <div className="page-header">
        <div className="page-header-title">
          <h1>Settings</h1>
          <p style={{ fontSize: ".84rem" }}>Theme, targets, manual TDEE, Google Health &amp; MCP</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
            onClick={onToggleTheme}
          >
            {theme === "light" ? <MoonThemeIcon size={17} /> : <SunThemeIcon size={17} />}
          </button>
        </div>
      </div>

      {/* Appearance Theme Switcher */}
      <section className="card">
        <div className="split-row">
          <div>
            <h2>Appearance</h2>
            <p style={{ fontSize: ".8rem" }}>Light clean canvas default or OLED dark mode</p>
          </div>
          <div className="segments" role="group" aria-label="Theme mode">
            <button type="button" aria-pressed={theme === "light"} onClick={() => onSetTheme("light")}>
              <SunThemeIcon size={15} /> Light
            </button>
            <button type="button" aria-pressed={theme === "dark"} onClick={() => onSetTheme("dark")}>
              <MoonThemeIcon size={15} /> Dark
            </button>
          </div>
        </div>
      </section>

      {/* Nutrition Targets */}
      <section className="card">
        <div className="split-row" style={{ marginBottom: ".55rem" }}>
          <div>
            <h2>Calorie &amp; Macro Targets</h2>
            <p style={{ fontSize: ".8rem" }}>
              {bulkMode
                ? "Bulk mode: green when intake meets/exceeds target, red when under target."
                : "Cut / Deficit mode: green when intake stays at/under target, red when over target."}
            </p>
          </div>
          <span className={`pill ${bulkMode ? "accent-soft" : "teal-soft"}`}>
            {bulkMode ? "Bulk mode" : "Cut / Deficit"}
          </span>
        </div>
        <div className="segments" role="group" aria-label="Calorie goal mode" style={{ marginBottom: ".75rem" }}>
          <button
            type="button"
            aria-pressed={!bulkMode}
            disabled={busy}
            onClick={() => selectBulkMode(false)}
          >
            Cut / Deficit (under = green)
          </button>
          <button
            type="button"
            aria-pressed={bulkMode}
            disabled={busy}
            onClick={() => selectBulkMode(true)}
          >
            Bulk mode (over = green)
          </button>
        </div>
        <MacroTargetEditor initial={settings.macroTargets} today={today} busy={busy} onSave={onNutritionAction} />

        {settings.targets.length > 0 && (
          <div style={{ marginTop: ".75rem" }}>
            <h3 style={{ fontSize: ".84rem", color: "var(--muted)", marginBottom: ".3rem" }}>Historical targets</h3>
            {settings.targets.map((t) => (
              <div className="list-item" key={t.id}>
                <span className="num">From {t.effectiveFrom}</span>
                <strong className="num">{t.calories.toLocaleString("en-GB")} kcal</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Manual Daily Expenditure (TDEE) — promoted clearly ABOVE source selector & Google Health */}
      <section className="card">
        <h2>Manual Daily Expenditure (TDEE)</h2>
        <p style={{ fontSize: ".8rem", marginBottom: ".65rem" }}>
          Not using Fitbit? Enter your estimated total daily burn (TDEE, including resting metabolism) for any day to compute accurate calorie deficit without connecting Google Health.
        </p>
        <form onSubmit={submitManualEnergy}>
          <div className="input-grid">
            <label>Date<input type="date" value={manualDay} onChange={(e) => e.target.value && setManualDay(e.target.value)} /></label>
            <label>Total TDEE (kcal)<input inputMode="decimal" value={manualTotal} onChange={(e) => setManualTotal(e.target.value)} placeholder="e.g. 2350" /></label>
            <label>Weight (kg, optional)<input inputMode="decimal" value={manualWeight} onChange={(e) => setManualWeight(e.target.value)} placeholder="e.g. 74.2" /></label>
          </div>
          <details style={{ margin: ".55rem 0 .75rem" }}>
            <summary>Optional active burn &amp; steps</summary>
            <div className="input-grid" style={{ marginTop: ".5rem" }}>
              <label>Active burn (kcal, optional)<input inputMode="decimal" value={manualActive} onChange={(e) => setManualActive(e.target.value)} placeholder="e.g. 480" /></label>
              <label>Steps (optional)<input inputMode="numeric" value={manualSteps} onChange={(e) => setManualSteps(e.target.value)} placeholder="e.g. 9200" /></label>
            </div>
          </details>
          <Button variant="secondary" disabled={busy} type="submit">Save manual expenditure</Button>
        </form>
      </section>

      {/* Expenditure Source & Timezone Preferences */}
      <section className="card">
        <div className="split-row">
          <div>
            <h2>Expenditure Source &amp; Timezone</h2>
            <p style={{ fontSize: ".8rem" }}>
              Choose whether FitnessTrackr runs in Manual TDEE mode or Fitbit Air (Google Health) mode across Home, Nutrition &amp; Measurements.
            </p>
          </div>
          <span className={`pill ${trackingMode === "fitbit" ? "teal-soft" : "accent-soft"}`}>
            {trackingMode === "fitbit" ? "Fitbit Air mode" : "Manual mode"}
          </span>
        </div>
        <form onSubmit={submitPreferences} style={{ marginTop: ".6rem" }}>
          <div className="segments" role="group" aria-label="Tracking mode">
            <button
              type="button"
              aria-pressed={trackingMode === "manual"}
              onClick={() => selectMode("manual")}
            >
              Manual TDEE entry
            </button>
            <button
              type="button"
              aria-pressed={trackingMode === "fitbit"}
              onClick={() => selectMode("fitbit")}
            >
              Google Health (Fitbit Air)
            </button>
          </div>
          <div className="input-grid">
            <label>
              Timezone <small>(DST-aware)</small>
              <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Europe/London" />
            </label>
            <label>
              Preferred expenditure source
              <select
                value={preferredSource}
                onChange={(e) => selectMode(e.target.value === "google" ? "fitbit" : "manual")}
              >
                <option value="manual">Manual TDEE entry</option>
                <option value="google">Google Health (Fitbit Air)</option>
              </select>
            </label>
          </div>
          {google.connected && trackingMode === "fitbit" && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={twoWaySync}
                onChange={(e) => setTwoWaySync(e.target.checked)}
              />
              Auto-push logged meals &amp; weights to Google Health (two-way write)
            </label>
          )}
          <Button variant="secondary" disabled={busy} type="submit">Save preferences</Button>
        </form>
      </section>

      {/* Google Health / Fitbit Air Two-Way Integration & Saved File Importer */}
      <section className="card">
        <div className="split-row">
          <div>
            <h2>Google Health (Fitbit Air)</h2>
            <p style={{ fontSize: ".8rem" }}>
              Two-way sync: imports TDEE, sleep, recovery/vitals, workouts, active burn, steps, weight, and height; writes meals and weights back. Each FitnessTrackr account links its own Google account.
            </p>
          </div>
          <span className={`pill ${google.connected ? (trackingMode === "fitbit" ? "teal-soft" : "amber-soft") : ""}`}>
            {google.connected
              ? trackingMode === "fitbit"
                ? "Connected · Active"
                : "Connected · Manual mode"
              : google.available
                ? "Ready to link"
                : "Env vars not set"}
          </span>
        </div>

        <div style={{ marginTop: ".75rem", display: "grid", gap: ".65rem" }}>
          {!google.available && (
            <p style={{ fontSize: ".82rem" }}>
              Set <code>GOOGLE_HEALTH_CLIENT_ID</code>, <code>GOOGLE_HEALTH_CLIENT_SECRET</code>, and 64-hex{" "}
              <code>FITNESS_INTEGRATION_KEY</code> in Coolify to enable live OAuth syncing. You can still import saved Google/Fitbit exports below anytime.
            </p>
          )}
          {google.connected && (
            <div style={{ display: "grid", gap: ".45rem", fontSize: ".82rem", color: "var(--muted)" }}>
              <div>
                {google.accountLabel && (
                  <>
                    Account: <strong style={{ color: "var(--text)" }}>{google.accountLabel}</strong> ·{" "}
                  </>
                )}
                Status: <strong style={{ color: "var(--text)" }}>{google.status}</strong> · Last sync:{" "}
                <strong style={{ color: "var(--text)" }}>{fmtRelativeSync(google.lastSync)}</strong>
              </div>
              <div className="button-row">
                <span className="pill accent-soft">Read TDEE &amp; Steps</span>
                <span className={`pill ${google.canReadSleep ? "teal-soft" : "amber-soft"}`}>
                  {google.canReadSleep ? "Read Sleep (Fitbit Air)" : "Sleep read needs reconnect"}
                </span>
                <span className={`pill ${google.canReadWeights ? "teal-soft" : ""}`}>
                  {google.canReadWeights ? "Read Weights & Height" : "Weights read off"}
                </span>
                <span className={`pill ${google.canWriteWeights ? "teal-soft" : "amber-soft"}`}>
                  {google.canWriteWeights ? "Write Weights" : "Write Weights needs reconnect"}
                </span>
                <span className={`pill ${google.canWriteNutrition ? "teal-soft" : "amber-soft"}`}>
                  {google.canWriteNutrition ? "Write Meals" : "Write Meals needs reconnect"}
                </span>
              </div>
              {google.mealSync && <div aria-live="polite" role="status">
                <p>Meal sync: {google.mealSync.pending} queued · {google.mealSync.failed} need attention · {google.mealSync.verified ?? 0} verified in Google</p>
                {google.mealSync.lastVerifiedAt && <p>Last verified: {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: settings.timezone }).format(new Date(google.mealSync.lastVerifiedAt))}</p>}
                {google.mealSync.lastError && <p style={{ color: "var(--danger-fg)" }}>{google.mealSync.lastError} Use Sync Now to retry.</p>}
              </div>}
              {google.lastError && <div style={{ color: "var(--danger-fg)" }}>Last error: {google.lastError}</div>}
            </div>
          )}

          <div className="button-row">
            {google.available && (!google.connected || missingWriteScopes) && (
              <a
                href={missingWriteScopes || twoWaySync ? "/api/integrations/google/connect?write=1" : "/api/integrations/google/connect"}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  minHeight: "42px",
                  padding: ".55rem .95rem",
                  borderRadius: "14px",
                  background: "var(--accent)",
                  color: "var(--accent-ink)",
                  fontWeight: 640,
                  textDecoration: "none",
                }}
              >
                {missingWriteScopes ? "Reconnect for sleep & 2-way permissions" : "Connect Google Health"}
              </a>
            )}
            {google.connected && (
              <>
                <button type="button" className="secondary compact" disabled={busy} onClick={() => void onSyncGoogle(14)}>
                  <RefreshCw size={14} /> Pull 14 days
                </button>
                <button type="button" className="secondary compact" disabled={busy} onClick={() => void onSyncGoogle(30)}>
                  Pull 30 days
                </button>
                {google.canWriteNutrition && (
                  <>
                    <button type="button" className="secondary compact" disabled={busy} onClick={() => void onPushGoogle(14)}>
                      <TwoWaySyncIcon size={14} /> {busy ? "Working…" : "Sync Now"}
                    </button>
                    <button type="button" className="secondary compact" disabled={busy} onClick={() => void onPushGoogle(0)}>
                      Backfill all meals
                    </button>
                  </>
                )}
                <button type="button" className="danger compact" disabled={busy} onClick={() => void onDisconnectGoogle()}>
                  Disconnect &amp; delete Google data
                </button>
              </>
            )}
          </div>
        </div>

        {/* Saved Google Health / Google Takeout / Fitbit Export Importer */}
        <form onSubmit={submitHealthFileImport} style={{ marginTop: "1rem", borderTop: "1px solid var(--border)", paddingTop: ".9rem" }}>
          <div>
            <h3>Import Saved Health Data (Google Health / Takeout / Fitbit)</h3>
            <p style={{ fontSize: ".79rem" }}>
              Upload or paste saved JSON (Google Health v4 <code>dataPoints</code>/<code>rollupDataPoints</code>/<code>sleep</code>, Fitbit Takeout <code>weight-*.json</code>/<code>calories-*.json</code>/<code>sleep-*.json</code>) or CSV exports. Weights sync into Measurements &amp; Trends without overwriting manual scale entries.
            </p>
          </div>
          <label className="drop-zone">
            <span style={{ display: "inline-flex", alignItems: "center", gap: ".4rem" }}>
              <Upload size={15} /> {importFileName ? `Selected: ${importFileName}` : "Choose saved .json or .csv file"}
            </span>
            <input type="file" accept=".json,.csv,application/json,text/csv" onChange={(e) => void handleFileSelect(e)} />
          </label>
          <label>
            Or paste JSON / CSV payload
            <textarea
              rows={3}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='Date,Calories Burned,Active Calories,Steps,Weight kg'
            />
          </label>
          <Button variant="secondary" disabled={busy} type="submit">Import saved health data</Button>
        </form>
      </section>

      <ReminderSettings />

      {/* Private MCP / ChatGPT Connector */}
      <section className="card">
        <div className="split-row">
          <div>
            <h2>FitnessTrackr · ChatGPT Server</h2>
            <p style={{ fontSize: ".8rem" }}>OAuth 2.1 protected Streamable HTTP endpoint for photo meal logging.</p>
          </div>
          <span className={`pill ${mcpEnabled ? "accent-soft" : ""}`}>{mcpEnabled ? "Enabled" : "Disabled"}</span>
        </div>

        <div style={{ display: "grid", gap: ".65rem", marginTop: ".75rem" }}>
          <div className="mono-box">{mcpUrl}</div>
          <details>
            <summary>Connect on ChatGPT web first, then use on your phone</summary><p><a href="/connect" target="_blank" rel="noreferrer">Open the connection guide and plugin download</a></p>
            <ol className="connector-steps">
              <li><a href="https://chatgpt.com/plugins" target="_blank" rel="noreferrer">Use this link to open ChatGPT on the web and add FitnessTrackr</a>. Select +, then Add custom MCP server.</li>
              <li>Use the connection URL here: <code>{mcpUrl}</code>. Choose OAuth with automatic client registration, then create the plugin.</li>
              <li>Sign in to FitnessTrackr and approve the read and meal logging permissions.</li>
              <li>After connecting on the web, open the ChatGPT phone app with the same account. Enable FitnessTrackr in a new chat.</li>
              <li>Upload a meal photo and ask “Estimate this meal, then log it.” Check that the reply includes a saved meal ID.</li>
            </ol>
            <p className="search-hint">Custom MCP setup is done on the web. Plugin availability on mobile depends on your account and workspace. If this endpoint is disabled, it must be enabled before connecting.</p>
            <a href="https://learn.chatgpt.com/docs/plugins" target="_blank" rel="noreferrer">ChatGPT plugin instructions</a>
          </details>
          <div className="button-row">
            <button
              type="button"
              className="secondary compact"
              onClick={async () => {
                try { await navigator.clipboard.writeText(mcpUrl); onMessage("MCP URL copied."); }
                catch { onMessage("Copy was blocked. Select the MCP URL above and copy it."); }
              }}
            >
              <Copy size={14} /> Copy MCP URL
            </button>
            <button
              type="button"
              className="secondary compact"
              onClick={async () => {
                try { await navigator.clipboard.writeText(CHATGPT_INSTRUCTIONS); onMessage("ChatGPT instructions copied."); }
                catch { onMessage("Copy was blocked. See the connector guide for the instructions."); }
              }}
            >
              <Copy size={14} /> Copy ChatGPT instructions
            </button>
            <button
              type="button"
              className="danger compact"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Revoke all active ChatGPT / MCP tokens and consents?")) {
                  void onNutritionAction({ action: "revoke-mcp" }, "All MCP tokens and consents revoked.");
                }
              }}
            >
              Revoke MCP access
            </button>
          </div>
          {audit.length > 0 && (
            <details>
              <summary>Recent MCP tool activity ({audit.length})</summary>
              {audit.map((ev) => (
                <div className="list-item" key={ev.id}>
                  <span>
                    <code>{ev.tool}</code>
                    {ev.summary && <small className="row-note">{ev.summary}</small>}
                  </span>
                  <span style={{ fontSize: ".75rem", color: "var(--muted)" }}>{fmtRelativeSync(ev.createdAt)}</span>
                </div>
              ))}
            </details>
          )}
        </div>
      </section>

      {/* Body Profile */}
      <form className="card" onSubmit={submitProfile} method="post">
        <h2>Body Profile</h2>
        <div className="input-grid">
          <label>
            Height (cm)
            <input name="height" type="number" inputMode="decimal" min="1" max="300" step="0.1" defaultValue={tracker.settings.heightCm ?? ""} />
          </label>
          <label>
            Measurement units
            <select name="units" defaultValue={tracker.settings.units}>
              <option value="metric">Metric (cm, kg)</option>
              <option value="imperial">Imperial (in, lb)</option>
            </select>
          </label>
        </div>
        <label>
          Goals
          <textarea name="goals" maxLength={2000} rows={2} defaultValue={tracker.settings.goals} />
        </label>
        {tracker.settings.heightCm && (
          <p style={{ fontSize: ".82rem" }}>
            Waist reference (half of height) ·{" "}
            <strong className="num">
              {displayValue(tracker.settings.heightCm / 2, waistMetric, tracker.settings.units).toFixed(1)}{" "}
              {displayUnit(waistMetric, tracker.settings.units)}
            </strong>
          </p>
        )}
        <Button disabled={busy} type="submit">Save profile</Button>
      </form>

      <Passkeys onMessage={onMessage} />

      {/* Data Export & Account */}
      <section className="card">
        <h2>Your Data &amp; Account</h2>
        <div className="button-row" style={{ marginTop: ".6rem" }}>
          <button type="button" className="secondary" onClick={() => void downloadAll("json")}>
            <ArrowDownToLine size={17} /> Full Export (JSON)
          </button>
          <button type="button" className="secondary" onClick={() => void downloadAll("csv")}>
            <ArrowDownToLine size={17} /> Measurements (CSV)
          </button>
        </div>
        <button
          type="button"
          className="secondary wide"
          onClick={async () => {
            const result = await authClient.signOut({});
            if (result.error) onMessage("Could not sign out.");
            else location.reload();
          }}
        >
          Sign out
        </button>
        <button type="button" className="danger wide" onClick={() => setShowDelete(!showDelete)}>
          Delete my account and data
        </button>
        {showDelete && (
          <form
            style={{ marginTop: ".75rem" }}
            onSubmit={(event) => {
              event.preventDefault();
              const confirmation = new FormData(event.currentTarget).get("confirmation");
              void onSaveTracker({ action: "delete-account", confirmation }, "");
            }}
            method="post"
          >
            <label>
              Type DELETE to permanently remove your account and all data.
              <input name="confirmation" required pattern="DELETE" autoComplete="off" />
            </label>
            <Button variant="destructive" disabled={busy} type="submit">
              Confirm deletion
            </Button>
          </form>
        )}
      </section>
    </>
  );
}

function Passkeys({ onMessage }: { onMessage: (message: string) => void }) {
  const keys = authClient.useListPasskeys();
  return (
    <section className="card">
      <h2>Passkeys</h2>
      {keys.isPending && <p>Loading passkeys…</p>}
      {keys.error && <p>Could not load passkeys.</p>}
      {keys.data?.map((key) => (
        <div className="list-item" key={key.id}>
          <span>{key.name || "Passkey"}</span>
          <button
            type="button"
            className="secondary compact"
            onClick={async () => {
              if (!window.confirm("Remove this passkey?")) return;
              const result = await authClient.passkey.deletePasskey({ id: key.id });
              onMessage(result.error ? "Could not remove passkey." : "Passkey removed.");
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary wide"
        onClick={async () => {
          try {
            const result = await authClient.passkey.addPasskey({});
            onMessage(result?.error || !result?.data ? "Could not add passkey." : "Passkey added.");
          } catch {
            onMessage("Could not add passkey.");
          }
        }}
      >
        <Fingerprint size={18} /> Add passkey
      </button>
    </section>
  );
}

function triggerDownload(content: string, mime: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
