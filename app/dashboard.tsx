"use client";

import dynamic from "next/dynamic";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  FitbitPulseIcon,
  HomeRingIcon,
  NutritionBowlIcon,
  SettingsSlidersIcon,
} from "../components/icons";
import type { DailyNutritionView, MealRecord } from "../lib/nutrition-data";
import { addDays, localDay } from "../lib/nutrition-model";
import { HomeView } from "./home-view";
import type {
  AppTab,
  DailyStrainView,
  HevyIntegrationStatus,
  InitialAppData,
  MoreSection,
  RecoveryInsightView,
  StrainSettings,
  ThemeMode,
} from "./types";

const MeasurementsView = dynamic(() => import("./measurements-view").then((m) => m.MeasurementsView), {
  loading: () => <p role="status">Loading measurements…</p>,
});
const TrainingView = dynamic(() => import("./training-view").then((m) => m.TrainingView), {
  loading: () => <p role="status">Loading training…</p>,
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
  { title: "Training", icon: FitbitPulseIcon },
  { title: "Nutrition", icon: NutritionBowlIcon },
  { title: "More", icon: SettingsSlidersIcon },
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
  const [moreSection, setMoreSection] = useState<MoreSection>("Measurements");
  const [homeStrain, setHomeStrain] = useState<DailyStrainView | undefined>(initial.strain);
  const [trainingDay, setTrainingDay] = useState(initialActiveDay);
  const trainingDayRef = useRef(initialActiveDay);
  const [trainingStrain, setTrainingStrain] = useState<DailyStrainView | undefined>(initial.strain);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [strainSettings, setStrainSettings] = useState<StrainSettings | undefined>(initial.strainSettings);
  const [hevy, setHevy] = useState<HevyIntegrationStatus | undefined>(initial.hevy);
  const [homeRecovery, setHomeRecovery] = useState<RecoveryInsightView | undefined>(initial.recoveryInsights);
  const [trainingRecovery, setTrainingRecovery] = useState<RecoveryInsightView | undefined>(initial.recoveryInsights);

  const [history30, setHistory30] = useState(initial.history30);
  const [google, setGoogle] = useState(initial.google);
  useEffect(() => {
    if (!google.connected || (!google.mealSync?.pending && !google.mealSync?.failed)) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetch("/api/integrations/google/push", { cache: "no-store", signal: controller.signal })
        .then(async (response) => response.ok ? response.json() : null)
        .then((payload) => { if (payload?.status && !controller.signal.aborted) setGoogle(payload.status); })
        .catch(() => undefined);
    }, 5000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [google.connected, google.mealSync?.pending, google.mealSync?.failed]);
  const [audit, setAudit] = useState(initial.audit);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string; kind: "success" | "error" | "info" } | null>(null);
  const toastSeq = useRef(0);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerDay, setComposerDay] = useState(initialCalendarToday);
  const [editingMeal, setEditingMeal] = useState<MealRecord | null>(null);

  function showToast(text: string, kind?: "success" | "error" | "info") {
    if (!text) {
      setToast(null);
      return;
    }
    const resolvedKind =
      kind ?? (/\b(could not|failed|error|unable|invalid|denied|rejected|unavailable)\b/i.test(text) ? "error" : "success");
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, text, kind: resolvedKind });
  }

  useEffect(() => {
    if (!toast || toast.kind === "error") return;
    const timer = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
      showToast(
        initial.google.status === "sync_failed"
          ? "Google Health connected. The first sync failed; try Sync again in Settings."
          : "Google Health connected.",
        initial.google.status === "sync_failed" ? "info" : "success",
      );
      window.history.replaceState({}, "", "/");
    } else if (googleState === "error") {
      const reason = params.get("reason") ?? "connection failed";
      showToast(`Google Health: ${reason}`, "error");
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
        if (homeDayRef.current === todayRef.current) {
          homeDayRef.current = currentDay;
          setHomeDay(currentDay);
        }
        activeHomeDayRef.current = currentDay;
        setActiveHomeDay(currentDay);
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
    })().catch(() => showToast("Could not refresh the diary. Try again.", "error"));
  }, [today]);
  useEffect(() => () => {
    dayRequest.current?.abort();
    homeRequest.current?.abort();
  }, []);

  function navigate(next: AppTab) {
    setToast(null);
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
      const [res, strainRes] = await Promise.all([
        fetch(`/api/nutrition?day=${clamped}`, { signal: controller.signal, cache: "no-store" }),
        fetch(`/api/strain?day=${clamped}`, { signal: controller.signal, cache: "no-store" }).catch(() => null),
      ]);
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      if (!res.ok) throw new Error("Could not load that date.");
      const value = await res.json();
      if (homeDayRef.current === clamped) setHomeDaily(value);
      if (strainRes?.ok) {
        const strainJson = await strainRes.json();
        if (homeDayRef.current === clamped && strainJson?.strain) setHomeStrain(strainJson.strain);
        if (homeDayRef.current === clamped && strainJson?.recoveryInsights) setHomeRecovery(strainJson.recoveryInsights);
      }
    } catch (error) {
      if (!controller.signal.aborted) showToast(error instanceof Error ? error.message : "Could not load that date.", "error");
    }
  }

  async function selectTrainingDay(day: string) {
    const clamped = day > todayRef.current ? todayRef.current : day;
    trainingDayRef.current = clamped;
    setTrainingDay(clamped);
    setTrainingLoading(true);
    try {
      const res = await fetch(`/api/strain?day=${clamped}`, { cache: "no-store" });
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      if (!res.ok) throw new Error("Could not load strain for that date.");
      const json = await res.json();
      if (trainingDayRef.current === clamped && json?.strain) {
        setTrainingStrain(json.strain);
      }
      if (trainingDayRef.current === clamped && json?.recoveryInsights) {
        setTrainingRecovery(json.recoveryInsights);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not load strain.", "error");
    } finally {
      setTrainingLoading(false);
    }
  }

  async function recomputeStrainDay(day: string) {
    setTrainingLoading(true);
    try {
      const res = await fetch("/api/strain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recompute", day }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Could not recompute strain.");
      if (json?.strain) {
        if (trainingDayRef.current === day) setTrainingStrain(json.strain);
        if (homeDayRef.current === day) setHomeStrain(json.strain);
      }
      showToast("Strain recalculated.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not recompute strain.", "error");
    } finally {
      setTrainingLoading(false);
    }
  }

  async function saveStrainSettings(data: Partial<StrainSettings>): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch("/api/strain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "preferences",
          data,
          recomputeFrom: todayRef.current,
          recomputeTo: todayRef.current,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Could not save strain settings.");
      if (json?.settings) setStrainSettings(json.settings);
      if (json?.strain) {
        if (homeDayRef.current === todayRef.current) setHomeStrain(json.strain);
        if (trainingDayRef.current === todayRef.current) setTrainingStrain(json.strain);
      } else {
        await Promise.all([
          selectTrainingDay(trainingDayRef.current),
          homeDayRef.current !== trainingDayRef.current ? selectHomeDay(homeDayRef.current) : Promise.resolve(),
        ]);
      }
      showToast("Strain & walking settings saved.", "success");
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not save strain settings.", "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function importHevy(rawText: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/hevy/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Could not import Hevy data.");
      if (json?.status) setHevy(json.status);
      await Promise.all([
        selectTrainingDay(trainingDayRef.current),
        selectHomeDay(homeDayRef.current),
      ]);
      showToast(`Imported ${json.imported ?? 0} Hevy workout(s).`, "success");
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Hevy import failed.", "error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function syncHevy() {
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/hevy/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Hevy sync failed.");
      if (json?.status) setHevy(json.status);
      await Promise.all([
        selectTrainingDay(trainingDayRef.current),
        selectHomeDay(homeDayRef.current),
      ]);
      showToast(`Synced ${json.synced ?? 0} Hevy workout(s).`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Hevy sync failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function disconnectHevy() {
    if (!window.confirm("Disconnect Hevy integration?")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/hevy/disconnect", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? "Could not disconnect Hevy.");
      if (json?.status) setHevy(json.status);
      showToast("Hevy disconnected.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not disconnect Hevy.", "error");
    } finally {
      setBusy(false);
    }
  }

  function openMore(section: MoreSection = "Measurements") {
    setMoreSection(section);
    navigate("More");
  }

  function openTrainingForDay(day: string) {
    navigate("Training");
    void selectTrainingDay(day);
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
      if (!controller.signal.aborted) showToast(error instanceof Error ? error.message : "Could not load the diary.", "error");
    } finally {
      if (selectedDayRef.current === day) setDayLoading(false);
    }
  }

  async function saveTracker(action: object, successMessage: string) {
    setBusy(true);
    setToast(null);
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
      showToast(successMessage, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not save.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function runNutritionAction(action: { action: string; [k: string]: unknown }, successMessage: string): Promise<boolean> {
    if (actionLock.current) return false;
    actionLock.current = true;
    setBusy(true);
    setToast(null);
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
        if (payload.recoveryImported) parts.push(`${payload.recoveryImported} recovery day(s)`);
        if (payload.workoutsImported) parts.push(`${payload.workoutsImported} workout(s)`);
        if (payload.weightsSynced) parts.push(`${payload.weightsSynced} weight reading(s)`);
        if (payload.mealsImported) parts.push(`${payload.mealsImported} meal(s)`);
        if (payload.heightUpdated) parts.push("height profile");
        showToast(parts.length ? `Imported ${parts.join(", ")}.` : successMessage, "success");
        return true;
      }
      showToast(refreshed ? successMessage : `${successMessage} Refresh the page to see the updated totals.`, "success");
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not save.", "error");
      return false;
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  }

  async function syncGoogle(days = 14) {
    setBusy(true);
    setToast(null);
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
      await Promise.all([
        refreshHistoryAndToday(selectedDayRef.current, homeDayRef.current),
        refreshTracker(),
        fetch("/api/strain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "recompute", day: today }),
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => {
            if (j?.strain) {
              if (homeDayRef.current === today) setHomeStrain(j.strain);
              if (trainingDayRef.current === today) setTrainingStrain(j.strain);
            }
          })
          .catch(() => undefined),
      ]);
      void refreshSyncToken().catch(() => null);
      const sleepNote = payload.syncedSleepDays ? ` & ${payload.syncedSleepDays} sleep session(s)` : "";
      showToast(`Synced ${payload.syncedDays} day(s)${sleepNote} from Google Health.`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Google sync failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function pushGoogle(days = 14) {
    setBusy(true);
    setToast(null);
    try {
      let cursor: string | null = null;
      let queued = 0;
      do {
        const res = await fetch("/api/integrations/google/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...(days === 0 ? { allHistory: true } : { from: addDays(today, 1 - days) }), to: today, ...(cursor ? { cursor } : {}) }),
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.message ?? "Google push failed.");
        if (payload.status) setGoogle(payload.status);
        queued += payload.mealsQueued ?? 0;
        cursor = payload.nextCursor ?? null;
      } while (cursor);
      void refreshSyncToken().catch(() => null);
      showToast(`Sync requested for ${queued} meal(s). See Google sync status.`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Google push failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function disconnectGoogle() {
    if (!window.confirm("Disconnect Google Health and delete all synced Google expenditure and sleep data?")) return;
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch("/api/integrations/google/disconnect", { method: "POST" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message ?? "Could not disconnect.");
      if (payload.status) setGoogle(payload.status);
      await refreshAccountAndMeta();
      await Promise.all([refreshHistoryAndToday(selectedDayRef.current, homeDayRef.current), refreshTracker()]);
      void refreshSyncToken().catch(() => null);
      showToast("Google Health disconnected and synced data removed.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not disconnect.", "error");
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
            showSleep={showSleep}
            daily={homeDaily}
            history30={history30}
            tracker={tracker}
            google={google}
            settings={settings}
            strain={homeStrain}
            recoveryInsights={homeRecovery}
            theme={theme}
            busy={busy}
            onToggleTheme={toggleTheme}
            onSelectHomeDay={(d) => void selectHomeDay(d)}
            onOpenTraining={openTrainingForDay}
            onLogMeal={() => openNewMeal(homeDay)}
            onEditMeal={openEditMeal}
            onSyncGoogle={() => void syncGoogle(14)}
            onPushGoogle={() => void pushGoogle(14)}
            onNavigate={navigate}
          />
        )}

        {tab === "Training" && trainingStrain && strainSettings && hevy && (
          <TrainingView
            today={today}
            selectedDay={trainingDay}
            strain={trainingStrain}
            recoveryInsights={trainingRecovery}
            strainSettings={strainSettings}
            hevy={hevy}
            theme={theme}
            busy={busy}
            loading={trainingLoading}
            onSelectDay={(d) => void selectTrainingDay(d)}
            onRecomputeDay={(d) => void recomputeStrainDay(d)}
            onImportHevy={importHevy}
            onSyncHevy={syncHevy}
            onOpenSettings={(section = "Settings") => openMore(section)}
          />
        )}

        {tab === "Nutrition" && (
          <NutritionView
            today={today}
            selectedDay={selectedDay}
            dayView={selectedDaily}
            history30={history30}
            tracker={tracker}
            settings={settings}
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
          />
        )}

        {tab === "More" && (
          <div style={{ display: "grid", gap: "1rem" }}>
            <div className="segmented" role="tablist" aria-label="More sections">
              {(["Measurements", "Settings"] as MoreSection[]).map((section) => (
                <button
                  key={section}
                  type="button"
                  role="tab"
                  aria-selected={moreSection === section}
                  className={moreSection === section ? "active" : ""}
                  onClick={() => setMoreSection(section)}
                >
                  {section}
                </button>
              ))}
            </div>

            {moreSection === "Measurements" && (
              <MeasurementsView
                snapshot={tracker}
                nutritionSettings={settings}
                history30={history30}
                daily={homeDaily}
                today={today}
                theme={theme}
                busy={busy}
                onToggleTheme={toggleTheme}
                onSaveTracker={saveTracker}
              />
            )}

            {moreSection === "Settings" && (
              <SettingsView
                today={today}
                tracker={tracker}
                settings={settings}
                google={google}
                hevy={hevy}
                strainSettings={strainSettings}
                audit={audit}
                mcpEnabled={initial.mcpEnabled}
                theme={theme}
                busy={busy}
                onSetTheme={applyTheme}
                onToggleTheme={toggleTheme}
                onSaveTracker={saveTracker}
                onNutritionAction={(action, msg) => runNutritionAction(action as { action: string }, msg)}
                onSaveStrainSettings={saveStrainSettings}
                onImportHevy={importHevy}
                onSyncHevy={syncHevy}
                onDisconnectHevy={disconnectHevy}
                onSyncGoogle={syncGoogle}
                onPushGoogle={pushGoogle}
                onDisconnectGoogle={disconnectGoogle}
                onMessage={(msg) => showToast(msg)}
              />
            )}
          </div>
        )}
      </div>

      {toast && (
        <div
          className="toast-region"
          aria-live={toast.kind === "error" ? "assertive" : "polite"}
          aria-atomic="true"
        >
          <div
            className={`feedback toast-${toast.kind}`}
            role={toast.kind === "error" ? "alert" : "status"}
          >
            <span className="toast-text">{toast.text}</span>
            <button
              type="button"
              className="toast-dismiss"
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
            >
              ×
            </button>
          </div>
        </div>
      )}

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

      {!composerOpen && (
        <button
          className="log-meal-fab"
          type="button"
          onClick={() => openNewMeal(tab === "Home" ? homeDay : tab === "Nutrition" ? selectedDay : today)}
        >
          <Plus size={20} aria-hidden="true" />
          Log meal
        </button>
      )}
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
