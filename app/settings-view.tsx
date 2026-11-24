"use client";

import { ReminderSettings } from "./reminder-settings";
import { MacroTargetEditor } from "./macro-target-editor";
import { useEffect, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { ArrowDownToLine, ChevronDown, Copy, Fingerprint, RefreshCw, Upload } from "lucide-react";
import { TwoWaySyncIcon } from "../components/icons";
import { Button } from "../components/ui/button";
import { authClient } from "../lib/auth-client";
import { displayUnit, displayValue, metrics, type Reading } from "../lib/metrics";
import { type EnergySource, type TrackingMode } from "../lib/nutrition-model";
import {
  fmtRelativeSync,
  type AuditEntry,
  type GoogleIntegrationStatus,
  type HevyIntegrationStatus,
  type NutritionSettings,
  type StrainSettings,
  type TrackerSnapshot,
} from "./types";

interface SettingsViewProps {
  today: string;
  tracker: TrackerSnapshot;
  settings: NutritionSettings;
  google: GoogleIntegrationStatus;
  hevy?: HevyIntegrationStatus;
  strainSettings?: StrainSettings;
  audit: AuditEntry[];
  mcpEnabled: boolean;
  busy: boolean;
  onSaveTracker: (action: object, successMessage: string) => Promise<void>;
  onNutritionAction: (action: object, successMessage: string) => Promise<boolean>;
  onSaveStrainSettings?: (data: Partial<StrainSettings>) => Promise<boolean>;
  onImportHevy?: (rawText: string) => Promise<boolean>;
  onSyncHevy?: () => Promise<void>;
  onDisconnectHevy?: () => Promise<void>;
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
  hevy,
  strainSettings,
  audit,
  mcpEnabled,
  busy,
  onSaveTracker,
  onNutritionAction,
  onSaveStrainSettings,
  onImportHevy,
  onSyncHevy,
  onDisconnectHevy,
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

  const [walkingEnabled, setWalkingEnabled] = useState(strainSettings?.walkingEnabled ?? true);
  const [walkingStepThreshold, setWalkingStepThreshold] = useState(
    String(strainSettings?.walkingStepThreshold ?? 10500),
  );
  const [walkingSensitivity, setWalkingSensitivity] = useState<"low" | "normal" | "high">(
    strainSettings?.walkingSensitivity ?? "normal",
  );
  const [walkingMaxPoints, setWalkingMaxPoints] = useState(
    String(strainSettings?.walkingMaxPoints ?? 5),
  );
  const [maxHrBpm, setMaxHrBpm] = useState(
    strainSettings?.maxHrBpm != null ? String(strainSettings.maxHrBpm) : "",
  );
  const [hrAge, setHrAge] = useState(strainSettings?.age != null ? String(strainSettings.age) : "");
  const [hevyRawText, setHevyRawText] = useState("");

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

  useEffect(() => {
    if (!strainSettings) return;
    setWalkingEnabled(strainSettings.walkingEnabled);
    setWalkingStepThreshold(String(strainSettings.walkingStepThreshold));
    setWalkingSensitivity(strainSettings.walkingSensitivity);
    setWalkingMaxPoints(String(strainSettings.walkingMaxPoints));
    setMaxHrBpm(strainSettings.maxHrBpm != null ? String(strainSettings.maxHrBpm) : "");
    setHrAge(strainSettings.age != null ? String(strainSettings.age) : "");
  }, [strainSettings]);

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
      <section className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".75rem" }}>
        <div>
          <strong style={{ fontSize: "1rem" }}>@varmisan</strong>
          <div style={{ fontSize: ".76rem", color: "var(--muted)" }}>
            Silk Telemetry · {google.connected ? "Google Health connected" : "Local"}
            {hevy?.connected ? " · Hevy connected" : ""}
          </div>
        </div>
        <span className="pill accent-soft">Pro</span>
      </section>

      {/* Nutrition Targets */}
      <SettingsDropdown
        title="Calorie & Macro Targets"
        subtitle={
          bulkMode
            ? "Bulk mode: green when intake meets/exceeds target, red when under target."
            : "Cut / Deficit mode: green when intake stays at/under target, red when over target."
        }
        badge={bulkMode ? "Bulk mode" : "Cut / Deficit"}
        badgeClass={bulkMode ? "accent-soft" : "teal-soft"}
      >
        <div className="segments" role="group" aria-label="Calorie goal mode">
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
          <div>
            <h3 style={{ fontSize: ".84rem", color: "var(--muted)", marginBottom: ".3rem" }}>Historical targets</h3>
            {settings.targets.map((t) => (
              <div className="list-item" key={t.id}>
                <span className="num">From {t.effectiveFrom}</span>
                <strong className="num">{t.calories.toLocaleString("en-GB")} kcal</strong>
              </div>
            ))}
          </div>
        )}
      </SettingsDropdown>

      {/* Manual Daily Expenditure (TDEE) — promoted clearly ABOVE source selector & Google Health */}
      <SettingsDropdown
        title="Manual Daily Expenditure (TDEE)"
        subtitle="Enter estimated total daily burn (TDEE) for any day without Fitbit"
        badge="Manual TDEE"
      >
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
      </SettingsDropdown>

      {/* Expenditure Source & Timezone Preferences */}
      <SettingsDropdown
        title="Expenditure Source & Timezone"
        subtitle="Choose Manual TDEE mode or Fitbit Air (Google Health) mode"
        badge={trackingMode === "fitbit" ? "Fitbit Air mode" : "Manual mode"}
        badgeClass={trackingMode === "fitbit" ? "teal-soft" : "accent-soft"}
      >
        <form onSubmit={submitPreferences}>
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
      </SettingsDropdown>

      {/* Google Health / Fitbit Air Two-Way Integration & Saved File Importer */}
      <SettingsDropdown
        title="Google Health (Fitbit Air)"
        subtitle="Two-way sync: TDEE, sleep, RHR, HRV, workouts, steps, meals & weights"
        badge={
          google.connected
            ? trackingMode === "fitbit"
              ? "Connected · Active"
              : "Connected · Manual mode"
            : google.available
              ? "Ready to link"
              : "Env vars not set"
        }
        badgeClass={google.connected ? (trackingMode === "fitbit" ? "teal-soft" : "amber-soft") : ""}
      >
        <div style={{ display: "grid", gap: ".65rem" }}>
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
                className="unlock-btn"
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
        <form onSubmit={submitHealthFileImport} style={{ borderTop: "1px solid var(--border)", paddingTop: ".9rem" }}>
          <div>
            <h3>Import Saved Health Data (Google Health / Takeout / Fitbit)</h3>
            <p style={{ fontSize: ".79rem" }}>
              Upload or paste saved JSON or CSV exports. Weights sync into Measurements &amp; Trends without overwriting manual scale entries.
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
      </SettingsDropdown>

      {/* Hevy Strength Training Integration */}
      <SettingsDropdown
        id="hevy-settings"
        title="Hevy Strength Integration"
        subtitle="Syncs resistance workouts, sets, reps, weights & RPE and pairs with wearable HR"
        badge={
          hevy?.connected
            ? hevy.accountLabel
              ? `Connected · ${hevy.accountLabel}`
              : "Connected"
            : hevy?.oauthAvailable
              ? "Ready to link"
              : "CSV / JSON Import"
        }
        badgeClass={hevy?.connected ? "teal-soft" : ""}
      >
        <div style={{ display: "grid", gap: ".65rem" }}>
          <div className="muted" style={{ fontSize: ".82rem" }}>
            {hevy?.accountLabel && (
              <>
                Account: <strong style={{ color: "var(--text)" }}>{hevy.accountLabel}</strong> ·{" "}
              </>
            )}
            Workouts stored: <strong style={{ color: "var(--text)" }}>{hevy?.workoutCount ?? 0}</strong>
            {hevy?.lastSync && (
              <>
                {" "}· Last sync: <strong style={{ color: "var(--text)" }}>{fmtRelativeSync(hevy.lastSync)}</strong>
              </>
            )}
            {hevy?.lastError && (
              <div style={{ color: "var(--danger-fg)", marginTop: ".25rem" }}>Last error: {hevy.lastError}</div>
            )}
          </div>

          <div className="button-row">
            {hevy?.oauthAvailable && !hevy.connected && (
              <a className="unlock-btn" href="/api/integrations/hevy/connect">
                Connect Hevy OAuth
              </a>
            )}
            {hevy?.connected && onSyncHevy && (
              <button type="button" className="secondary compact" disabled={busy} onClick={() => void onSyncHevy()}>
                <RefreshCw size={14} /> Sync Hevy
              </button>
            )}
            {hevy?.connected && onDisconnectHevy && (
              <button type="button" className="danger compact" disabled={busy} onClick={() => void onDisconnectHevy()}>
                Disconnect Hevy
              </button>
            )}
          </div>

          {onImportHevy && (
            <div style={{ display: "grid", gap: ".55rem", borderTop: "1px solid var(--border)", paddingTop: ".75rem" }}>
              <strong style={{ fontSize: ".84rem" }}>Import Hevy CSV or JSON export (works on Hevy Free)</strong>
              <input
                type="file"
                accept=".csv,.json,text/csv,application/json"
                onChange={async (e: ChangeEvent<HTMLInputElement>) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const text = await file.text();
                  setHevyRawText(text);
                  await onImportHevy(text);
                  e.target.value = "";
                }}
              />
              <textarea
                rows={3}
                placeholder="Or paste Hevy CSV / JSON export here…"
                value={hevyRawText}
                onChange={(e) => setHevyRawText(e.target.value)}
              />
              <button
                type="button"
                className="secondary compact"
                disabled={busy || !hevyRawText.trim()}
                onClick={async () => {
                  const ok = await onImportHevy(hevyRawText);
                  if (ok) setHevyRawText("");
                }}
              >
                <Upload size={14} /> Import pasted Hevy data
              </button>
            </div>
          )}
        </div>
      </SettingsDropdown>

      {/* Training & Strain -> Walking Contribution & HR Zones */}
      <SettingsDropdown
        id="strain-walking-settings"
        title="Training & Strain · Walking Contribution"
        subtitle="Configure daily step threshold, walking sensitivity, max bonus & HR zones"
        badge={walkingEnabled ? "Walking enabled" : "Walking off"}
        badgeClass={walkingEnabled ? "teal-soft" : ""}
      >
        <form
          style={{ display: "grid", gap: ".75rem" }}
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            if (!onSaveStrainSettings) return;
            await onSaveStrainSettings({
              walkingEnabled,
              walkingStepThreshold: Math.max(0, Math.min(25000, Number(walkingStepThreshold) || 10500)),
              walkingSensitivity,
              walkingMaxPoints: Math.max(0, Math.min(15, Number(walkingMaxPoints) || 5)),
              maxHrBpm: maxHrBpm.trim() ? Number(maxHrBpm) : null,
              age: hrAge.trim() ? Number(hrAge) : null,
            });
          }}
        >
          <label className="check-row" style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
            <input
              type="checkbox"
              checked={walkingEnabled}
              onChange={(e) => setWalkingEnabled(e.target.checked)}
            />
            <span>Include eligible non-workout walking in Overall Strain</span>
          </label>

          <div className="field-grid">
            <label>
              Daily Step Threshold ({Number(walkingStepThreshold || 0).toLocaleString()} steps)
              <input
                type="range"
                min={0}
                max={25000}
                step={500}
                value={walkingStepThreshold}
                onChange={(e) => setWalkingStepThreshold(e.target.value)}
              />
              <input
                type="number"
                min={0}
                max={25000}
                step={500}
                value={walkingStepThreshold}
                onChange={(e) => setWalkingStepThreshold(e.target.value)}
                aria-label="Daily step threshold"
              />
            </label>

            <label>
              Walking Sensitivity
              <select
                value={walkingSensitivity}
                onChange={(e) => setWalkingSensitivity(e.target.value as "low" | "normal" | "high")}
              >
                <option value="low">Low</option>
                <option value="normal">Normal (Default)</option>
                <option value="high">High</option>
              </select>
            </label>

            <label>
              Max Walking Points Cap (0–15)
              <input
                type="number"
                min={0}
                max={15}
                step={0.5}
                value={walkingMaxPoints}
                onChange={(e) => setWalkingMaxPoints(e.target.value)}
              />
            </label>

            <label>
              Known Max HR (bpm, optional)
              <input
                type="number"
                min={120}
                max={230}
                placeholder="e.g. 192"
                value={maxHrBpm}
                onChange={(e) => setMaxHrBpm(e.target.value)}
              />
            </label>

            <label>
              Age (for HR zone estimate if Max HR unset)
              <input
                type="number"
                min={13}
                max={100}
                placeholder="e.g. 28"
                value={hrAge}
                onChange={(e) => setHrAge(e.target.value)}
              />
            </label>
          </div>

          <p className="muted" style={{ fontSize: ".78rem", margin: 0 }}>
            Only non-workout steps above your daily threshold contribute (capped at {walkingMaxPoints || 5} pts). Steps recorded during logged workouts are excluded when interval data is available so exercise is never double-counted. If Max HR is blank, zones use an{" "}
            <strong>Age-based estimate (220 − age)</strong> or a 190 bpm default.
          </p>

          <div className="button-row">
            <Button type="submit" disabled={busy || !onSaveStrainSettings}>
              Save strain &amp; walking settings
            </Button>
          </div>
        </form>
      </SettingsDropdown>

      {/* Meal & Weigh-in Reminders */}
      <SettingsDropdown
        title="Reminders & Notifications"
        subtitle="Meal logging and morning weigh-in push reminders"
        badge="Push alerts"
      >
        <ReminderSettings />
      </SettingsDropdown>

      {/* Private MCP / ChatGPT Connector */}
      <SettingsDropdown
        title="FitnessTrackr · ChatGPT Server"
        subtitle="OAuth 2.1 protected Streamable HTTP endpoint for photo meal logging"
        badge={mcpEnabled ? "Enabled" : "Disabled"}
        badgeClass={mcpEnabled ? "accent-soft" : ""}
      >
        <div style={{ display: "grid", gap: ".65rem" }}>
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
      </SettingsDropdown>

      {/* Body Profile */}
      <SettingsDropdown
        title="Body Profile"
        subtitle="Height, measurement units (metric/imperial) & personal goals"
        badge={tracker.settings.units === "imperial" ? "Imperial" : "Metric"}
      >
        <form onSubmit={submitProfile} method="post">
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
      </SettingsDropdown>

      <Passkeys onMessage={onMessage} />

      {/* Data Export & Account */}
      <SettingsDropdown
        title="Your Data & Account"
        subtitle="Export JSON/CSV backups, sign out, or delete account"
        badge="Account"
      >
        <div className="button-row">
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
      </SettingsDropdown>
    </>
  );
}

function SettingsDropdown({
  id,
  title,
  subtitle,
  badge,
  badgeClass = "",
  defaultOpen = false,
  children,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeClass?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="card settings-accordion" id={id} open={defaultOpen}>
      <summary className="settings-accordion-summary">
        <div className="settings-accordion-title">
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="settings-accordion-right">
          {badge && <span className={`pill ${badgeClass}`}>{badge}</span>}
          <ChevronDown size={18} className="settings-accordion-chevron" aria-hidden="true" />
        </div>
      </summary>
      <div className="settings-accordion-body">{children}</div>
    </details>
  );
}

function Passkeys({ onMessage }: { onMessage: (message: string) => void }) {
  const keys = authClient.useListPasskeys();
  return (
    <SettingsDropdown
      title="Passkeys"
      subtitle="Biometric & hardware security keys for passwordless sign-in"
      badge={keys.data ? `${keys.data.length} saved` : "Security"}
    >
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
    </SettingsDropdown>
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
