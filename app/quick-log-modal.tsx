"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Camera, Dumbbell, History, RefreshCw, Scale, Search, Sparkles, Utensils, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { displayUnit, displayValue, metrics } from "../lib/metrics";
import type { FoodLibrary, GoogleIntegrationStatus, HevyIntegrationStatus, TrackerSnapshot } from "./types";

type QuickTab = "actions" | "meal" | "workout" | "body";
type BodyMode = "weight" | "circumference" | "physique";

export type QuickLogSavedFood = FoodLibrary["saved"][number];

interface QuickLogModalProps {
  open: boolean;
  defaultDay: string;
  mcpConnected: boolean | null;
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
  mcpConnected,
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
  const [tab, setTab] = useState<QuickTab>("actions");
  const [bodyMode, setBodyMode] = useState<BodyMode>("weight");
  const [query, setQuery] = useState("");
  const [foods, setFoods] = useState<QuickLogSavedFood[]>([]);
  const [loadingFoods, setLoadingFoods] = useState(false);
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [weightInput, setWeightInput] = useState("");

  const content = useRef<HTMLDivElement>(null);
  const handingOff = useRef(false);
  useEffect(() => {
    if (!open) return;
    setTab("actions"); handingOff.current = false;
    const viewport = window.visualViewport;
    let frame = 0;
    const resize = () => {
      frame = 0;
      const height = viewport?.height ?? window.innerHeight;
      const top = viewport?.offsetTop ?? 0;
      content.current?.style.setProperty("--quick-height", `${height}px`);
      content.current?.style.setProperty("--quick-top", `${top}px`);
      content.current?.style.setProperty("--quick-bottom", `${Math.max(0, window.innerHeight - height - top)}px`);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(resize); };
    resize(); viewport?.addEventListener("resize", schedule); viewport?.addEventListener("scroll", schedule); window.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(frame); viewport?.removeEventListener("resize", schedule); viewport?.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); };
  }, [open]);
  function launch(action: () => void) {
    handingOff.current = true; onClose();
    window.setTimeout(action, 160); // Let the action picker release focus and scroll locks first.
  }


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
    <Dialog.Root open={open} onOpenChange={next => { if (!next && !busy) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="quick-sheet-overlay" />
        <Dialog.Content
          ref={content}
          className={`quick-sheet ${tab === "actions" ? "quick-sheet-launcher" : "quick-sheet-editor"}`}
          aria-describedby="quick-sheet-description"
          onOpenAutoFocus={event => { event.preventDefault(); content.current?.focus(); }}
          onCloseAutoFocus={event => { event.preventDefault(); if (!handingOff.current) document.querySelector<HTMLButtonElement>('[aria-label="Quick log"]')?.focus(); }}
        >
          <div className="quick-sheet-header">
            <div className="sheet-grabber" aria-hidden="true" />
            <div className="split-row">
              {tab !== "actions" && <button className="secondary icon-btn" type="button" aria-label="Back to logging actions" onClick={() => setTab("actions")}><ArrowLeft size={20} /></button>}
              <Dialog.Title>{tab === "actions" ? "Quick Log" : tab === "meal" ? "Recent foods" : tab === "workout" ? "Workout" : "Body measurements"}</Dialog.Title>
              <button type="button" className="secondary icon-btn" aria-label="Close quick log" disabled={busy} onClick={onClose}><X size={20} /></button>
            </div>
            <Dialog.Description id="quick-sheet-description" className="ow-detail">{tab === "actions" ? "Choose what to log" : `Logging for ${defaultDay}`}</Dialog.Description>
          </div>
          <div className="quick-sheet-body" onFocusCapture={event => {
            const target = event.target;
            if (target instanceof HTMLElement && target.matches("input,textarea,select")) window.setTimeout(() => target.scrollIntoView({ block: "nearest", inline: "nearest" }), 180);
          }}>
            {tab === "actions" && <div className="quick-action-grid">
              <button type="button" onClick={() => launch(() => onOpenMealComposer())}><span><Search size={25} /></span>Search food</button>
              <button type="button" onClick={() => setTab("meal")}><span><History size={25} /></span>Recent foods</button>
              <button type="button" onClick={() => launch(() => onOpenMealComposer({ openBarcode: true }))}><span><Camera size={25} /></span>Scan food</button>
              <button type="button" className={`mcp-connection ${mcpConnected === true ? "is-connected" : mcpConnected === false ? "is-disconnected" : ""}`} onClick={() => launch(onOpenSettings)}><span><Sparkles size={25} /></span>{mcpConnected === true ? "ChatGPT authorised" : mcpConnected === false ? "Connect ChatGPT" : "ChatGPT Settings"}</button>
              <button type="button" onClick={() => setTab("workout")}><span><Dumbbell size={25} /></span>Workout</button>
              <button type="button" onClick={() => setTab("body")}><span><Scale size={25} /></span>Body</button>
            </div>}

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
                    launch(() => onOpenMealComposer());
                  }}
                >
                  <Utensils size={14} /> Full Meal Composer
                </button>
                <button
                  type="button"
                  className="secondary compact"
                  onClick={() => {
                    launch(() => onOpenMealComposer({ openBarcode: true }));
                  }}
                >
                  <Camera size={14} /> Barcode Scan
                </button>
                <button
                  type="button"
                  className={`secondary compact mcp-connection ${mcpConnected === true ? "is-connected" : mcpConnected === false ? "is-disconnected" : ""}`}
                  onClick={() => launch(onOpenSettings)}
                >
                  <Sparkles size={14} /> {mcpConnected === true ? "ChatGPT authorised" : mcpConnected === false ? "Connect ChatGPT · Settings" : "ChatGPT · Check in Settings"}
                </button>
              </div>

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
                  launch(onOpenTraining);
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
                    launch(onOpenPhysiqueCheckin);
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
