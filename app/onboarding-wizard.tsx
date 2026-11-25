"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Dumbbell,
  ExternalLink,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import {
  AppleHealthIcon,
  FitbitBrandIcon,
  GarminBrandIcon,
  ManualTdeeIcon,
} from "../components/icons";
import {
  ACTIVITY_LEVELS,
  buildChatGptTdeePrompt,
  CHATGPT_MCP_INSTRUCTIONS,
  estimateMifflinTdee,
} from "../lib/onboarding";
import { type TrackingMode } from "../lib/nutrition-model";
import { OpenWearablesGuide } from "./open-wearables-guide";
import type {
  GoogleIntegrationStatus,
  HevyIntegrationStatus,
  NutritionSettings,
  OpenWearablesIntegrationStatus,
  TrackerSnapshot,
} from "./types";

interface OnboardingWizardProps {
  open: boolean;
  userName?: string | null;
  today: string;
  tracker: TrackerSnapshot;
  settings: NutritionSettings;
  google: GoogleIntegrationStatus;
  openWearables?: OpenWearablesIntegrationStatus;
  hevy?: HevyIntegrationStatus;
  mcpEnabled: boolean;
  busy: boolean;
  onClose: () => void;
  onSaveTracker: (action: object, successMessage: string) => Promise<void>;
  onNutritionAction: (action: object, successMessage: string) => Promise<boolean>;
  onImportHevy?: (rawText: string) => Promise<boolean>;
  onCreateOpenWearablesInvite?: () => Promise<{ code: string; expiresAt: string | null; apiUrl: string | null } | null>;
  onMessage: (msg: string) => void;
}

const TOTAL_STEPS = 5;

function detectBrowserTimezone(fallback: string): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.includes("/") ? tz : fallback;
  } catch {
    return fallback;
  }
}

export function OnboardingWizard({
  open,
  userName,
  today,
  tracker,
  settings,
  google,
  openWearables,
  hevy,
  mcpEnabled,
  busy,
  onClose,
  onSaveTracker,
  onNutritionAction,
  onImportHevy,
  onCreateOpenWearablesInvite,
  onMessage,
}: OnboardingWizardProps) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Step 1: Source & TDEE
  const [sourceChoice, setSourceChoice] = useState<"apple" | "fitbit" | "other_wearable" | "manual">(
    openWearables?.connected && !google.connected
      ? openWearables.providers.some((p) => p !== "apple")
        ? "other_wearable"
        : "apple"
      : google.connected || settings.trackingMode === "fitbit"
        ? "fitbit"
        : "manual",
  );
  const trackingMode: TrackingMode = sourceChoice === "manual" ? "manual" : "fitbit";
  const [owInvite, setOwInvite] = useState<{ code: string; expiresAt: string | null; apiUrl: string | null } | null>(null);
  const [manualTdee, setManualTdee] = useState("");
  const [estWeight, setEstWeight] = useState("");
  const [estHeight, setEstHeight] = useState(
    tracker.settings.heightCm != null ? String(tracker.settings.heightCm) : "",
  );
  const [estAge, setEstAge] = useState("");
  const [estSex, setEstSex] = useState<"male" | "female" | "other">(
    tracker.settings.biologicalSex === "female"
      ? "female"
      : tracker.settings.biologicalSex === "male"
        ? "male"
        : "male",
  );
  const [estActivityId, setEstActivityId] = useState<string>("moderate");
  const [wearableNote, setWearableNote] = useState("");

  // Step 2: Goal & Profile
  const [bulkMode, setBulkMode] = useState(Boolean(settings.bulkMode));
  const [targetCalories, setTargetCalories] = useState(String(settings.targetToday || 2200));
  const [sleepGoalHours, setSleepGoalHours] = useState(
    String((settings.sleepGoalMinutes ?? 480) / 60),
  );
  const [timezone, setTimezone] = useState(() =>
    settings.targets.length === 0 && !settings.onboardingCompletedAt
      ? detectBrowserTimezone(settings.timezone)
      : settings.timezone,
  );
  const [heightCm, setHeightCm] = useState(
    tracker.settings.heightCm != null ? String(tracker.settings.heightCm) : "",
  );
  const [startingWeightKg, setStartingWeightKg] = useState("");
  const [birthDate, setBirthDate] = useState(tracker.settings.birthDate ?? "");
  const [biologicalSex, setBiologicalSex] = useState(tracker.settings.biologicalSex ?? "");
  const [units, setUnits] = useState<"metric" | "imperial">(
    tracker.settings.units === "imperial" ? "imperial" : "metric",
  );

  // Sync estimator weight/height into Step 2 when user opens/edits Step 1
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSourceChoice(
      openWearables?.connected && !google.connected
        ? openWearables.providers.some((p) => p !== "apple")
          ? "other_wearable"
          : "apple"
        : google.connected || settings.trackingMode === "fitbit"
          ? "fitbit"
          : "manual",
    );
    setBulkMode(Boolean(settings.bulkMode));
    setTargetCalories(String(settings.targetToday || 2200));
    setSleepGoalHours(String((settings.sleepGoalMinutes ?? 480) / 60));
    setTimezone(
      settings.targets.length === 0 && !settings.onboardingCompletedAt
        ? detectBrowserTimezone(settings.timezone)
        : settings.timezone,
    );
    setHeightCm(tracker.settings.heightCm != null ? String(tracker.settings.heightCm) : "");
    setBirthDate(tracker.settings.birthDate ?? "");
    setBiologicalSex(tracker.settings.biologicalSex ?? "");
    setUnits(tracker.settings.units === "imperial" ? "imperial" : "metric");
  }, [open, google.connected, openWearables?.connected, settings.trackingMode, settings.bulkMode, settings.targetToday, settings.sleepGoalMinutes, settings.timezone, settings.targets.length, settings.onboardingCompletedAt, tracker.settings.heightCm, tracker.settings.birthDate, tracker.settings.biologicalSex, tracker.settings.units]);

  const selectedActivity = useMemo(
    () => ACTIVITY_LEVELS.find((a) => a.id === estActivityId) ?? ACTIVITY_LEVELS[2],
    [estActivityId],
  );

  const tdeeEstimate = useMemo(() => {
    const w = Number(estWeight || startingWeightKg);
    const h = Number(estHeight || heightCm);
    const age = Number(estAge);
    return estimateMifflinTdee({
      weightKg: w,
      heightCm: h,
      ageYears: age,
      sex: estSex,
      activityMultiplier: selectedActivity.multiplier,
    });
  }, [estWeight, startingWeightKg, estHeight, heightCm, estAge, estSex, selectedActivity.multiplier]);

  const chatGptTdeePrompt = useMemo(
    () =>
      buildChatGptTdeePrompt({
        weightKg: estWeight || startingWeightKg,
        heightCm: estHeight || heightCm,
        ageYears: estAge,
        sex: estSex,
        activityLabel: `${selectedActivity.label} (${selectedActivity.detail})`,
        goal: bulkMode ? "bulk" : "cut",
        wearableNote,
      }),
    [estWeight, startingWeightKg, estHeight, heightCm, estAge, estSex, selectedActivity, bulkMode, wearableNote],
  );

  const mcpUrl = typeof window !== "undefined" ? `${window.location.origin}/mcp` : "/mcp";
  const parsedManualTdee = Number(manualTdee);
  const hasValidManualTdee = Number.isFinite(parsedManualTdee) && parsedManualTdee >= 800 && parsedManualTdee <= 10000;

  if (!open) return null;

  async function handleSkipSetup() {
    setSaving(true);
    try {
      await onNutritionAction(
        { action: "preferences", data: { onboardingCompleted: true } },
        "Setup skipped — reopen anytime in Settings.",
      );
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleConnectGoogleBeforeRedirect(href: string) {
    setSaving(true);
    try {
      await onNutritionAction(
        {
          action: "preferences",
          data: {
            trackingMode: "fitbit",
            preferredEnergySource: "google",
            timezone: timezone.trim() || settings.timezone,
          },
        },
        "Fitbit / Google Health mode selected.",
      );
    } finally {
      setSaving(false);
      window.location.href = href;
    }
  }

  async function handleSaveStep2AndContinue() {
    const cal = Math.round(Number(targetCalories));
    if (!Number.isInteger(cal) || cal < 500 || cal > 15000) {
      onMessage("Enter a daily calorie target between 500 and 15,000 kcal.");
      return;
    }
    const sleepMins = Math.round(Number(sleepGoalHours) * 60);
    if (!Number.isFinite(sleepMins) || sleepMins < 240 || sleepMins > 720) {
      onMessage("Enter a sleep goal between 4 and 12 hours.");
      return;
    }

    const parsedWeight = startingWeightKg.trim() ? Number(startingWeightKg) : null;
    if (parsedWeight != null && (!Number.isFinite(parsedWeight) || parsedWeight <= 20 || parsedWeight > 400)) {
      onMessage("Enter a valid weight in kg or leave it blank.");
      return;
    }

    const parsedHeight = heightCm.trim() ? Number(heightCm) : null;
    if (parsedHeight != null && (!Number.isFinite(parsedHeight) || parsedHeight < 50 || parsedHeight > 280)) {
      onMessage("Enter a valid height in cm or leave it blank.");
      return;
    }

    setSaving(true);
    try {
      const prefOk = await onNutritionAction(
        {
          action: "preferences",
          data: {
            timezone: timezone.trim() || settings.timezone,
            trackingMode,
            preferredEnergySource: trackingMode === "fitbit" ? "google" : "manual",
            bulkMode,
            sleepGoalMinutes: sleepMins,
            sleepGoalEffectiveFrom: today,
          },
        },
        "Tracking preferences saved.",
      );
      if (!prefOk) return;

      const targetOk = await onNutritionAction(
        { action: "target", data: { effectiveFrom: today, calories: cal } },
        "Calorie target saved.",
      );
      if (!targetOk) return;

      let loggedWeightViaEnergy = false;
      if (trackingMode === "manual" && hasValidManualTdee) {
        loggedWeightViaEnergy = parsedWeight != null;
        await onNutritionAction(
          {
            action: "energy",
            data: {
              day: today,
              source: "manual",
              totalKcal: Math.round(parsedManualTdee),
              weightKg: parsedWeight,
              complete: true,
            },
          },
          "Today's TDEE saved.",
        );
      }

      if (parsedHeight != null || birthDate.trim() || biologicalSex || units !== tracker.settings.units) {
        await onSaveTracker(
          {
            action: "settings",
            data: {
              heightCm: parsedHeight,
              units,
              goals: tracker.settings.goals,
              birthDate: birthDate.trim() || null,
              biologicalSex:
                biologicalSex === "male" || biologicalSex === "female" ? biologicalSex : null,
            },
          },
          "Body profile saved.",
        );
      }

      if (parsedWeight != null && !loggedWeightViaEnergy) {
        await onSaveTracker(
          {
            action: "add",
            data: {
              metric: "weight",
              side: "none",
              value: parsedWeight,
              date: today,
              note: "Onboarding starting weight",
            },
          },
          "Starting weight logged.",
        );
      }

      setStep(3);
    } finally {
      setSaving(false);
    }
  }

  async function handleFinishOnboarding() {
    setSaving(true);
    try {
      await onNutritionAction(
        { action: "preferences", data: { onboardingCompleted: true } },
        "Welcome to FitnessTrackr — you're all set!",
      );
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleHevyFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !onImportHevy) return;
    const text = await file.text();
    await onImportHevy(text);
  }

  return (
    <div className="silk-overlay" role="dialog" aria-modal="true" aria-label="FitnessTrackr Setup Walkthrough">
      <div className="silk-overlay-inner onboarding-sheet">
        {/* Top Bar */}
        <div className="split-row" style={{ alignItems: "center", gap: ".5rem" }}>
          <span className="pill accent-soft num">Step {step} of {TOTAL_STEPS}</span>
          <strong style={{ fontSize: ".95rem", flex: 1, textAlign: "center" }}>
            {userName ? `Welcome, ${userName.split(" ")[0]}` : "Account Setup"}
          </strong>
          <button
            type="button"
            className="secondary compact"
            disabled={busy || saving}
            onClick={() => void handleSkipSetup()}
          >
            <X size={14} /> Skip setup
          </button>
        </div>

        <div className="onboarding-progress-track" aria-hidden="true">
          <div
            className="onboarding-progress-fill"
            style={{ width: `${Math.round((step / TOTAL_STEPS) * 100)}%` }}
          />
        </div>

        {/* STEP 1: Watch / TDEE */}
        {step === 1 && (
          <section className="card" style={{ display: "grid", gap: ".85rem" }}>
            <div>
              <h2>1. Connect your watch</h2>
              <p style={{ fontSize: ".82rem", marginTop: ".2rem" }}>
                Pick what you wear, or track manually.
              </p>
            </div>

            <div className="onboarding-choice-grid">
              <button
                type="button"
                className={`onboarding-choice${sourceChoice === "apple" ? " is-active" : ""}`}
                onClick={() => setSourceChoice("apple")}
              >
                <div className="onboarding-choice-row">
                  <span className="onboarding-choice-title">
                    <span className="device-logo-tile" aria-hidden="true">
                      <AppleHealthIcon size={21} />
                    </span>
                    Apple Watch / Health
                  </span>
                  {openWearables?.connected && <span className="pill teal-soft">Connected</span>}
                </div>
                <p>Sleep, HRV, workouts &amp; steps</p>
              </button>

              <button
                type="button"
                className={`onboarding-choice${sourceChoice === "fitbit" ? " is-active" : ""}`}
                onClick={() => setSourceChoice("fitbit")}
              >
                <div className="onboarding-choice-row">
                  <span className="onboarding-choice-title">
                    <span className="device-logo-tile" aria-hidden="true">
                      <FitbitBrandIcon size={21} />
                    </span>
                    Fitbit / Google Health
                  </span>
                  {google.connected && <span className="pill teal-soft">Connected</span>}
                </div>
                <p>TDEE, sleep, vitals &amp; meal sync</p>
              </button>

              <button
                type="button"
                className={`onboarding-choice${sourceChoice === "other_wearable" ? " is-active" : ""}`}
                onClick={() => setSourceChoice("other_wearable")}
              >
                <div className="onboarding-choice-row">
                  <span className="onboarding-choice-title">
                    <span className="device-logo-tile" aria-hidden="true">
                      <GarminBrandIcon size={21} />
                    </span>
                    Garmin, Oura &amp; Android
                  </span>
                  {openWearables?.connected && <span className="pill teal-soft">Connected</span>}
                </div>
                <p>Health Connect, Whoop &amp; Strava</p>
              </button>

              <button
                type="button"
                className={`onboarding-choice${sourceChoice === "manual" ? " is-active" : ""}`}
                onClick={() => setSourceChoice("manual")}
              >
                <div className="onboarding-choice-row">
                  <span className="onboarding-choice-title">
                    <span className="device-logo-tile" aria-hidden="true">
                      <ManualTdeeIcon size={21} />
                    </span>
                    No watch / Manual TDEE
                  </span>
                  {sourceChoice === "manual" && <span className="pill accent-soft">Selected</span>}
                </div>
                <p>Quick calorie calculator</p>
              </button>
            </div>

            {sourceChoice === "fitbit" && (
              <div className="card" style={{ background: "var(--surface-soft)", display: "grid", gap: ".6rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: ".55rem" }}>
                  <span className="device-logo-tile" aria-hidden="true">
                    <FitbitBrandIcon size={21} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ fontSize: ".88rem", display: "block" }}>Fitbit / Google Health</strong>
                    <span style={{ fontSize: ".76rem", color: "var(--muted)" }}>
                      One-tap Google sign-in syncs TDEE, sleep, HRV &amp; workouts.
                    </span>
                  </div>
                </div>
                {google.connected ? (
                  <div className="pill teal-soft" style={{ justifySelf: "start" }}>
                    <CheckCircle2 size={14} /> Connected{google.accountLabel ? ` · ${google.accountLabel}` : ""}
                  </div>
                ) : google.available ? (
                  <button
                    type="button"
                    className="unlock-btn"
                    disabled={saving || busy}
                    onClick={() => void handleConnectGoogleBeforeRedirect("/api/integrations/google/connect?write=1")}
                  >
                    Connect Google Health
                  </button>
                ) : (
                  <p style={{ fontSize: ".77rem", margin: 0 }}>
                    Google OAuth isn’t enabled on this server yet — use Manual TDEE or Settings import instead.
                  </p>
                )}
              </div>
            )}

            {(sourceChoice === "apple" || sourceChoice === "other_wearable") && (
              <div className="card" style={{ background: "var(--surface-soft)", display: "grid", gap: ".6rem", minWidth: 0 }}>
                <OpenWearablesGuide
                  openWearables={openWearables}
                  invite={owInvite}
                  busy={saving || busy}
                  compact
                  initialPlatform={sourceChoice === "apple" ? "apple" : "cloud"}
                  hideTabs={sourceChoice === "apple"}
                  onGenerateInvite={
                    onCreateOpenWearablesInvite
                      ? async () => {
                          const invite = await onCreateOpenWearablesInvite();
                          if (invite) setOwInvite(invite);
                        }
                      : undefined
                  }
                  onMessage={onMessage}
                />
                {!openWearables?.available && (
                  <p style={{ fontSize: ".77rem", margin: 0 }}>
                    Live sync isn’t configured on this host yet — you can continue manually for now.
                  </p>
                )}
              </div>
            )}

            {sourceChoice === "manual" && (
              <div style={{ display: "grid", gap: ".8rem" }}>
                <label>
                  Estimated Maintenance TDEE (kcal/day, optional)
                  <input
                    inputMode="numeric"
                    value={manualTdee}
                    onChange={(e) => setManualTdee(e.target.value)}
                    placeholder="e.g. 2450"
                  />
                </label>

                <details className="card" style={{ background: "var(--surface-soft)", padding: ".85rem" }} open>
                  <summary style={{ fontWeight: 650, fontSize: ".86rem", cursor: "pointer" }}>
                    Built-in TDEE Calculator (Mifflin-St Jeor)
                  </summary>
                  <div style={{ display: "grid", gap: ".65rem", marginTop: ".65rem" }}>
                    <div className="input-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                      <label>
                        Sex
                        <select value={estSex} onChange={(e) => setEstSex(e.target.value as "male" | "female" | "other")}>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                          <option value="other">Other / Neutral</option>
                        </select>
                      </label>
                      <label>
                        Age (years)
                        <input
                          type="number"
                          inputMode="numeric"
                          min={13}
                          max={100}
                          value={estAge}
                          onChange={(e) => setEstAge(e.target.value)}
                          placeholder="e.g. 25"
                        />
                      </label>
                      <label>
                        Height (cm)
                        <input
                          type="number"
                          inputMode="decimal"
                          min={100}
                          max={250}
                          value={estHeight}
                          onChange={(e) => {
                            setEstHeight(e.target.value);
                            setHeightCm(e.target.value);
                          }}
                          placeholder="e.g. 175"
                        />
                      </label>
                      <label>
                        Weight (kg)
                        <input
                          type="number"
                          inputMode="decimal"
                          min={25}
                          max={350}
                          value={estWeight}
                          onChange={(e) => {
                            setEstWeight(e.target.value);
                            setStartingWeightKg(e.target.value);
                          }}
                          placeholder="e.g. 74"
                        />
                      </label>
                    </div>
                    <label>
                      Activity Level
                      <select value={estActivityId} onChange={(e) => setEstActivityId(e.target.value)}>
                        {ACTIVITY_LEVELS.map((lvl) => (
                          <option key={lvl.id} value={lvl.id}>
                            {lvl.label} ({lvl.detail})
                          </option>
                        ))}
                      </select>
                    </label>
                    {tdeeEstimate ? (
                      <div className="split-row" style={{ gap: ".5rem", flexWrap: "wrap" }}>
                        <span style={{ fontSize: ".8rem" }}>
                          Est. BMR <strong className="num">{tdeeEstimate.bmr}</strong> · Maintenance{" "}
                          <strong className="num">{tdeeEstimate.tdee} kcal/day</strong>
                        </span>
                        <button
                          type="button"
                          className="compact"
                          onClick={() => {
                            setManualTdee(String(tdeeEstimate.tdee));
                            const suggested = bulkMode
                              ? tdeeEstimate.tdee + 250
                              : Math.max(1200, tdeeEstimate.tdee - 400);
                            setTargetCalories(String(suggested));
                            onMessage(`Applied ${tdeeEstimate.tdee} kcal maintenance TDEE.`);
                          }}
                        >
                          Use ~{tdeeEstimate.tdee} kcal
                        </button>
                      </div>
                    ) : (
                      <p style={{ fontSize: ".76rem" }}>Fill in age, height, and weight to preview your maintenance TDEE.</p>
                    )}
                  </div>
                </details>

                <details className="card" style={{ background: "var(--surface-soft)", padding: ".85rem" }}>
                  <summary style={{ fontWeight: 650, fontSize: ".86rem", cursor: "pointer" }}>
                    Using Apple Health, Garmin, or ChatGPT to find your TDEE?
                  </summary>
                  <div style={{ display: "grid", gap: ".6rem", marginTop: ".65rem" }}>
                    <p style={{ fontSize: ".79rem" }}>
                      <strong>Apple Health tip:</strong> Open Health → Browse → Activity and add your 7-day average{" "}
                      <em>Resting Energy</em> + <em>Active Energy</em>, use an{" "}
                      <a href="https://tdeecalculator.net/" target="_blank" rel="noreferrer">
                        online TDEE Calculator <ExternalLink size={12} style={{ display: "inline" }} />
                      </a>
                      , or paste this tailored prompt into ChatGPT:
                    </p>
                    <label>
                      Optional wearable / training note (added to prompt)
                      <input
                        value={wearableNote}
                        onChange={(e) => setWearableNote(e.target.value)}
                        placeholder="e.g. Apple Watch avg 1,720 resting + 540 active kcal, 4 gym days"
                      />
                    </label>
                    <pre className="prompt-preview-box">{chatGptTdeePrompt}</pre>
                    <button
                      type="button"
                      className="secondary compact"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(chatGptTdeePrompt);
                          onMessage("ChatGPT TDEE prompt copied.");
                        } catch {
                          onMessage("Copy blocked — select the prompt text above.");
                        }
                      }}
                    >
                      <Copy size={14} /> Copy ChatGPT TDEE Prompt
                    </button>
                  </div>
                </details>
              </div>
            )}

            <div className="split-row" style={{ justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setStep(2)}>
                Next: Goals &amp; Profile <ChevronRight size={16} />
              </button>
            </div>
          </section>
        )}

        {/* STEP 2: Goal, Calorie Target & Profile */}
        {step === 2 && (
          <section className="card" style={{ display: "grid", gap: ".9rem" }}>
            <div>
              <h2>2. Set Your Goal, Calories &amp; Profile</h2>
              <p style={{ fontSize: ".83rem", marginTop: ".25rem" }}>
                Your calorie target automatically balances daily Protein, Fibre, Carbs &amp; Fat, and can be edited anytime in Settings.
              </p>
            </div>

            <div className="segments" role="group" aria-label="Goal mode">
              <button
                type="button"
                aria-pressed={!bulkMode}
                onClick={() => {
                  setBulkMode(false);
                  if (hasValidManualTdee) setTargetCalories(String(Math.max(1200, Math.round(parsedManualTdee - 400))));
                }}
              >
                Cut / Fat Loss (under = green)
              </button>
              <button
                type="button"
                aria-pressed={bulkMode}
                onClick={() => {
                  setBulkMode(true);
                  if (hasValidManualTdee) setTargetCalories(String(Math.round(parsedManualTdee + 250)));
                }}
              >
                Lean Bulk (over = green)
              </button>
            </div>

            {hasValidManualTdee && (
              <div style={{ display: "grid", gap: ".35rem" }}>
                <span style={{ fontSize: ".76rem", color: "var(--muted)" }}>
                  Quick target from your <strong className="num">{Math.round(parsedManualTdee)} kcal</strong> maintenance:
                </span>
                <div className="button-row">
                  {[
                    { label: "-500 Cut", delta: -500, bulk: false },
                    { label: "-300 Mild", delta: -300, bulk: false },
                    { label: "Maintain", delta: 0, bulk: false },
                    { label: "+250 Bulk", delta: 250, bulk: true },
                  ].map((preset) => {
                    const nextCal = Math.max(1200, Math.round(parsedManualTdee + preset.delta));
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        className="secondary compact"
                        onClick={() => {
                          setBulkMode(preset.bulk);
                          setTargetCalories(String(nextCal));
                        }}
                      >
                        {preset.label} ({nextCal})
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="input-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <label>
                Daily Calorie Target (kcal)
                <input
                  type="number"
                  inputMode="numeric"
                  min={500}
                  max={15000}
                  value={targetCalories}
                  onChange={(e) => setTargetCalories(e.target.value)}
                  required
                />
              </label>
              <label>
                Sleep Goal (hours)
                <input
                  type="number"
                  inputMode="decimal"
                  min={4}
                  max={12}
                  step="0.25"
                  value={sleepGoalHours}
                  onChange={(e) => setSleepGoalHours(e.target.value)}
                  required
                />
              </label>
              <label>
                Height (cm, optional)
                <input
                  type="number"
                  inputMode="decimal"
                  min={50}
                  max={280}
                  step="0.1"
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                  placeholder="e.g. 175"
                />
              </label>
              <label>
                Current Weight (kg, optional)
                <input
                  type="number"
                  inputMode="decimal"
                  min={20}
                  max={400}
                  step="0.1"
                  value={startingWeightKg}
                  onChange={(e) => setStartingWeightKg(e.target.value)}
                  placeholder="e.g. 74.0"
                />
              </label>
              <label>
                Birth Date (optional)
                <input type="date" max={today} value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
              </label>
              <label>
                Biological Sex (optional)
                <select value={biologicalSex} onChange={(e) => setBiologicalSex(e.target.value)}>
                  <option value="">Prefer not to say</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </label>
              <label>
                Units
                <select value={units} onChange={(e) => setUnits(e.target.value as "metric" | "imperial")}>
                  <option value="metric">Metric (kg, cm)</option>
                  <option value="imperial">Imperial (lb, in)</option>
                </select>
              </label>
              <label>
                Timezone (IANA)
                <input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Europe/London" />
              </label>
            </div>

            <div className="split-row" style={{ gap: ".5rem" }}>
              <button type="button" className="secondary" disabled={saving || busy} onClick={() => setStep(1)}>
                <ChevronLeft size={16} /> Back
              </button>
              <button type="button" disabled={saving || busy} onClick={() => void handleSaveStep2AndContinue()}>
                {saving ? "Saving…" : "Save & Continue"} <ChevronRight size={16} />
              </button>
            </div>
          </section>
        )}

        {/* STEP 3: Hevy Strength Integration */}
        {step === 3 && (
          <section className="card" style={{ display: "grid", gap: ".9rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
              <Dumbbell size={19} />
              <h2>3. Connect Strength Training (Hevy)</h2>
            </div>
            <p style={{ fontSize: ".83rem" }}>
              Hevy powers your <strong>Muscle Training Map</strong>, working-set counts, and Muscular Load score (pairing automatically with wearable HR when Fitbit is linked).
            </p>

            {hevy?.connected ? (
              <div className="pill teal-soft" style={{ justifySelf: "start" }}>
                <CheckCircle2 size={14} /> Connected{hevy.accountLabel ? ` · ${hevy.accountLabel}` : ""} ({hevy.workoutCount} workouts)
              </div>
            ) : (
              <div style={{ display: "grid", gap: ".65rem" }}>
                {hevy?.oauthAvailable && (
                  <a className="unlock-btn" href="/api/integrations/hevy/connect">
                    Connect Hevy Account
                  </a>
                )}
                {onImportHevy && (
                  <div className="card" style={{ background: "var(--surface-soft)", display: "grid", gap: ".55rem" }}>
                    <strong style={{ fontSize: ".84rem" }}>Or upload a Hevy CSV / JSON export (works on Hevy Free)</strong>
                    <p style={{ fontSize: ".77rem" }}>
                      In Hevy: <strong>Profile → Settings → Export Data</strong>, then select the file below.
                    </p>
                    <label className="drop-zone">
                      <span style={{ display: "inline-flex", alignItems: "center", gap: ".4rem", fontSize: ".82rem" }}>
                        <Upload size={15} /> Choose Hevy .csv or .json file
                      </span>
                      <input type="file" accept=".csv,.json,text/csv,application/json" onChange={(e) => void handleHevyFile(e)} />
                    </label>
                  </div>
                )}
              </div>
            )}

            <div className="split-row" style={{ gap: ".5rem" }}>
              <button type="button" className="secondary" onClick={() => setStep(2)}>
                <ChevronLeft size={16} /> Back
              </button>
              <button type="button" onClick={() => setStep(4)}>
                {hevy?.connected ? "Continue" : "Skip / Continue"} <ChevronRight size={16} />
              </button>
            </div>
          </section>
        )}

        {/* STEP 4: ChatGPT MCP Connector */}
        {step === 4 && (
          <section className="card" style={{ display: "grid", gap: ".9rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
              <Sparkles size={19} />
              <h2>4. Connect ChatGPT AI Coach (MCP)</h2>
            </div>
            <p style={{ fontSize: ".83rem" }}>
              Log meals directly from food photos in ChatGPT and ask questions about your sleep, calories, and workouts.
              {!mcpEnabled && " (Note: MCP is currently disabled on this server until enabled by the host.)"}
            </p>

            <div style={{ display: "grid", gap: ".45rem", minWidth: 0 }}>
              <span style={{ fontSize: ".78rem", fontWeight: 620 }}>Your Private MCP Server URL</span>
              <div className="mono-box">{mcpUrl}</div>
              <button
                type="button"
                className="secondary compact"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(mcpUrl);
                    onMessage("MCP URL copied.");
                  } catch {
                    onMessage("Copy blocked — select the URL above.");
                  }
                }}
              >
                <Copy size={14} /> Copy MCP URL
              </button>
            </div>

            <ol className="connector-steps">
              <li>
                Open{" "}
                <a href="https://chatgpt.com/plugins" target="_blank" rel="noreferrer">
                  ChatGPT on the web
                </a>{" "}
                and go to <strong>Apps / Connectors → Add custom MCP server</strong>.
              </li>
              <li>
                Paste <code>{mcpUrl}</code>, pick <strong>OAuth</strong>, and sign in to your FitnessTrackr account.
              </li>
              <li>
                Approve read/write permissions, then enable <strong>FitnessTrackr</strong> inside any web or mobile chat.
              </li>
            </ol>

            <div style={{ display: "grid", gap: ".45rem" }}>
              <button
                type="button"
                className="secondary compact"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(CHATGPT_MCP_INSTRUCTIONS);
                    onMessage("ChatGPT custom instructions copied.");
                  } catch {
                    onMessage("Copy blocked — see Settings → ChatGPT Server.");
                  }
                }}
              >
                <Copy size={14} /> Copy ChatGPT Meal-Logging Instructions
              </button>
              <a href="/connect" target="_blank" rel="noreferrer" style={{ fontSize: ".8rem" }}>
                Open full ChatGPT connection guide ↗
              </a>
            </div>

            <div className="split-row" style={{ gap: ".5rem" }}>
              <button type="button" className="secondary" onClick={() => setStep(3)}>
                <ChevronLeft size={16} /> Back
              </button>
              <button type="button" onClick={() => setStep(5)}>
                Continue <ChevronRight size={16} />
              </button>
            </div>
          </section>
        )}

        {/* STEP 5: Ready Summary */}
        {step === 5 && (
          <section className="card" style={{ display: "grid", gap: ".9rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
              <CheckCircle2 size={20} style={{ color: "var(--teal)" }} />
              <h2>5. You’re All Set!</h2>
            </div>

            <div className="onboarding-checklist">
              <div className="list-item">
                <span>Tracking mode</span>
                <strong>
                  {sourceChoice === "apple"
                    ? "Apple Watch / Apple Health"
                    : sourceChoice === "other_wearable"
                      ? "Garmin / Oura / Health Connect"
                      : sourceChoice === "fitbit"
                        ? "Fitbit / Google Health"
                        : "Manual TDEE"}
                </strong>
              </div>
              <div className="list-item">
                <span>Daily goal</span>
                <strong className="num">
                  {Number(targetCalories || 2200).toLocaleString("en-GB")} kcal · {bulkMode ? "Lean Bulk" : "Cut / Deficit"}
                </strong>
              </div>
              <div className="list-item">
                <span>Sleep goal</span>
                <strong className="num">{sleepGoalHours}h / night</strong>
              </div>
              <div className="list-item">
                <span>Wearable link</span>
                <strong>
                  {google.connected && openWearables?.connected
                    ? "Google Health + Open Wearables"
                    : google.connected
                      ? "Google Health connected"
                      : openWearables?.connected
                        ? `Open Wearables (${openWearables.accountLabel || "Connected"})`
                        : trackingMode === "fitbit"
                          ? "Link in Settings anytime"
                          : "Manual mode"}
                </strong>
              </div>
              <div className="list-item">
                <span>Hevy strength</span>
                <strong>{hevy?.connected ? `Connected (${hevy.workoutCount} workouts)` : "Optional · CSV or OAuth in Settings"}</strong>
              </div>
              <div className="list-item">
                <span>ChatGPT MCP</span>
                <strong>{mcpEnabled ? "Ready to link via /mcp" : "Disabled by host"}</strong>
              </div>
            </div>

            <p style={{ fontSize: ".79rem" }}>
              <strong>iPhone tip:</strong> Tap Share → <em>Add to Home Screen</em> in Safari to use FitnessTrackr like a native app and enable meal/weigh-in push reminders in Settings.
            </p>

            <div className="split-row" style={{ gap: ".5rem" }}>
              <button type="button" className="secondary" disabled={saving || busy} onClick={() => setStep(4)}>
                <ChevronLeft size={16} /> Back
              </button>
              <button type="button" disabled={saving || busy} onClick={() => void handleFinishOnboarding()}>
                {saving ? "Finishing…" : "Finish Setup"}
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
