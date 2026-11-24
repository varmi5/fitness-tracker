"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Camera, Dumbbell, RefreshCw, Scale, Search, Sparkles, Utensils, X } from "lucide-react";
import { displayUnit, displayValue, metrics } from "../lib/metrics";
import type { FoodLibrary, GoogleIntegrationStatus, HevyIntegrationStatus, TrackerSnapshot } from "./types";

type QuickTab = "meal" | "workout" | "body";
type BodyMode = "weight" | "circumference" | "physique";

export type QuickLogSavedFood = FoodLibrary["saved"][number];

interface QuickLogModalProps {
  open: boolean;
  defaultDay: string;
  tracker: TrackerSnapshot;
  google: GoogleIntegrationStatus;
  hevy?: HevyIntegrationStatus;
  busy: boolean;
  onClose: () => void;
  onOpenMealComposer: (opts?: { openBarcode?: boolean }) => void;
  onQuickLogFood: (food: QuickLogSavedFood, day: string) => Promise<boolean>;
  onSaveTracker: (action: object, successMessage: string) => Promise<void>;
  onSyncHevy: () => Promise<void>;
  onSyncGoogle: () => Promise<void>;
  onOpenTraining: () => void;
  onOpenPhysiqueCheckin: () => void;
  onOpenSettings: () => void;
}

export function QuickLogModal({
  open,
  defaultDay,
  tracker,
  google,
  hevy,
  busy,
  onClose,
  onOpenMealComposer,
  onQuickLogFood,
  onSaveTracker,
  onSyncHevy,
  onSyncGoogle,
  onOpenTraining,
  onOpenPhysiqueCheckin,
  onOpenSettings,
}: QuickLogModalProps) {
  const [tab, setTab] = useState<QuickTab>("meal");
  const [bodyMode, setBodyMode] = useState<BodyMode>("weight");
  const [query, setQuery] = useState("");
  const [foods, setFoods] = useState<QuickLogSavedFood[]>([]);
  const [loadingFoods, setLoadingFoods] = useState(false);
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [weightInput, setWeightInput] = useState("");
  const [mcpHintOpen, setMcpHintOpen] = useState(false);

  const units = tracker.settings.units;
  const weightMetric = metrics.find((m) => m.key === "weight")!;

  useEffect(() => {
    if (!open || tab !== "meal") return;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoadingFoods(true);
      fetch(`/api/nutrition?library=${encodeURIComponent(query.trim())}`, { cache: "no-store" })
        .then(async (res) => (res.ok ? ((await res.json()) as FoodLibrary) : null))
        .then((lib) => {
          if (active && lib) setFoods(lib.saved.slice(0, 8));
        })
        .catch(() => undefined)
        .finally(() => {
          if (active) setLoadingFoods(false);
        });
    }, query ? 180 : 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [open, tab, query]);

  if (!open) return null;

  async function handleQuickFood(food: QuickLogSavedFood) {
    setLoggingId(food.id);
    try {
      const ok = await onQuickLogFood(food, defaultDay);
      if (ok) onClose();
    } finally {
      setLoggingId(null);
    }
  }

  async function submitWeight(e: FormEvent) {
    e.preventDefault();
    const raw = Number(weightInput.replace(",", "."));
    if (!Number.isFinite(raw) || raw <= 0) return;
    const kg = raw / displayValue(1, weightMetric, units);
    await onSaveTracker(
      { action: "log", data: { date: defaultDay, values: [{ key: "weight", value: kg }], note: "" } },
      "Weight saved.",
    );
    setWeightInput("");
    onClose();
  }

  async function submitCircumference(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const keys = ["waist", "chest", "left-bicep", "right-bicep"] as const;
    const values = keys.flatMap((key) => {
      const metric = metrics.find((m) => m.key === key)!;
      const raw = String(form.get(key) ?? "").trim();
      if (!raw) return [];
      const parsed = Number(raw.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed <= 0) return [];
      return [{ key, value: parsed / displayValue(1, metric, units) }];
    });
    if (!values.length) return;
    await onSaveTracker(
      { action: "log", data: { date: defaultDay, values, note: "" } },
      "Measurements saved.",
    );
    onClose();
  }

  return (
    <dialog className="modal-backdrop" open aria-label="Quick Log" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-sheet" style={{ maxHeight: "88dvh", height: "auto" }}>
        <div className="modal-top">
          <div className="sheet-grabber" />
          <div className="split-row modal-header">
            <h2>Quick Log · {defaultDay}</h2>
            <button type="button" className="secondary icon-btn modal-close-btn" aria-label="Close quick log" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
          <div className="segmented" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }} role="tablist" aria-label="Quick log category">
            {(
              [
                ["meal", "Meal"],
                ["workout", "Workout"],
                ["body", "Body"],
              ] as [QuickTab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? "active" : ""}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="modal-body">
          {tab === "meal" && (
            <>
              <div className="search-field-row">
                <Search size={16} style={{ position: "absolute", left: "12px", color: "var(--muted)", pointerEvents: "none" }} />
                <input
                  type="search"
                  placeholder="Search saved foods & meals…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{ paddingLeft: "2.25rem" }}
                />
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: ".45rem" }}>
                <button
                  type="button"
                  className="compact"
                  onClick={() => {
                    onClose();
                    onOpenMealComposer();
                  }}
                >
                  <Utensils size={14} /> Full Meal Composer
                </button>
                <button
                  type="button"
                  className="secondary compact"
                  onClick={() => {
                    onClose();
                    onOpenMealComposer({ openBarcode: true });
                  }}
                >
                  <Camera size={14} /> Barcode Scan
                </button>
                <button
                  type="button"
                  className="secondary compact"
                  onClick={() => setMcpHintOpen((v) => !v)}
                >
                  <Sparkles size={14} /> ChatGPT MCP
                </button>
              </div>

              {mcpHintOpen && (
                <div className="bevel-awaiting-strip" style={{ flexDirection: "column", alignItems: "flex-start" }}>
                  <span>Send a meal photo to your connected ChatGPT MCP connector to auto-score &amp; log directly.</span>
                  <button
                    type="button"
                    className="secondary compact"
                    style={{ minHeight: "30px", fontSize: ".74rem" }}
                    onClick={() => {
                      onClose();
                      onOpenSettings();
                    }}
                  >
                    View MCP Setup in Settings
                  </button>
                </div>
              )}

              <div style={{ display: "grid", gap: ".45rem" }}>
                <span className="eyebrow">1-Tap Frequent Foods</span>
                {loadingFoods ? (
                  <p className="empty" style={{ padding: ".8rem 0" }}>Loading saved foods…</p>
                ) : foods.length === 0 ? (
                  <p className="empty" style={{ padding: ".8rem 0" }}>
                    No saved foods matched. Use Full Meal Composer to search UK foods or add custom items.
                  </p>
                ) : (
                  <div className="quicklog-grid">
                    {foods.map((food) => (
                      <button
                        key={food.id}
                        type="button"
                        className="card card-interactive"
                        disabled={busy || loggingId === food.id}
                        style={{ padding: ".7rem .85rem", gap: ".2rem" }}
                        onClick={() => void handleQuickFood(food)}
                      >
                        <div className="split-row">
                          <strong style={{ fontSize: ".86rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {food.name}
                          </strong>
                          <span className="pill accent-soft" style={{ fontSize: ".68rem", padding: ".1rem .45rem" }}>
                            + Log
                          </span>
                        </div>
                        <div className="num" style={{ fontSize: ".74rem", color: "var(--muted)" }}>
                          {food.calories != null ? `${Math.round(food.calories)} kcal` : "—"}
                          {food.proteinG != null ? ` · P ${Math.round(food.proteinG)}g` : ""}
                          {food.carbsG != null ? ` · C ${Math.round(food.carbsG)}g` : ""}
                          {food.fatG != null ? ` · F ${Math.round(food.fatG)}g` : ""}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {tab === "workout" && (
            <div style={{ display: "grid", gap: ".6rem" }}>
              <button
                type="button"
                className="card card-interactive"
                disabled={busy || !hevy?.connected}
                onClick={() => {
                  void onSyncHevy();
                  onClose();
                }}
              >
                <div className="split-row">
                  <div>
                    <strong>Sync Hevy Strength</strong>
                    <p style={{ fontSize: ".78rem" }}>
                      {hevy?.connected ? "Pull latest strength sessions & muscular load" : "Connect Hevy in Settings to sync automatically"}
                    </p>
                  </div>
                  <Dumbbell size={18} style={{ color: "var(--accent)" }} />
                </div>
              </button>

              <button
                type="button"
                className="card card-interactive"
                disabled={busy || !google.connected}
                onClick={() => {
                  void onSyncGoogle();
                  onClose();
                }}
              >
                <div className="split-row">
                  <div>
                    <strong>Sync Google Health / Fitbit</strong>
                    <p style={{ fontSize: ".78rem" }}>
                      {google.connected ? "Refresh HR, cardio workouts, sleep & steps" : "Connect Google Health in Settings"}
                    </p>
                  </div>
                  <RefreshCw size={18} style={{ color: "var(--sleep-color)" }} />
                </div>
              </button>

              <button
                type="button"
                className="secondary"
                onClick={() => {
                  onClose();
                  onOpenTraining();
                }}
              >
                Open Training &amp; Strain
              </button>
            </div>
          )}

          {tab === "body" && (
            <div style={{ display: "grid", gap: ".75rem" }}>
              <div style={{ display: "flex", gap: ".45rem", flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={bodyMode === "weight" ? "compact" : "secondary compact"}
                  onClick={() => setBodyMode("weight")}
                >
                  <Scale size={14} /> Weight
                </button>
                <button
                  type="button"
                  className={bodyMode === "circumference" ? "compact" : "secondary compact"}
                  onClick={() => setBodyMode("circumference")}
                >
                  Circumference
                </button>
                <button
                  type="button"
                  className={bodyMode === "physique" ? "compact" : "secondary compact"}
                  onClick={() => {
                    onClose();
                    onOpenPhysiqueCheckin();
                  }}
                >
                  <Camera size={14} /> Physique Photo
                </button>
              </div>

              {bodyMode === "weight" && (
                <form onSubmit={(e) => void submitWeight(e)} className="card" style={{ gap: ".7rem" }}>
                  <label>
                    Body Weight ({displayUnit(weightMetric, units)})
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder={units === "metric" ? "e.g. 71.9" : "e.g. 158.5"}
                      value={weightInput}
                      onChange={(e) => setWeightInput(e.target.value)}
                      required
                    />
                  </label>
                  <button type="submit" disabled={busy}>
                    {busy ? "Saving…" : "Save Weight"}
                  </button>
                </form>
              )}

              {bodyMode === "circumference" && (
                <form onSubmit={(e) => void submitCircumference(e)} className="card" style={{ gap: ".7rem" }}>
                  <div className="input-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                    {(["waist", "chest", "left-bicep", "right-bicep"] as const).map((key) => {
                      const m = metrics.find((x) => x.key === key)!;
                      return (
                        <label key={key}>
                          {m.label} ({displayUnit(m, units)})
                          <input name={key} inputMode="decimal" placeholder="—" />
                        </label>
                      );
                    })}
                  </div>
                  <button type="submit" disabled={busy}>
                    {busy ? "Saving…" : "Save Circumferences"}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
