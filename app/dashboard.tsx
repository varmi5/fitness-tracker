"use client";

import dynamic from "next/dynamic";
import { ArrowLeft, CalendarDays, Check, Plus, RefreshCw, Scale, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  FitbitPulseIcon,
  HomeRingIcon,
  McpBrandMark,
  NutritionBowlIcon,
} from "../components/icons";
import type { DailyNutritionView, MealRecord } from "../lib/nutrition-data";
import { addDays, localDay, localTime } from "../lib/nutrition-model";
import { HomeView } from "./home-view";
import type { TrendMetricKind } from "./metric-trends-modal";
import type { QuickLogSavedFood } from "./quick-log-modal";
import type {
  AppTab,
  DailyStrainView,
  HevyIntegrationStatus,
  InitialAppData,
  OpenWearablesIntegrationStatus,
  PulseInsightsView,
  RecoveryInsightView,
  StrainSettings,
} from "./types";

const MeasurementsView = dynamic(() => import("./measurements-view").then((m) => m.MeasurementsView), {
  loading: () => <p role="status">Loading body…</p>,
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
const QuickLogModal = dynamic(() => import("./quick-log-modal").then((m) => m.QuickLogModal), {
  ssr: false,
});
const MetricTrendsModal = dynamic(() => import("./metric-trends-modal").then((m) => m.MetricTrendsModal), {
  ssr: false,
});
const ConsistencyCalendarModal = dynamic(
  () => import("./consistency-calendar-modal").then((m) => m.ConsistencyCalendarModal),
  { ssr: false },
);
const OnboardingWizard = dynamic(
  () => import("./onboarding-wizard").then((m) => m.OnboardingWizard),
  { ssr: false },
);

const tabs: { title: AppTab; icon: typeof HomeRingIcon | typeof Scale }[] = [
  { title: "Today", icon: HomeRingIcon },
  { title: "Training", icon: FitbitPulseIcon },
  { title: "Nutrition", icon: NutritionBowlIcon },
  { title: "Body", icon: Scale },
];

export function Dashboard({ initial }: { initial: InitialAppData }) {
  const initialCalendarToday = initial.calendarToday ?? initial.today;
  const initialActiveDay = initial.activeDay ?? initial.daily.day ?? initialCalendarToday;

  const [tab, setTab] = useState<AppTab>("Today");
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
  const [homeStrain, setHomeStrain] = useState<DailyStrainView | undefined>(initial.strain);
  const [trainingDay, setTrainingDay] = useState(initialActiveDay);
  const trainingDayRef = useRef(initialActiveDay);
  const [trainingStrain, setTrainingStrain] = useState<DailyStrainView | undefined>(initial.strain);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [strainSettings, setStrainSettings] = useState<StrainSettings | undefined>(initial.strainSettings);
  const [hevy, setHevy] = useState<HevyIntegrationStatus | undefined>(initial.hevy);
  const [homeRecovery, setHomeRecovery] = useState<RecoveryInsightView | undefined>(initial.recoveryInsights);
  const [trainingRecovery, setTrainingRecovery] = useState<RecoveryInsightView | undefined>(initial.recoveryInsights);
  const [pulseInsights, setPulseInsights] = useState<PulseInsightsView | null>(initial.pulseInsights ?? null);
  const [trainingPulse, setTrainingPulse] = useState<PulseInsightsView | null>(initial.pulseInsights ?? null);

  type DayCacheEntry = {
    daily?: DailyNutritionView;
    strain?: DailyStrainView;
    recovery?: RecoveryInsightView;
    pulse?: PulseInsightsView | null;
  };
  const dayCacheRef = useRef<Map<string, DayCacheEntry>>(
    new Map([
      [
        initialActiveDay,
        {
          daily: initial.daily,
          strain: initial.strain,
          recovery: initial.recoveryInsights,
          pulse: initial.pulseInsights ?? undefined,
        },
      ],
    ]),
  );
  const invalidateDayCache = (day?: string) => {
    if (day) dayCacheRef.current.delete(day);
    else dayCacheRef.current.clear();
  };

  const [history30, setHistory30] = useState(initial.history30);
  const [google, setGoogle] = useState(initial.google);
  const [openWearables, setOpenWearables] = useState<OpenWearablesIntegrationStatus | undefined>(initial.openWearables);
  const lastAutoSyncRef = useRef(0);
  const lastRolloverSyncDayRef = useRef(initialCalendarToday);

  const [audit, setAudit] = useState(initial.audit);
  const [busy, setBusy] = useState(false);
  const [googleSyncPct, setGoogleSyncPct] = useState<number | null>(null);
  const googleSyncLock = useRef(false);
  const [toast, setToast] = useState<{ id: number; text: string; kind: "success" | "error" | "info" } | null>(null);
  const toastSeq = useRef(0);

  const [composerOpen, setComposerOpen] = useState(false);
  const [composerBarcode, setComposerBarcode] = useState(false);
  const [composerDay, setComposerDay] = useState(initialCalendarToday);
  const [editingMeal, setEditingMeal] = useState<MealRecord | null>(null);

  // Silk modals & stack overlays
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [trendsMetric, setTrendsMetric] = useState<TrendMetricKind | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(Boolean(initial.settings.needsOnboarding));
  const [bodySubPage, setBodySubPage] = useState<"physique" | null>(null);

  useEffect(() => {
    if (!google.connected || (!google.mealSync?.pending && !google.mealSync?.failed)) return;
    const controller = new AbortController();
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void fetch("/api/integrations/google/push", { cache: "no-store", signal: controller.signal })
        .then(async (response) => (response.ok ? response.json() : null))
        .then((payload) => {
          if (payload?.status && !controller.signal.aborted) setGoogle(payload.status);
        })
        .catch(() => undefined);
    }, 5000);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [google.connected, google.mealSync?.pending, google.mealSync?.failed]);

  // Intelligent background sync: morning rollover + 15m stale freshness check (respects autoSyncEnabled)
  useEffect(() => {
    if (settings.autoSyncEnabled === false) return;
    if (!google.connected && !openWearables?.connected && !hevy?.connected) return;
    let active = true;
    let running = false;

    const FRESHNESS_MS = 15 * 60 * 1000;
    const isStale = (iso?: string | null, minAgeMs = FRESHNESS_MS) => {
      if (!iso) return true;
      const t = Date.parse(iso);
      return Number.isNaN(t) || Date.now() - t >= minAgeMs;
    };

    const runSilentSync = async (isAppOpen = false) => {
      if (!active || running || document.visibilityState !== "visible") return;
      const now = Date.now();
      const dayChanged = todayRef.current !== lastRolloverSyncDayRef.current;
      const minGap = isAppOpen || dayChanged ? 0 : FRESHNESS_MS;
      if (!isAppOpen && !dayChanged && now - lastAutoSyncRef.current < minGap) return;

      const isInitialGoogleSync = google.connected && !google.lastSync;
      const isInitialOwSync = Boolean(openWearables?.connected && !openWearables.lastSync);
      const shouldSyncGoogle =
        google.connected &&
        !googleSyncLock.current &&
        (isInitialGoogleSync || dayChanged || isStale(google.lastSync, FRESHNESS_MS));
      const shouldSyncOw =
        Boolean(openWearables?.connected) &&
        (isInitialOwSync || dayChanged || isStale(openWearables?.lastSync, FRESHNESS_MS));
      const shouldSyncHevy = Boolean(hevy?.connected) && (dayChanged || isStale(hevy?.lastSync, FRESHNESS_MS));
      if (!shouldSyncGoogle && !shouldSyncOw && !shouldSyncHevy) return;

      running = true;
      lastAutoSyncRef.current = now;
      if (dayChanged) lastRolloverSyncDayRef.current = todayRef.current;

      // Only show progress ticker on initial backfill so steady-state freshness stays quiet
      const showInitialProgress = isInitialGoogleSync;
      let ticker: number | null = null;
      if (shouldSyncGoogle) {
        googleSyncLock.current = true;
        if (showInitialProgress) {
          setGoogleSyncPct(12);
          ticker = window.setInterval(() => {
            setGoogleSyncPct((p) => (p == null ? null : Math.min(72, p + Math.max(1, Math.round((72 - p) * 0.14)))));
          }, 250);
        }
      }
      try {
        const jobs: Promise<boolean>[] = [];
        if (shouldSyncGoogle) {
          const hotFrom = addDays(todayRef.current, isInitialGoogleSync ? -13 : -2);
          jobs.push(
            fetch("/api/integrations/google/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ from: hotFrom, to: todayRef.current }),
              cache: "no-store",
            })
              .then(async (res) => (res.ok ? res.json() : null))
              .then((payload) => {
                if (payload?.status && active) setGoogle(payload.status);
                if (showInitialProgress && active) setGoogleSyncPct(82);
                return Boolean(payload);
              })
              .catch(() => false),
          );
        }
        if (shouldSyncOw) {
          const owFrom = addDays(todayRef.current, isInitialOwSync ? -13 : -2);
          jobs.push(
            fetch("/api/integrations/open-wearables/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ from: owFrom, to: todayRef.current }),
              cache: "no-store",
            })
              .then(async (res) => (res.ok ? res.json() : null))
              .then((payload) => {
                if (payload?.status && active) setOpenWearables(payload.status);
                return Boolean(payload);
              })
              .catch(() => false),
          );
        }
        if (shouldSyncHevy) {
          jobs.push(
            fetch("/api/integrations/hevy/sync", { method: "POST", cache: "no-store" })
              .then(async (res) => (res.ok ? res.json() : null))
              .then((payload) => {
                if (payload?.status && active) setHevy(payload.status);
                return Boolean(payload);
              })
              .catch(() => false),
          );
        }
        const results = await Promise.all(jobs);
        if (ticker != null) {
          window.clearInterval(ticker);
          ticker = null;
        }
        if (active && results.some(Boolean)) {
          invalidateDayCache();
          await Promise.all([
            refreshHistoryAndToday(selectedDayRef.current, homeDayRef.current),
            selectTrainingDay(trainingDayRef.current),
          ]).catch(() => undefined);
          if (showInitialProgress && active) {
            setGoogleSyncPct(100);
            await new Promise((resolve) => window.setTimeout(resolve, 350));
          }
        }
      } finally {
        if (ticker != null) window.clearInterval(ticker);
        if (shouldSyncGoogle) {
          if (showInitialProgress && active) setGoogleSyncPct(null);
          googleSyncLock.current = false;
        }
        running = false;
      }
    };

    void runSilentSync(true);

    const timer = window.setInterval(() => void runSilentSync(false), 60_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void runSilentSync(false);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [settings.autoSyncEnabled, google.connected, openWearables?.connected, hevy?.connected, today]);

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

  useEffect(() => {
    document.documentElement.dataset.theme = "light";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", "#E8EAF0");

    const params = new URLSearchParams(window.location.search);
    const reqTab = params.get("tab");
    if (reqTab === "Settings") {
      setSettingsOpen(true);
    } else if (reqTab === "Measurements" || reqTab === "Body") {
      setTab("Body");
    } else if (reqTab === "Home" || reqTab === "Today") {
      setTab("Today");
    } else if (reqTab && tabs.some((t) => t.title === reqTab)) {
      setTab(reqTab as AppTab);
    }

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
    const hevyState = params.get("hevy");
    if (hevyState === "connected") {
      showToast(
        initial.hevy.status === "sync_failed"
          ? "Hevy connected. Tap Sync Hevy to refresh your workout history."
          : "Hevy connected and workouts synced.",
        initial.hevy.status === "sync_failed" ? "info" : "success",
      );
      window.history.replaceState({}, "", "/");
    } else if (hevyState === "error") {
      const reason = params.get("reason") ?? "connection failed";
      showToast(`Hevy: ${reason}`, "error");
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
    setSettingsOpen(false);
    if (next !== "Body") setBodySubPage(null);
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
      // ignore transient network errors
    } finally {
      syncInFlight.current = false;
    }
  }

  async function refreshHistoryAndToday(focusDay = selectedDayRef.current, focusHomeDay = homeDayRef.current) {
    invalidateDayCache();
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
      dayCacheRef.current.set(focusHomeDay, { ...dayCacheRef.current.get(focusHomeDay), daily: freshHome });
      if (homeDayRef.current === focusHomeDay) setHomeDaily(freshHome);
      if (focusDay === focusHomeDay && selectedDayRef.current === focusDay) setSelectedDaily(freshHome);
    }
    if (dayRes?.ok) {
      const value = await dayRes.json();
      dayCacheRef.current.set(focusDay, { ...dayCacheRef.current.get(focusDay), daily: value });
      if (selectedDayRef.current === focusDay) setSelectedDaily(value);
    }
  }

  async function selectHomeDay(day: string) {
    const clamped = day > todayRef.current ? todayRef.current : day;
    homeRequest.current?.abort();
    homeDayRef.current = clamped;
    setHomeDay(clamped);

    const cached = dayCacheRef.current.get(clamped);
    if (cached?.daily) setHomeDaily(cached.daily);
    if (cached?.strain) setHomeStrain(cached.strain);
    if (cached?.recovery) setHomeRecovery(cached.recovery);
    if (cached?.pulse !== undefined) setPulseInsights(cached.pulse);

    const controller = new AbortController();
    homeRequest.current = controller;
    const fitbitActive =
      (settings.trackingMode ?? (settings.preferredEnergySource === "google" ? "fitbit" : "manual")) === "fitbit";
    try {
      const [res, strainRes, pulseRes] = await Promise.all([
        fetch(`/api/nutrition?day=${clamped}`, { signal: controller.signal, cache: "no-store" }),
        fetch(`/api/strain?day=${clamped}`, { signal: controller.signal, cache: "no-store" }).catch(() => null),
        fitbitActive
          ? fetch(`/api/pulse?day=${clamped}`, { signal: controller.signal, cache: "no-store" }).catch(() => null)
          : Promise.resolve(null),
      ]);
      if (res.status === 401) {
        window.location.reload();
        return;
      }
      if (!res.ok) throw new Error("Could not load that date.");
      const value = await res.json();
      const nextCache: DayCacheEntry = { ...dayCacheRef.current.get(clamped), daily: value };
      if (homeDayRef.current === clamped) setHomeDaily(value);
      if (strainRes?.ok) {
        const strainJson = await strainRes.json();
        if (strainJson?.strain) {
          nextCache.strain = strainJson.strain;
          if (homeDayRef.current === clamped) setHomeStrain(strainJson.strain);
        }
        if (strainJson?.recoveryInsights) {
          nextCache.recovery = strainJson.recoveryInsights;
          if (homeDayRef.current === clamped) setHomeRecovery(strainJson.recoveryInsights);
        }
      }
      if (pulseRes?.ok) {
        const pulseJson = (await pulseRes.json()) as PulseInsightsView;
        nextCache.pulse = pulseJson;
        if (homeDayRef.current === clamped) setPulseInsights(pulseJson);
      }
      dayCacheRef.current.set(clamped, nextCache);
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
        invalidateDayCache(day);
        if (trainingDayRef.current === day) setTrainingStrain(json.strain);
        if (homeDayRef.current === day) setHomeStrain(json.strain);
      }
      if (json?.recoveryInsights) {
        if (trainingDayRef.current === day) setTrainingRecovery(json.recoveryInsights);
        if (homeDayRef.current === day) setHomeRecovery(json.recoveryInsights);
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
      invalidateDayCache();
      await Promise.all([selectTrainingDay(trainingDayRef.current), selectHomeDay(homeDayRef.current)]);
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
      invalidateDayCache();
      await Promise.all([selectTrainingDay(trainingDayRef.current), selectHomeDay(homeDayRef.current)]);
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

  function openTrainingForDay(day: string) {
    navigate("Training");
    void selectTrainingDay(day);
  }

  async function selectDay(day: string) {
    dayRequest.current?.abort();
    selectedDayRef.current = day;
    setSelectedDay(day);
    if (day === homeDaily.day) {
      setSelectedDaily(homeDaily);
      setDayLoading(false);
      return;
    }
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
      await refreshHistoryAndToday(selectedDayRef.current, homeDayRef.current).catch(() => {
        refreshed = false;
      });
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

  async function quickLogFood(food: QuickLogSavedFood, day: string): Promise<boolean> {
    const time = localTime(new Date(), settings.timezone);
    const category = food.foodType === "drink" ? "drinks" : "snacks";
    return runNutritionAction(
      {
        action: "log",
        data: {
          day,
          time,
          name: food.name,
          category,
          cookingMethod: food.cookingMethod ?? "",
          ingredients: food.ingredients ?? "",
          notes: "Quick logged",
          idempotencyKey: crypto.randomUUID(),
          items: [
            {
              name: food.name,
              amount: food.defaultAmount ?? 100,
              unit: food.defaultUnit ?? "g",
              calories: food.calories ?? 0,
              proteinG: food.proteinG ?? null,
              carbsG: food.carbsG ?? null,
              fatG: food.fatG ?? null,
              fibreG: food.fibreG ?? null,
              estimationMethod: "pack_label",
              savedFoodId: food.id,
            },
          ],
        },
      },
      `Logged ${food.name}.`,
    );
  }

  async function syncGoogle(days = 14) {
    if (googleSyncLock.current) return;
    googleSyncLock.current = true;
    setToast(null);
    setGoogleSyncPct(10);
    const ticker = window.setInterval(() => {
      setGoogleSyncPct((p) => (p == null ? null : Math.min(72, p + Math.max(1, Math.round((72 - p) * 0.14)))));
    }, 250);
    try {
      const from = addDays(today, 1 - days);
      const res = await fetch("/api/integrations/google/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: today }),
      });
      window.clearInterval(ticker);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message ?? "Google sync failed.");
      if (payload.status) setGoogle(payload.status);
      setGoogleSyncPct(78);
      await refreshAccountAndMeta();
      setGoogleSyncPct(88);
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
            if (j?.recoveryInsights) {
              if (homeDayRef.current === today) setHomeRecovery(j.recoveryInsights);
              if (trainingDayRef.current === today) setTrainingRecovery(j.recoveryInsights);
            }
          })
          .catch(() => undefined),
      ]);
      void refreshSyncToken().catch(() => null);
      setGoogleSyncPct(100);
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      const sleepNote = payload.syncedSleepDays ? ` & ${payload.syncedSleepDays} sleep session(s)` : "";
      showToast(`Synced ${payload.syncedDays} day(s)${sleepNote} from Google Health.`, "success");
    } catch (error) {
      window.clearInterval(ticker);
      showToast(error instanceof Error ? error.message : "Google sync failed.", "error");
    } finally {
      window.clearInterval(ticker);
      setGoogleSyncPct(null);
      googleSyncLock.current = false;
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

  async function createOpenWearablesInvite(): Promise<{ code: string; expiresAt: string | null; apiUrl: string | null } | null> {
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/open-wearables/invite", { method: "POST" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message ?? "Could not generate connection code.");
      if (payload.status) setOpenWearables(payload.status);
      showToast("Open Wearables connection code ready.", "success");
      return {
        code: payload.code,
        expiresAt: payload.expiresAt ?? null,
        apiUrl: payload.apiUrl ?? null,
      };
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not generate connection code.", "error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function syncOpenWearables(days = 14) {
    setBusy(true);
    setToast(null);
    try {
      const from = addDays(today, 1 - days);
      const res = await fetch("/api/integrations/open-wearables/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: today }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message ?? "Open Wearables sync failed.");
      if (payload.status) setOpenWearables(payload.status);
      invalidateDayCache();
      await refreshAccountAndMeta();
      await Promise.all([
        refreshHistoryAndToday(selectedDayRef.current, homeDayRef.current),
        selectTrainingDay(trainingDayRef.current),
        refreshTracker(),
      ]);
      void refreshSyncToken().catch(() => null);
      showToast("Open Wearables data synced.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Open Wearables sync failed.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function disconnectOpenWearables() {
    if (!window.confirm("Disconnect Open Wearables and remove synced Apple Health / Garmin / Health Connect data?")) return;
    setBusy(true);
    setToast(null);
    try {
      const res = await fetch("/api/integrations/open-wearables/disconnect", { method: "POST" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message ?? "Could not disconnect Open Wearables.");
      if (payload.status) setOpenWearables(payload.status);
      invalidateDayCache();
      await refreshAccountAndMeta();
      await Promise.all([
        refreshHistoryAndToday(selectedDayRef.current, homeDayRef.current),
        selectTrainingDay(trainingDayRef.current),
        refreshTracker(),
      ]);
      void refreshSyncToken().catch(() => null);
      showToast("Open Wearables disconnected.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not disconnect Open Wearables.", "error");
    } finally {
      setBusy(false);
    }
  }

  function openNewMeal(day = todayRef.current, openBarcode = false) {
    setComposerDay(day);
    setEditingMeal(null);
    setComposerBarcode(openBarcode);
    setComposerOpen(true);
  }

  function openEditMeal(meal: MealRecord) {
    setEditingMeal(meal);
    setComposerBarcode(false);
    setComposerOpen(true);
  }

  const activeFocusDay = tab === "Today" ? homeDay : tab === "Nutrition" ? selectedDay : today;
  const isFitbitMode =
    (settings.trackingMode ?? (settings.preferredEnergySource === "google" ? "fitbit" : "manual")) === "fitbit" ||
    Boolean(openWearables?.connected);

  const latestWearableSyncMs = Math.max(
    google.connected && google.lastSync ? Date.parse(google.lastSync) || 0 : 0,
    openWearables?.connected && openWearables.lastSync ? Date.parse(openWearables.lastSync) || 0 : 0,
  );
  const wearableSyncFresh = latestWearableSyncMs > 0 && Date.now() - latestWearableSyncMs < 15 * 60 * 1000;

  async function syncConnectedWearables(days?: number) {
    const tasks: Promise<void>[] = [];
    if (google.connected) tasks.push(syncGoogle(days ?? (google.lastSync ? 3 : 14)));
    if (openWearables?.connected) tasks.push(syncOpenWearables(days ?? (openWearables.lastSync ? 3 : 14)));
    await Promise.all(tasks);
  }

  useEffect(() => {
    if (!isFitbitMode) {
      setPulseInsights(null);
      return;
    }
    const cachedPulse = dayCacheRef.current.get(homeDay)?.pulse;
    if (cachedPulse && cachedPulse.day === homeDay) {
      setPulseInsights(cachedPulse);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/pulse?day=${homeDay}`, { cache: "no-store", signal: controller.signal })
      .then(async (res) => (res.ok ? ((await res.json()) as PulseInsightsView) : null))
      .then((data) => {
        if (!controller.signal.aborted && data) {
          dayCacheRef.current.set(homeDay, { ...dayCacheRef.current.get(homeDay), pulse: data });
          setPulseInsights(data);
        }
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [
    isFitbitMode,
    homeDay,
    homeStrain?.computedAt,
    tracker.settings.birthDate,
    tracker.settings.biologicalSex,
    tracker.settings.heightCm,
  ]);

  // Idle adjacent-day prefetch so Prev/Next day stepping renders instantaneously
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const neighbors = [addDays(homeDay, -1)];
      if (homeDay < todayRef.current) neighbors.push(addDays(homeDay, 1));
      for (const targetDay of neighbors) {
        if (dayCacheRef.current.get(targetDay)?.daily) continue;
        void Promise.all([
          fetch(`/api/nutrition?day=${targetDay}`, { signal: controller.signal, cache: "no-store" }).then((r) =>
            r.ok ? (r.json() as Promise<DailyNutritionView>) : null,
          ),
          fetch(`/api/strain?day=${targetDay}`, { signal: controller.signal, cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null),
          isFitbitMode
            ? fetch(`/api/pulse?day=${targetDay}`, { signal: controller.signal, cache: "no-store" })
                .then((r) => (r.ok ? (r.json() as Promise<PulseInsightsView>) : null))
                .catch(() => null)
            : Promise.resolve(null),
        ])
          .then(([dailyRes, strainRes, pulseRes]) => {
            if (controller.signal.aborted || !dailyRes) return;
            dayCacheRef.current.set(targetDay, {
              daily: dailyRes,
              strain: strainRes?.strain,
              recovery: strainRes?.recoveryInsights,
              pulse: pulseRes ?? undefined,
            });
          })
          .catch(() => undefined);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [homeDay, isFitbitMode]);

  useEffect(() => {
    if (!isFitbitMode || trainingDay === homeDay) {
      setTrainingPulse(null);
      return;
    }
    let active = true;
    setTrainingPulse((prev) => (prev?.day === trainingDay ? prev : null));
    fetch(`/api/pulse?day=${trainingDay}`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as PulseInsightsView) : null))
      .then((data) => {
        if (active && data) setTrainingPulse(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [
    isFitbitMode,
    trainingDay,
    homeDay,
    trainingStrain?.computedAt,
    tracker.settings.birthDate,
    tracker.settings.biologicalSex,
    tracker.settings.heightCm,
  ]);

  return (
    <main className="shell">
      <header className="silk-topbar">
        <div className="brand-lockup">
          <span className="brand-badge">
            <McpBrandMark size={24} />
          </span>
          <span style={{ fontSize: ".9rem", letterSpacing: "-0.015em" }}>FitnessTrackr</span>
        </div>
        <div className="silk-topbar-actions">
          {((isFitbitMode && google.connected) || openWearables?.connected) && (
            <button
              type="button"
              className={`secondary compact sync-pill-btn ${googleSyncPct != null ? "is-syncing" : ""}`}
              style={{ ["--sync-pct" as string]: `${googleSyncPct ?? 0}%` }}
              disabled={busy || googleSyncPct != null}
              onClick={() => void syncConnectedWearables()}
              aria-label={
                googleSyncPct != null
                  ? `Syncing wearables ${googleSyncPct}%`
                  : wearableSyncFresh
                    ? "Wearables up to date — tap to force refresh"
                    : "Sync wearables"
              }
            >
              {googleSyncPct != null ? (
                <>
                  <RefreshCw size={13} className="spin" />
                  <span className="num sync-pct-label">{googleSyncPct}%</span>
                </>
              ) : wearableSyncFresh ? (
                <>
                  <Check size={13} style={{ color: "var(--teal)" }} />
                  <span>Up to date</span>
                </>
              ) : (
                <>
                  <RefreshCw size={13} />
                  <span>Sync</span>
                </>
              )}
              {googleSyncPct != null && <span className="sync-pill-fill" aria-hidden="true" />}
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label="Open consistency calendar"
            onClick={() => setCalendarOpen(true)}
          >
            <CalendarDays size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Open settings"
            onClick={() => setSettingsOpen(true)}
          >
            <User size={18} />
          </button>
        </div>
      </header>

      <div className="screen" key={tab}>
        {tab === "Today" && (
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
            pulseInsights={pulseInsights}
            busy={busy}
            onSelectHomeDay={(d) => void selectHomeDay(d)}
            onOpenTraining={openTrainingForDay}
            onOpenTrends={(m) => setTrendsMetric(m)}
            onEditMeal={openEditMeal}
            onSyncGoogle={() => void syncGoogle(google.lastSync ? 3 : 14)}
            onNavigate={navigate}
          />
        )}

        {tab === "Training" && trainingStrain && strainSettings && hevy && (
          <TrainingView
            today={today}
            timezone={settings.timezone}
            selectedDay={trainingDay}
            strain={trainingStrain}
            recoveryInsights={trainingRecovery}
            pulseInsights={trainingDay === homeDay ? pulseInsights : trainingPulse}
            strainSettings={strainSettings}
            hevy={hevy}
            google={google}
            theme="light"
            busy={busy}
            loading={trainingLoading}
            onSelectDay={(d) => void selectTrainingDay(d)}
            onRecomputeDay={(d) => void recomputeStrainDay(d)}
            onImportHevy={importHevy}
            onSyncHevy={syncHevy}
            onOpenSettings={() => setSettingsOpen(true)}
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
            busy={busy}
            loading={dayLoading || selectedDaily.day !== selectedDay}
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

        {tab === "Body" && (
          <MeasurementsView
            snapshot={tracker}
            nutritionSettings={settings}
            history30={history30}
            daily={homeDaily}
            pulseInsights={pulseInsights}
            today={today}
            busy={busy}
            initialSubPage={bodySubPage}
            onClearInitialSubPage={() => setBodySubPage(null)}
            onOpenTrends={(m) => setTrendsMetric(m)}
            onOpenSettings={() => setSettingsOpen(true)}
            onSaveTracker={saveTracker}
            onMessage={(msg) => showToast(msg)}
          />
        )}
      </div>

      {settingsOpen && (
        <div className="silk-overlay" role="dialog" aria-label="Settings & Integrations">
          <div className="silk-overlay-inner">
            <div className="page-header sticky-subpage-header">
              <button
                type="button"
                className="secondary compact"
                style={{ minHeight: "38px" }}
                onClick={() => setSettingsOpen(false)}
              >
                <ArrowLeft size={16} /> Back
              </button>
              <h1 style={{ fontSize: "1.2rem", margin: 0, flex: 1, textAlign: "center" }}>Settings &amp; Profile</h1>
              <div style={{ minWidth: "64px" }} />
            </div>
            <SettingsView
              today={today}
              userName={initial.userName}
              tracker={tracker}
              settings={settings}
              google={google}
              openWearables={openWearables}
              hevy={hevy}
              strainSettings={strainSettings}
              audit={audit}
              mcpEnabled={initial.mcpEnabled}
              busy={busy}
              googleSyncPct={googleSyncPct}
              onSaveTracker={saveTracker}
              onNutritionAction={(action, msg) => runNutritionAction(action as { action: string }, msg)}
              onSaveStrainSettings={saveStrainSettings}
              onImportHevy={importHevy}
              onSyncHevy={syncHevy}
              onDisconnectHevy={disconnectHevy}
              onSyncGoogle={syncGoogle}
              onPushGoogle={pushGoogle}
              onDisconnectGoogle={disconnectGoogle}
              onCreateOpenWearablesInvite={createOpenWearablesInvite}
              onSyncOpenWearables={syncOpenWearables}
              onDisconnectOpenWearables={disconnectOpenWearables}
              onOpenOnboarding={() => {
                setSettingsOpen(false);
                setOnboardingOpen(true);
              }}
              onMessage={(msg) => showToast(msg)}
            />
          </div>
        </div>
      )}

      <OnboardingWizard
        open={onboardingOpen}
        userName={initial.userName}
        today={today}
        tracker={tracker}
        settings={settings}
        google={google}
        openWearables={openWearables}
        hevy={hevy}
        mcpEnabled={initial.mcpEnabled}
        busy={busy}
        onClose={() => setOnboardingOpen(false)}
        onSaveTracker={saveTracker}
        onNutritionAction={(action, msg) => runNutritionAction(action as { action: string }, msg)}
        onImportHevy={importHevy}
        onCreateOpenWearablesInvite={createOpenWearablesInvite}
        onMessage={(msg) => showToast(msg)}
      />

      {toast && (
        <div className="toast-region" aria-live={toast.kind === "error" ? "assertive" : "polite"} aria-atomic="true">
          <div className={`feedback toast-${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"}>
            <span className="toast-text">{toast.text}</span>
            <button type="button" className="toast-dismiss" aria-label="Dismiss notification" onClick={() => setToast(null)}>
              ×
            </button>
          </div>
        </div>
      )}

      {quickLogOpen && (
        <QuickLogModal
          open={quickLogOpen}
          defaultDay={activeFocusDay}
          tracker={tracker}
          google={google}
          hevy={hevy}
          busy={busy}
          onClose={() => setQuickLogOpen(false)}
          onOpenMealComposer={(opts) => openNewMeal(activeFocusDay, Boolean(opts?.openBarcode))}
          onQuickLogFood={quickLogFood}
          onSaveTracker={saveTracker}
          onSyncHevy={syncHevy}
          onSyncGoogle={() => syncGoogle(14)}
          onOpenTraining={() => navigate("Training")}
          onOpenPhysiqueCheckin={() => {
            setBodySubPage("physique");
            navigate("Body");
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {trendsMetric && (
        <MetricTrendsModal
          open={trendsMetric != null}
          initialMetric={trendsMetric}
          today={today}
          history30={history30}
          tracker={tracker}
          settings={settings}
          recoveryInsights={homeRecovery}
          onClose={() => setTrendsMetric(null)}
        />
      )}

      {calendarOpen && (
        <ConsistencyCalendarModal
          open={calendarOpen}
          today={today}
          settings={settings}
          stepsThreshold={strainSettings?.walkingStepThreshold ?? 10500}
          onClose={() => setCalendarOpen(false)}
          onJumpToDay={(day) => {
            navigate("Today");
            void selectHomeDay(day);
          }}
        />
      )}

      {composerOpen && (
        <MealComposer
          defaultDay={composerDay}
          editingMeal={editingMeal}
          initialBarcodeOpen={composerBarcode}
          busy={busy}
          timezone={settings.timezone}
          onClose={() => {
            setComposerOpen(false);
            setComposerBarcode(false);
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

      <nav className="tabs" aria-label="FitnessTrackr views">
        {tabs.slice(0, 2).map(({ title, icon: Icon }) => (
          <button
            key={title}
            type="button"
            aria-current={tab === title ? "page" : undefined}
            onClick={() => navigate(title)}
          >
            <Icon size={20} />
            <span>{title}</span>
          </button>
        ))}
        <button
          className="nav-center-log"
          type="button"
          aria-label="Quick log"
          onClick={() => setQuickLogOpen(true)}
        >
          <Plus size={22} aria-hidden="true" />
        </button>
        {tabs.slice(2).map(({ title, icon: Icon }) => (
          <button
            key={title}
            type="button"
            aria-current={tab === title ? "page" : undefined}
            onClick={() => navigate(title)}
          >
            <Icon size={20} />
            <span>{title}</span>
          </button>
        ))}
      </nav>
    </main>
  );
}
