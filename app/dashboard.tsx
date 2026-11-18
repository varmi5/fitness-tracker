"use client";

import dynamic from "next/dynamic";
import { Plus } from "lucide-react";
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

const THEME_STORAGE_KEY = "fitnesstrackr_theme";

export function Dashboard({ initial }: { initial: InitialAppData }) {
  const initialCalendarToday = initial.calendarToday ?? initial.today;
  const initialActiveDay = initial.activeDay ?? initial.daily.day ?? initialCalendarToday;

  const [tab, setTab] = useState<AppTab>("Home");
  const [theme, setThemeState] = useState<ThemeMode>("light");
  const [tracker, setTracker] = useState(initial.tracker);
  const [settings, setSettings] = useState(initial.settings);
  const [today, setToday] = useState(initialCalendarToday);
  const todayRef = useRef(initialCalendarToday);
  const tzRef = useRef(initial.settings.timezone);

  const [activeHomeDay, setActiveHomeDay] = useState(initialActiveDay);
  const activeHomeDayRef = useRef(initialActiveDay);
  const [waitingForSleep, setWaitingForSleep] = useState(Boolean(initial.waitingForSleep));
  const [showSleep, setShowSleep] = useState(Boolean(initial.showSleep));

  const [homeDay, setHomeDay] = useState(initialActiveDay);
  const homeDayRef = useRef(initialActiveDay);
  const homeRequest = useRef<AbortController | null>(null);
  const [homeDaily, setHomeDaily] = useState<DailyNutritionView>(initial.daily);

  const selectedDayRef = useRef(initialActiveDay);
  const dayRequest = useRef<AbortController | null>(null);
  const actionLock = useRef(false);
  const syncTokenRef = useRef(initial.syncToken);
  const syncInFlight = useRef(false);
  const lastSyncCheckRef = useRef(Date.now());
  const [dayLoading, setDayLoading] = useState(false);
  const lastToday = useRef(initialCalendarToday);
  const [selectedDay, setSelectedDay] = useState(initialActiveDay);
  const [selectedDaily, setSelectedDaily] = useState<DailyNutritionView>(initial.daily);
  const [history30, setHistory30] = useState(initial.history30);
  const [google, setGoogle] = useState(initial.google);
  const [audit, setAudit] = useState(initial.audit);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerDay, setComposerDay] = useState(initialCalendarToday);
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
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY) ?? window.localStorage.getItem("mcplogger_theme");
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
    tzRef.current = settings.timezone;
  }, [settings.timezone]);

  useEffect(() => {
    const syncDayAndData = (forceSync = false) => {
      const currentDay = localDay(new Date(), tzRef.current);
      if (currentDay !== todayRef.current) {
        if (selectedDayRef.current === todayRef.current) {
          selectedDayRef.current = currentDay;
          setSelectedDay(currentDay);
        }
        todayRef.current = currentDay;
        setToday(currentDay);
      }
      void checkForRemoteUpdates(forceSync);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") syncDayAndData(true);
    };
    const onResume = () => syncDayAndData(true);
    const onFocus = () => syncDayAndData(false);
    const timer = window.setInterval(() => syncDayAndData(false), 5000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onResume);
    window.addEventListener("online", onResume);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onResume);
      window.removeEventListener("online", onResume);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    if (lastToday.current === today) return;
    lastToday.current = today;
    todayRef.current = today;
    void (async () => {
      await refreshAccountAndMeta();
      await refreshHistoryAndToday(selectedDayRef.current, homeDayRef.current);
    })().catch(() => setMessage("Could not refresh the diary. Try again."));
  }, [today]);
  useEffect(() => () => {
    dayRequest.current?.abort();
    homeRequest.current?.abort();
  }, []);

  function navigate(next: AppTab) {
    setMessage("");
    setTab(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function refreshTracker() {
    const res = await fetch("/api/tracker", { cache: "no-store" });
    if (res.status === 401) {
      window.location.reload();
      return;
    }
    if (res.ok) setTracker(await res.json());
  }

  async function refreshAccountAndMeta() {
    const res = await fetch("/api/nutrition", { cache: "no-store" });
    if (res.status === 401) {
      window.location.reload();
      return;
    }
    if (!res.ok) return;
    const payload = await res.json();
    if (payload.settings) setSettings(payload.settings);
    if (payload.google) setGoogle(payload.google);
    if (Array.isArray(payload.audit)) setAudit(payload.audit);
    if (payload.homeState) {
      const hs = payload.homeState as {
        calendarToday?: string;
        activeDay?: string;
        waitingForSleep?: boolean;
        showSleep?: boolean;
      };
      if (hs.calendarToday && hs.calendarToday !== todayRef.current) {
        todayRef.current = hs.calendarToday;
        setToday(hs.calendarToday);
      }
      if (hs.activeDay) {
        const prevActive = activeHomeDayRef.current;
        activeHomeDayRef.current = hs.activeDay;
        setActiveHomeDay(hs.activeDay);
        if (homeDayRef.current === prevActive && hs.activeDay !== prevActive) {
          homeDayRef.current = hs.activeDay;
          setHomeDay(hs.activeDay);
        }
      }
      setWaitingForSleep(Boolean(hs.waitingForSleep));
      setShowSleep(Boolean(hs.showSleep));
    }
  }

  async function refreshSyncToken() {
    const res = await fetch("/api/nutrition?sync=1", { cache: "no-store" });
    if (res.status === 401) {
      window.location.reload();
      return;
    }
    if (res.ok) {
      const data = (await res.json()) as { token?: string };
      if (data.token) syncTokenRef.current = data.token;
    }
  }

  async function checkForRemoteUpdates(force = false) {
    if (typeof document !== "undefined" && document.visibilityState !== "visible" && !force) return;
    if (syncInFlight.current || actionLock.current) return;
    const now = Date.now();
    if (!force && now - lastSyncCheckRef.current < 1200) return;
    syncInFlight.current = true;
    lastSyncCheckRef.current = now;
    try {
      const res = await fetch("/api/nutrition?sync=1", { cache: "no-store" });
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      if (!res.ok) return;
      const { token } = (await res.json()) as { token?: string };
      if (!token || token === syncTokenRef.current) return;
      await refreshAccountAndMeta();
      await Promise.all([
        refreshHistoryAndToday(selectedDayRef.current, homeDayRef.current),
        refreshTracker(),
      ]);
      syncTokenRef.current = token;
      window.dispatchEvent(new Event("fitnesstrackr:sync"));
    } catch {
      // ignore transient network errors while offline or waking from iOS suspension
    } finally {
      syncInFlight.current = false;
    }
  }

  async function refreshHistoryAndToday(focusDay = selectedDayRef.current, focusHomeDay = homeDayRef.current) {
    const calendarToday = todayRef.current;
    const [histRes, homeRes, dayRes] = await Promise.all([
      fetch(`/api/nutrition?from=${addDays(calendarToday, -29)}&to=${calendarToday}`, { cache: "no-store" }),
      fetch(`/api/nutrition?day=${focusHomeDay}`, { cache: "no-store" }),
      focusDay === focusHomeDay ? Promise.resolve(null) : fetch(`/api/nutrition?day=${focusDay}`, { cache: "no-store" }),
    ]);
    if (histRes.status === 401 || homeRes.status === 401 || dayRes?.status === 401) {
      window.location.reload();
      return;
    }
    if (!histRes.ok || !homeRes.ok || (dayRes && !dayRes.ok)) throw new Error("Could not refresh the diary.");
    if (histRes.ok) setHistory30(await histRes.json());
    if (homeRes.ok) {
      const freshHome = await homeRes.json();
      if (homeDayRef.current === focusHomeDay) setHomeDaily(freshHome);
      if (focusDay === focusHomeDay && selectedDayRef.current === focusDay) setSelectedDaily(freshHome);
    }
    if (dayRes?.ok) {
      const value = await dayRes.json();
      if (selectedDayRef.current === focusDay) setSelectedDaily(value);
    }
  }

  async function selectHomeDay(day: string) {
    const clamped = day > todayRef.current ? todayRef.current : day;
    homeRequest.current?.abort();
    homeDayRef.current = clamped;
    setHomeDay(clamped);
    const controller = new AbortController();
    homeRequest.current = controller;
    try {
      const res = await fetch(`/api/nutrition?day=${clamped}`, { signal: controller.signal, cache: "no-store" });
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      if (!res.ok) throw new Error("Could not load that date.");
      const value = await res.json();
      if (homeDayRef.current === clamped) setHomeDaily(value);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Could not load that date.");
    }
  }

  async function selectDay(day: string) {
    dayRequest.current?.abort();
    selectedDayRef.current = day;
    setSelectedDay(day);
    if (day === homeDaily.day) { setSelectedDaily(homeDaily); setDayLoading(false); return; }
    const controller = new AbortController();
    dayRequest.current = controller;
    setDayLoading(true);
    try {
      const res = await fetch(`/api/nutrition?day=${day}`, { signal: controller.signal, cache: "no-store" });
      if (res.status === 401) {
        window.location.reload();
        return;
      }
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
      await refreshHistoryAndToday(selectedDayRef.current, homeDayRef.current);
      void refreshSyncToken().catch(() => null);
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
        if (savedDay.day === homeDayRef.current) setHomeDaily(savedDay);
        if (savedDay.day === selectedDayRef.current) setSelectedDaily(savedDay);
      }
      if (action.action === "target" || action.action === "macro-targets" || action.action === "preferences") {
        setSettings(payload);
        if (action.action === "preferences") {
          await refreshAccountAndMeta().catch(() => null);
        }
      } else if (action.action === "revoke-mcp") {
        setAudit([]);
      }
      let refreshed = true;
      await refreshHistoryAndToday(selectedDayRef.current, homeDayRef.current).catch(() => { refreshed = false; });
      if (action.action === "energy" || action.action === "energy-import" || action.action === "import-health-file") {
        if (action.action === "import-health-file") await refreshAccountAndMeta().catch(() => null);
        await refreshTracker().catch(() => null);
      }
      void refreshSyncToken().catch(() => null);
      if (action.action === "import-health-file") {
        const parts: string[] = [];
        if (payload.energyImported) parts.push(`${payload.energyImported} day(s) of energy`);
        if (payload.sleepImported) parts.push(`${payload.sleepImported} sleep session(s)`);
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
      await refreshAccountAndMeta();
      await Promise.all([refreshHistoryAndToday(selectedDayRef.current, homeDayRef.current), refreshTracker()]);
      void refreshSyncToken().catch(() => null);
      const sleepNote = payload.syncedSleepDays ? ` & ${payload.syncedSleepDays} sleep session(s)` : "";
      setMessage(`Synced ${payload.syncedDays} day(s)${sleepNote} from Google Health.`);
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
      void refreshSyncToken().catch(() => null);
      setMessage(payload.mealsQueued != null ? `Queued ${payload.mealsQueued} meal(s) for Google Health. Check sync status for confirmation.` : `Pushed ${payload.mealsPushed ?? 0} meal(s) and ${payload.weightsPushed ?? 0} weight(s) to Google Health.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Google push failed.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnectGoogle() {
    if (!window.confirm("Disconnect Google Health and delete all synced Google expenditure and sleep data?")) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/integrations/google/disconnect", { method: "POST" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message ?? "Could not disconnect.");
      if (payload.status) setGoogle(payload.status);
      await refreshAccountAndMeta();
      await Promise.all([refreshHistoryAndToday(selectedDayRef.current, homeDayRef.current), refreshTracker()]);
      void refreshSyncToken().catch(() => null);
      setMessage("Google Health disconnected and synced data removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disconnect.");
    } finally {
      setBusy(false);
    }
  }

  function openNewMeal(day = todayRef.current) {
    setComposerDay(day);
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
            calendarToday={today}
            activeDay={activeHomeDay}
            viewDay={homeDay}
            waitingForSleep={waitingForSleep}
            showSleep={showSleep}
            daily={homeDaily}
            history30={history30}
            tracker={tracker}
            google={google}
            settings={settings}
            theme={theme}
            busy={busy}
            onToggleTheme={toggleTheme}
            onSelectHomeDay={(d) => void selectHomeDay(d)}
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
          defaultDay={composerDay}
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

      {!composerOpen && <button className="log-meal-fab" type="button" onClick={() => openNewMeal(tab === "Nutrition" ? selectedDay : today)}><Plus size={20} aria-hidden="true" />Log meal</button>}
      <nav className="tabs" aria-label="FitnessTrackr views">
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
