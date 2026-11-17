"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import {
  HomeRingIcon,
  MeasurementsCaliperIcon,
  NutritionBowlIcon,
  SettingsSlidersIcon,
} from "../components/icons";
import type { DailyNutritionView, MealRecord } from "../lib/nutrition-data";
import { addDays, localDay } from "../lib/nutrition-model";
import { HomeView } from "./home-view";
import type { AppTab, InitialAppData, ThemeMode } from "./types";

const MeasurementsView = dynamic(() => import("./measurements-view").then((m) => m.MeasurementsView), {
  loading: () => <p role="status">Loading measurements…</p>,
});
const NutritionView = dynamic(() => import("./nutrition-view").then((m) => m.NutritionView), {
  loading: () => <p role="status">Loading diary…</p>,
});
const SettingsView = dynamic(() => import("./settings-view").then((m) => m.SettingsView), {
  loading: () => <p role="status">Loading settings…</p>,
});

const MealComposer = dynamic(() => import("./meal-composer").then((m) => m.MealComposer), {
  ssr: false,
});

const tabs: { title: AppTab; icon: typeof HomeRingIcon }[] = [
  { title: "Home", icon: HomeRingIcon },
  { title: "Nutrition", icon: NutritionBowlIcon },
  { title: "Measurements", icon: MeasurementsCaliperIcon },
  { title: "Settings", icon: SettingsSlidersIcon },
];

const THEME_STORAGE_KEY = "mcplogger_theme";

export function Dashboard({ initial }: { initial: InitialAppData }) {
  const [tab, setTab] = useState<AppTab>("Home");
  const [theme, setThemeState] = useState<ThemeMode>("light");
  const [tracker, setTracker] = useState(initial.tracker);
  const [settings, setSettings] = useState(initial.settings);
  const [today, setToday] = useState(initial.today);
  const selectedDayRef = useRef(initial.today);
  const dayRequest = useRef<AbortController | null>(null);
  const actionLock = useRef(false);
  const [dayLoading, setDayLoading] = useState(false);
  const lastToday = useRef(initial.today);
  const [selectedDay, setSelectedDay] = useState(initial.today);
  const [todayDaily, setTodayDaily] = useState<DailyNutritionView>(initial.daily);
  const [selectedDaily, setSelectedDaily] = useState<DailyNutritionView>(initial.daily);
  const [history30, setHistory30] = useState(initial.history30);
  const [google, setGoogle] = useState(initial.google);
  const [audit, setAudit] = useState(initial.audit);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingMeal, setEditingMeal] = useState<MealRecord | null>(null);

  function applyTheme(next: ThemeMode) {
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // ignore private-mode storage restrictions
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "dark" ? "#0A0B0F" : "#F5F7FA");
  }

  function toggleTheme() {
    applyTheme(theme === "light" ? "dark" : "light");
  }

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === "dark" || saved === "light") {
        applyTheme(saved);
      }
    } catch {
      // ignore storage errors
    }

    const params = new URLSearchParams(window.location.search);
    const reqTab = params.get("tab") as AppTab | null;
    if (reqTab && tabs.some((t) => t.title === reqTab)) setTab(reqTab);
    const googleState = params.get("google");
    if (googleState === "connected") {
      setMessage(initial.google.status === "sync_failed" ? "Google Health connected. The first sync failed; try Sync again in Settings." : "Google Health connected.");
      window.history.replaceState({}, "", "/");
    } else if (googleState === "error") {
      const reason = params.get("reason") ?? "connection failed";
      setMessage(`Google Health: ${reason}`);
      window.history.replaceState({}, "", "/");
    }
  }, []);

  useEffect(() => {
    const updateDay = () => {
      const currentDay = localDay(new Date(), settings.timezone);
      setToday(currentDay);
      if (selectedDayRef.current === today) { selectedDayRef.current = currentDay; setSelectedDay(currentDay); }
    };
    const timer = window.setInterval(updateDay, 30000);
    window.addEventListener("focus", updateDay);
    updateDay();
    return () => { window.clearInterval(timer); window.removeEventListener("focus", updateDay); };
  }, [settings.timezone, today]);

  useEffect(() => {
    if (lastToday.current === today) return;
    lastToday.current = today;
    void refreshHistoryAndToday(selectedDayRef.current).catch(() => setMessage("Could not refresh the diary. Try again."));
  }, [today]);
  useEffect(() => () => dayRequest.current?.abort(), []);

  function navigate(next: AppTab) {
    setMessage("");
    setTab(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function refreshTracker() {
    const res = await fetch("/api/tracker");
    if (res.ok) setTracker(await res.json());
  }

  async function refreshHistoryAndToday(focusDay = selectedDay) {
    const [histRes, dayRes, todayRes] = await Promise.all([
      fetch(`/api/nutrition?from=${addDays(today, -29)}&to=${today}`),
      focusDay === today ? Promise.resolve(null) : fetch(`/api/nutrition?day=${focusDay}`),
      fetch(`/api/nutrition?day=${today}`),
    ]);
    if (!histRes.ok || !todayRes.ok || (dayRes && !dayRes.ok)) throw new Error("Could not refresh the diary.");
    if (histRes.ok) setHistory30(await histRes.json());
    if (todayRes.ok) {
      const freshToday = await todayRes.json();
      setTodayDaily(freshToday);
      if (focusDay === today && selectedDayRef.current === focusDay) setSelectedDaily(freshToday);
    }
    if (dayRes?.ok) {
      const value = await dayRes.json();
      if (selectedDayRef.current === focusDay) setSelectedDaily(value);
    }
  }

  async function selectDay(day: string) {
    dayRequest.current?.abort();
    selectedDayRef.current = day;
    setSelectedDay(day);
    if (day === today) { setSelectedDaily(todayDaily); setDayLoading(false); return; }
    const controller = new AbortController();
    dayRequest.current = controller;
    setDayLoading(true);
    try {
      const res = await fetch(`/api/nutrition?day=${day}`, { signal: controller.signal });
      if (!res.ok) throw new Error("Could not load that date. Select it again to retry.");
      const value = await res.json();
      if (selectedDayRef.current === day) setSelectedDaily(value);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Could not load the diary.");
    } finally {
      if (selectedDayRef.current === day) setDayLoading(false);
    }
  }

  async function saveTracker(action: object, successMessage: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/tracker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Could not save.");
      if (payload.deleted) {
        location.reload();
        return;
      }
      setTracker(payload);
      await refreshHistoryAndToday(selectedDay);
      setMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function runNutritionAction(action: { action: string; [k: string]: unknown }, successMessage: string): Promise<boolean> {
    if (actionLock.current) return false;
    actionLock.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/nutrition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Could not save.");

      // Use the committed response immediately, even if a later refresh is unavailable.
      const savedDay = typeof payload.day === "object" ? payload.day : payload.meals ? payload : null;
      if (savedDay) {
        if (savedDay.day === today) setTodayDaily(savedDay);
        if (savedDay.day === selectedDayRef.current) setSelectedDaily(savedDay);
      }
      if (action.action === "target" || action.action === "preferences") {
        setSettings(payload);
      } else if (action.action === "revoke-mcp") {
        setAudit([]);
      }
      let refreshed = true;
      await refreshHistoryAndToday(selectedDayRef.current).catch(() => { refreshed = false; });
      if (action.action === "energy" || action.action === "energy-import" || action.action === "import-health-file") {
        await refreshTracker().catch(() => null);
      }
      if (action.action === "import-health-file") {
        const parts: string[] = [];
        if (payload.energyImported) parts.push(`${payload.energyImported} day(s) of energy`);
        if (payload.weightsSynced) parts.push(`${payload.weightsSynced} weight reading(s)`);
        if (payload.mealsImported) parts.push(`${payload.mealsImported} meal(s)`);
        if (payload.heightUpdated) parts.push("height profile");
        setMessage(parts.length ? `Imported ${parts.join(", ")}.` : successMessage);
        return true;
      }
      setMessage(refreshed ? successMessage : `${successMessage} Refresh the page to see the updated totals.`);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save.");
      return false;
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }

  async function syncGoogle(days = 14) {
    setBusy(true);
    setMessage("");
    try {
      const from = addDays(today, 1 - days);
      const res = await fetch("/api/integrations/google/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: today }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message ?? "Google sync failed.");
      if (payload.status) setGoogle(payload.status);
      await Promise.all([refreshHistoryAndToday(selectedDay), refreshTracker()]);
      setMessage(`Synced ${payload.syncedDays} day(s) from Google Health.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Google sync failed.");
    } finally {
      setBusy(false);
    }
  }

  async function pushGoogle(days = 14) {
    setBusy(true);
    setMessage("");
    try {
      const from = addDays(today, 1 - days);
      const res = await fetch("/api/integrations/google/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: today }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message ?? "Google push failed.");
      if (payload.status) setGoogle(payload.status);
      setMessage(`Pushed ${payload.mealsPushed ?? 0} meal(s) and ${payload.weightsPushed ?? 0} weight(s) to Google Health.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Google push failed.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnectGoogle() {
    if (!window.confirm("Disconnect Google Health and delete all synced Google expenditure data?")) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/integrations/google/disconnect", { method: "POST" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message ?? "Could not disconnect.");
      if (payload.status) setGoogle(payload.status);
      await Promise.all([refreshHistoryAndToday(selectedDay), refreshTracker()]);
      setMessage("Google Health disconnected and synced data removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disconnect.");
    } finally {
      setBusy(false);
    }
  }

  function openNewMeal(day = selectedDay) {
    selectedDayRef.current = day;
    setSelectedDay(day);
    setEditingMeal(null);
    setComposerOpen(true);
  }

  function openEditMeal(meal: MealRecord) {
    setEditingMeal(meal);
    setComposerOpen(true);
  }

  return (
    <main className="shell">
      <div className="screen" key={tab}>
        {tab === "Home" && (
          <HomeView
            today={today}
            daily={todayDaily}
            history30={history30}
            tracker={tracker}
            google={google}
            settings={settings}
            theme={theme}
            busy={busy}
            onToggleTheme={toggleTheme}
            onLogMeal={() => openNewMeal(today)}
            onEditMeal={openEditMeal}
            onToggleComplete={(day, complete) =>
              void runNutritionAction(
                { action: "complete", day, complete },
                complete ? "Day marked complete." : "Day marked in progress.",
              )
            }
            onSyncGoogle={() => void syncGoogle(14)}
            onPushGoogle={() => void pushGoogle(14)}
            onNavigate={navigate}
          />
        )}

        {tab === "Nutrition" && (
          <NutritionView
            today={today}
            selectedDay={selectedDay}
            dayView={selectedDaily}
            history30={history30}
            tracker={tracker}
            theme={theme}
            busy={busy}
            loading={dayLoading || selectedDaily.day !== selectedDay}
            onToggleTheme={toggleTheme}
            onSelectDay={(d) => void selectDay(d)}
            onLogMeal={() => openNewMeal(selectedDay)}
            onEditMeal={openEditMeal}
            onDuplicateMeal={(id, targetDay) =>
              void runNutritionAction({ action: "duplicate", id, targetDay }, "Meal duplicated.")
            }
            onMoveMeal={(id, targetDay) =>
              void runNutritionAction({ action: "update", data: { id, day: targetDay } }, `Meal moved to ${targetDay}.`)
            }
            onDeleteMeal={(id, name) =>
              void runNutritionAction({ action: "delete", id }, `Deleted "${name}".`)
            }
            onToggleComplete={(day, complete) =>
              void runNutritionAction(
                { action: "complete", day, complete },
                complete ? "Day marked complete." : "Day marked in progress.",
              )
            }
          />
        )}

        {tab === "Measurements" && (
          <MeasurementsView
            snapshot={tracker}
            today={today}
            theme={theme}
            busy={busy}
            onToggleTheme={toggleTheme}
            onSaveTracker={saveTracker}
          />
        )}

        {tab === "Settings" && (
          <SettingsView
            today={today}
            tracker={tracker}
            settings={settings}
            google={google}
            audit={audit}
            mcpEnabled={initial.mcpEnabled}
            theme={theme}
            busy={busy}
            onSetTheme={applyTheme}
            onToggleTheme={toggleTheme}
            onSaveTracker={saveTracker}
            onNutritionAction={(action, msg) => runNutritionAction(action as { action: string }, msg)}
            onSyncGoogle={syncGoogle}
            onPushGoogle={pushGoogle}
            onDisconnectGoogle={disconnectGoogle}
            onMessage={setMessage}
          />
        )}

        {!!message && (
          <div className="feedback" role="status">
            {message}
          </div>
        )}
      </div>

      {composerOpen && (
        <MealComposer
          defaultDay={tab === "Nutrition" ? selectedDay : today}
          editingMeal={editingMeal}
          busy={busy}
          timezone={settings.timezone}
          onClose={() => {
            setComposerOpen(false);
            setEditingMeal(null);
          }}
          onSaveMeal={async ({ mode, data }) => {
            return runNutritionAction(
              { action: mode, data },
              mode === "update" ? "Meal updated." : "Meal saved.",
            );
          }}
          onSaveTemplate={async (data) => {
            return runNutritionAction({ action: "save-template", data }, "Saved to recipes & templates.");
          }}
        />
      )}

      <nav className="tabs" aria-label="MCP Logger views">
        {tabs.map(({ title, icon: Icon }) => (
          <button
            key={title}
            type="button"
            aria-current={tab === title ? "page" : undefined}
            onClick={() => navigate(title)}
          >
            <Icon size={22} />
            <span>{title}</span>
          </button>
        ))}
      </nav>
    </main>
  );
}
