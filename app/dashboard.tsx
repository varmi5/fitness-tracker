"use client";

import dynamic from "next/dynamic";
import { clearBrowserCache, readBrowserCache, writeBrowserCache } from "../lib/browser-cache";
import { ArrowLeft, CalendarDays, Check, Plus, RefreshCw, Scale, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  FitbitPulseIcon,
  HomeRingIcon,
  McpBrandMark,
  NutritionBowlIcon,
} from "../components/icons";
import type { StartupCacheUpdate } from "../lib/startup-cache";
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

const PAST_WEEK_DAYS = 7;
const CURRENT_DAY_TTL = 60_000;
const PAST_DAY_TTL = 5 * 60_000;
type DayPart = "daily" | "strain" | "pulse";
type DayCacheEntry = {
  daily?: DailyNutritionView;
  strain?: DailyStrainView;
  recovery?: RecoveryInsightView;
  pulse?: PulseInsightsView | null;
  fetchedAt?: Partial<Record<DayPart, number>>;
};

const tabs: { title: AppTab; icon: typeof HomeRingIcon | typeof Scale }[] = [
  { title: "Today", icon: HomeRingIcon },
  { title: "Training", icon: FitbitPulseIcon },
  { title: "Nutrition", icon: NutritionBowlIcon },
  { title: "Body", icon: Scale },
];

export function Dashboard({ initial, savedAt, updateStartupCache }: {
  initial: InitialAppData;
  savedAt: number;
  updateStartupCache: (update: StartupCacheUpdate) => Promise<void>;
}) {
  const initialCalendarToday = initial.calendarToday ?? initial.today;
  const initialActiveDay = initial.activeDay ?? initial.daily.day ?? initialCalendarToday;

  const [tab, setTab] = useState<AppTab>("Today");
  const [tracker, setTracker] = useState(initial.tracker);
  const trackerRevision = useRef(0);
  const [settings, setSettings] = useState(initial.settings);
  const [today, setToday] = useState(initialCalendarToday);
  const todayRef = useRef(initialCalendarToday);
  const tzRef = useRef(initial.settings.timezone);

  const [activeHomeDay, setActiveHomeDay] = useState(initialActiveDay);
  const activeHomeDayRef = useRef(initialActiveDay);
  const [showSleep, setShowSleep] = useState(Boolean(initial.showSleep));
  const showSleepRef = useRef(Boolean(initial.showSleep));
  const waitingForSleepRef = useRef(Boolean(initial.waitingForSleep));

  const [homeDay, setHomeDay] = useState(initialActiveDay);
  const homeDayRef = useRef(initialActiveDay);
  const homeSelection = useRef(0);
  const [homeDaily, setHomeDaily] = useState<DailyNutritionView>(initial.daily);

  const selectedDayRef = useRef(initialActiveDay);
  const diarySelection = useRef(0);
  const actionLock = useRef(false);
  const syncTokenRef = useRef(initial.syncToken);
  const syncInFlight = useRef(false);
  const incomingRefreshQueue = useRef(Promise.resolve());
  const diaryRefreshQueue = useRef(Promise.resolve());
  const lastSyncCheckRef = useRef(Date.now());

  const lastToday = useRef(initialCalendarToday);
  const [selectedDay, setSelectedDay] = useState(initialActiveDay);
  const [selectedDaily, setSelectedDaily] = useState<DailyNutritionView>(initial.daily);
  const [homeStrain, setHomeStrain] = useState<DailyStrainView | undefined>(initial.strain);
  const [trainingDay, setTrainingDay] = useState(initialActiveDay);
  const trainingDayRef = useRef(initialActiveDay);
  const trainingSelection = useRef(0);
  const [trainingStrain, setTrainingStrain] = useState<DailyStrainView | undefined>(initial.strain);
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [strainSettings, setStrainSettings] = useState<StrainSettings | undefined>(initial.strainSettings);
  const [hevy, setHevy] = useState<HevyIntegrationStatus | undefined>(initial.hevy);
  const [homeRecovery, setHomeRecovery] = useState<RecoveryInsightView | undefined>(initial.recoveryInsights);
  const [trainingRecovery, setTrainingRecovery] = useState<RecoveryInsightView | undefined>(initial.recoveryInsights);
  const [pulseInsights, setPulseInsights] = useState<PulseInsightsView | null>(initial.pulseInsights ?? null);
  const [trainingPulse, setTrainingPulse] = useState<PulseInsightsView | null>(initial.pulseInsights ?? null);

  const dayCacheRef = useRef(new Map<string, DayCacheEntry>());
  const invalidatedAt = useRef(0);
  const invalidatedDays = useRef(new Map<string, number>());
  const discardedAt = useRef(0);
  const expiredSession = useRef(false);
  const dayRequests = useRef(new Map<string, { controller: AbortController; promise: Promise<void> }>());

  function rememberDay(day: string, entry: DayCacheEntry) {
    const cache = dayCacheRef.current;
    cache.delete(day);
    cache.set(day, entry);
    if (cache.size > 180) cache.delete(cache.keys().next().value!);
  }

  async function cacheDay(day: string, result: DayCacheEntry, updateStartup = true) {
    const previous = dayCacheRef.current.get(day);
    const entry = { ...previous, ...result, fetchedAt: { ...previous?.fetchedAt, ...result.fetchedAt } };
    rememberDay(day, entry);
    if (initial.userId) void writeBrowserCache(initial.userId, `day:${day}`, entry);
    if (!updateStartup || day !== activeHomeDayRef.current) return;
    await updateStartupCache((snapshot) => {
      if (snapshot.activeDay !== day) return null;
      return {
        ...(result.daily ? { daily: result.daily } : {}),
        ...(result.strain ? { strain: result.strain, recoveryInsights: result.recovery } : {}),
        ...("pulse" in result ? { pulseInsights: result.pulse } : {}),
      };
    });
  }

  async function readSavedDay(day: string) {
    const memory = dayCacheRef.current.get(day);
    if (memory?.daily || !initial.userId) return memory;
    const discardVersion = discardedAt.current;
    const saved = await readBrowserCache<DayCacheEntry>(initial.userId, `day:${day}`);
    const current = dayCacheRef.current.get(day);
    if (discardVersion !== discardedAt.current || current?.daily || saved?.value.daily?.day !== day) return current;
    const entry = { ...saved.value, ...current, fetchedAt: { ...saved.value.fetchedAt, ...current?.fetchedAt } };
    rememberDay(day, entry);
    return entry;
  }

  function invalidateDayCache(day?: string, discard = false) {
    // Keep stale snapshots usable while changes are revalidated.
    if (day) invalidatedDays.current.set(day, Date.now());
    else {
      invalidatedAt.current = Date.now();
      invalidatedDays.current.clear();
    }
    for (const [key, request] of dayRequests.current) {
      if (day && !key.startsWith(`${day}:`)) continue;
      request.controller.abort();
      dayRequests.current.delete(key);
    }
    if (discard) {
      discardedAt.current++;
      dayCacheRef.current.clear();
    }
  }

  function loadDayPart(day: string, part: DayPart, force = false): Promise<void> {
    if (expiredSession.current) return Promise.resolve();
    const cached = dayCacheRef.current.get(day);
    const timestamp = cached?.fetchedAt?.[part] ?? 0;
    const ttl = day === todayRef.current ? CURRENT_DAY_TTL : PAST_DAY_TTL;
    const invalidated = Math.max(invalidatedAt.current, invalidatedDays.current.get(day) ?? 0);
    const hasValue = part === "pulse" ? cached?.pulse !== undefined : cached?.[part] != null;
    if (!force && hasValue && timestamp >= invalidated && Date.now() - timestamp < ttl) {
      return Promise.resolve();
    }

    const key = `${day}:${part}`;
    const pending = dayRequests.current.get(key);
    if (pending) return pending.promise;

    const controller = new AbortController();
    const endpoint = part === "daily" ? "nutrition" : part;
    const promise = (async () => {
      const response = await fetch(`/api/${endpoint}?day=${day}`, {
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      if (controller.signal.aborted) return;
      if (response.status === 401) {
        expiredSession.current = true;
        invalidateDayCache(undefined, true);
        void clearBrowserCache().finally(() => window.location.reload());
        return;
      }
      if (!response.ok) throw new Error(`Could not load ${endpoint} (HTTP ${response.status}).`);
      const payload = await response.json();
      if (controller.signal.aborted) return;
      const fetchedAt = { [part]: Date.now() };
      if (part === "daily" && payload?.day === day) await cacheDay(day, { daily: payload, fetchedAt });
      else if (part === "strain") await cacheDay(day, { strain: payload.strain, recovery: payload.recoveryInsights, fetchedAt });
      else if (part === "pulse") await cacheDay(day, { pulse: payload, fetchedAt });
      else throw new Error("The diary returned a different date.");
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) throw error;
    }).finally(() => {
      if (dayRequests.current.get(key)?.controller === controller) dayRequests.current.delete(key);
    });
    dayRequests.current.set(key, { controller, promise });
    return promise;
  }

  function showHomeDay(day: string, entry: DayCacheEntry | undefined) {
    if (!entry?.daily) return;
    setHomeDay(day);
    setHomeDaily(entry.daily);
    setHomeStrain(entry.strain);
    setHomeRecovery(entry.recovery);
    setPulseInsights(isFitbitMode ? entry.pulse ?? null : null);
  }

  const [history30, setHistory30] = useState(initial.history30);
  const [google, setGoogle] = useState(initial.google);
  const [openWearables, setOpenWearables] = useState<OpenWearablesIntegrationStatus | undefined>(initial.openWearables);
  const wearableMode = useRef(false);
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
  const [quickLogMounted, setQuickLogMounted] = useState(false);
  const [mcpConnected, setMcpConnected] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const check = () => {
      if (document.visibilityState !== "visible") return;
      void fetch("/api/mcp-status", { cache: "no-store", signal: controller.signal })
        .then(async r => r.ok ? r.json() : null)
        .then(data => { if (!controller.signal.aborted) setMcpConnected(data ? data.connected === true : null); })
        .catch(() => { if (!controller.signal.aborted) setMcpConnected(null); });
    };
    check(); document.addEventListener("visibilitychange", check);
    return () => { controller.abort(); document.removeEventListener("visibilitychange", check); };
  }, [quickLogOpen]);
  const [trendsMetric, setTrendsMetric] = useState<TrendMetricKind | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [dataSourcesOpen, setDataSourcesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(Boolean(initial.settings.needsOnboarding));
  const [onboardingInitialStep, setOnboardingInitialStep] = useState(1);
  const [bodySubPage, setBodySubPage] = useState<"physique" | null>(null);

  // A fresh bootstrap updates current views without resetting the user's open tab/date.
  useEffect(() => {
    setTracker(initial.tracker); setSettings(initial.settings);
    setGoogle(initial.google); setHevy(initial.hevy); setOpenWearables(initial.openWearables);
    setHistory30(initial.history30); setAudit(initial.audit);
    const previousActive = activeHomeDayRef.current;
    todayRef.current = initial.calendarToday; setToday(initial.calendarToday);
    activeHomeDayRef.current = initial.activeDay; setActiveHomeDay(initial.activeDay);
    showSleepRef.current = initial.showSleep;
    waitingForSleepRef.current = Boolean(initial.waitingForSleep);
    setShowSleep(initial.showSleep);
    if (homeDayRef.current === previousActive) homeDayRef.current = initial.activeDay;
    if (selectedDayRef.current === previousActive) { selectedDayRef.current = initial.activeDay; setSelectedDay(initial.activeDay); }
    if (trainingDayRef.current === previousActive) {
      trainingDayRef.current = initial.activeDay;
      setTrainingDay(initial.activeDay);
      setTrainingStrain(initial.strain);
      setTrainingRecovery(initial.recoveryInsights);
    }
    const existing = dayCacheRef.current.get(initial.daily.day);
    if ((existing?.fetchedAt?.daily ?? 0) <= savedAt) {
      void cacheDay(initial.daily.day, {
        daily: initial.daily,
        ...(initial.strain ? { strain: initial.strain } : {}),
        ...(initial.recoveryInsights ? { recovery: initial.recoveryInsights } : {}),
        pulse: initial.pulseInsights ?? undefined,
        fetchedAt: { daily: savedAt, ...(initial.strain ? { strain: savedAt } : {}), ...(initial.pulseInsights ? { pulse: savedAt } : {}) },
      }, false);
    }
    const entry = dayCacheRef.current.get(initial.daily.day);
    if (homeDayRef.current === initial.daily.day) showHomeDay(initial.daily.day, entry);
    if (selectedDayRef.current === initial.daily.day && entry?.daily) setSelectedDaily(entry.daily);
  }, [initial, savedAt]);

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

  // Observe pairing on return from the mobile app, without issuing another invitation.
  useEffect(() => {
    if (!openWearables?.owUserId || openWearables.connected) return;
    const controller = new AbortController();
    let running = false;
    const check = async () => {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const res = await fetch("/api/integrations/open-wearables/status", { signal: controller.signal, cache: "no-store" });
        const payload = await res.json();
        if (res.ok && !controller.signal.aborted && payload.status) {
          await updateStartupCache(() => ({ openWearables: payload.status }));
          if (!controller.signal.aborted) setOpenWearables(payload.status);
        }
      } catch { /* Retry quietly on the next check; never restart pairing automatically. */ }
      finally { running = false; }
    };
    void check();
    const timer = window.setInterval(() => void check(), 15000);
    document.addEventListener("visibilitychange", check);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [openWearables?.owUserId, openWearables?.connected]);

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
                if (payload?.status && active) {
                  setHevy(payload.status);
                  void updateStartupCache(() => ({ hevy: payload.status }));
                }
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
          await refreshIncomingData().catch(() => undefined);
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
    const formatOAuthError = (reason: string | null) => {
      switch (reason) {
        case "expired":
          return "Connection session expired — please tap Connect again.";
        case "signed-out":
          return "Please sign in again before connecting.";
        case "denied":
        case "cancelled":
          return "Connection was cancelled.";
        case "state-mismatch":
        case "invalid-state":
          return "Security check did not match — please try connecting again.";
        case "missing-code":
          return "No authorization code was returned — please try again.";
        case "not-configured":
          return "This integration is not configured on the server.";
        default:
          return reason || "connection failed";
      }
    };

    const reqOnboarding = Number(params.get("onboarding"));
    if (Number.isInteger(reqOnboarding) && reqOnboarding >= 1 && reqOnboarding <= 5) {
      setOnboardingInitialStep(reqOnboarding);
      setOnboardingOpen(true);
    }

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
      void updateStartupCache(() => ({ google: initial.google }));
      showToast(
        initial.google.status === "sync_failed"
          ? "Google Health connected. The first sync failed; try Sync again in Settings."
          : "Google Health connected.",
        initial.google.status === "sync_failed" ? "info" : "success",
      );
      window.history.replaceState({}, "", "/");
    } else if (googleState === "error") {
      showToast(`Google Health: ${formatOAuthError(params.get("reason"))}`, "error");
      window.history.replaceState({}, "", "/");
    }
    const hevyState = params.get("hevy");
    if (hevyState === "connected") {
      void updateStartupCache(() => ({ hevy: initial.hevy }));
      showToast(
        initial.hevy.status === "sync_failed"
          ? "Hevy connected. Tap Sync Hevy to refresh your workout history."
          : "Hevy connected and workouts synced.",
        initial.hevy.status === "sync_failed" ? "info" : "success",
      );
      window.history.replaceState({}, "", "/");
    } else if (hevyState === "error") {
      showToast(`Hevy: ${formatOAuthError(params.get("reason"))}`, "error");
      window.history.replaceState({}, "", "/");
    } else if (Number.isInteger(reqOnboarding) && reqOnboarding >= 1 && reqOnboarding <= 5) {
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
    void refreshIncomingData().catch(() => showToast("Could not refresh the diary. Try again.", "error"));
  }, [today]);

  useEffect(() => () => {
    for (const request of dayRequests.current.values()) request.controller.abort();
    dayRequests.current.clear();
  }, []);

  function navigate(next: AppTab) {
    setToast(null);
    setSettingsOpen(false);
    if (next !== "Body") setBodySubPage(null);
    setTab(next);
    if (next === "Training" && !trainingStrain) void selectTrainingDay(trainingDayRef.current);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function saveTrackerSnapshot(data: InitialAppData["tracker"], revision: number) {
    if (trackerRevision.current !== revision) return;
    await updateStartupCache(() => ({ tracker: data }));
    if (trackerRevision.current === revision) setTracker(data);
  }

  async function refreshTracker() {
    const revision = ++trackerRevision.current;
    const res = await fetch("/api/tracker", { cache: "no-store" });
    if (res.status === 401) {
      void clearBrowserCache().finally(() => window.location.reload());
      return;
    }
    if (!res.ok) throw new Error("Could not refresh saved measurements.");
    await saveTrackerSnapshot(await res.json(), revision);
  }

  async function refreshAccountAndMeta() {
    const res = await fetch("/api/nutrition", { cache: "no-store" });
    if (res.status === 401) {
      void clearBrowserCache().finally(() => window.location.reload());
      return;
    }
    if (!res.ok) return;
    const payload = await res.json();
    await updateStartupCache(() => ({
      ...(payload.settings ? { settings: payload.settings } : {}),
      ...(payload.google ? { google: payload.google } : {}),
      ...(payload.hevy ? { hevy: payload.hevy } : {}),
      ...(payload.openWearables ? { openWearables: payload.openWearables } : {}),
      ...(Array.isArray(payload.audit) ? { audit: payload.audit } : {}),
    }));
    if (payload.settings) setSettings(payload.settings);
    if (payload.google) setGoogle(payload.google);
    if (payload.hevy) setHevy(payload.hevy);
    if (payload.openWearables) setOpenWearables(payload.openWearables);
    if (payload.settings && payload.openWearables) {
      wearableMode.current = payload.settings.trackingMode === "fitbit" || Boolean(payload.openWearables.connected);
    }
    if (Array.isArray(payload.audit)) setAudit(payload.audit);
    if (payload.homeState) {
      const hs = payload.homeState as {
        calendarToday?: string;
        activeDay?: string;
        showSleep?: boolean;
        waitingForSleep?: boolean;
      };
      if (hs.calendarToday && hs.calendarToday !== todayRef.current) {
        todayRef.current = hs.calendarToday;
        setToday(hs.calendarToday);
      }
      if (hs.activeDay) {
        const prevActive = activeHomeDayRef.current;
        activeHomeDayRef.current = hs.activeDay;
        setActiveHomeDay(hs.activeDay);
        if (homeDayRef.current === prevActive) homeDayRef.current = hs.activeDay;
        if (selectedDayRef.current === prevActive) selectedDayRef.current = hs.activeDay;
        if (trainingDayRef.current === prevActive && hs.activeDay !== prevActive) {
          ++trainingSelection.current;
          trainingDayRef.current = hs.activeDay;
          const cached = dayCacheRef.current.get(hs.activeDay);
          setTrainingDay(hs.activeDay);
          setTrainingStrain(cached?.strain);
          setTrainingRecovery(cached?.recovery);
          setTrainingPulse(cached?.pulse ?? null);
          setTrainingLoading(false);
        }
      }
      showSleepRef.current = Boolean(hs.showSleep);
      waitingForSleepRef.current = Boolean(hs.waitingForSleep);
      setShowSleep(showSleepRef.current);
    }
  }

  async function refreshSyncToken() {
    const res = await fetch("/api/nutrition?sync=1", { cache: "no-store" });
    if (res.status === 401) {
      void clearBrowserCache().finally(() => window.location.reload());
      return;
    }
    if (res.ok) {
      const data = (await res.json()) as { token?: string };
      if (data.token) syncTokenRef.current = data.token;
    }
  }

  function refreshIncomingData() {
    // Google Health and Open Wearables can finish together. Re-read after each
    // committed sync without aborting another provider's refresh.
    const task = incomingRefreshQueue.current.then(async () => {
      await refreshAccountAndMeta();
      await Promise.all([refreshHistoryAndToday(true), refreshTracker()]);
      await selectTrainingDay(trainingDayRef.current);
    });
    incomingRefreshQueue.current = task.catch(() => undefined);
    return task;
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
        void clearBrowserCache().finally(() => window.location.reload());
        return;
      }
      if (!res.ok) return;
      const { token } = (await res.json()) as { token?: string };
      if (!token || token === syncTokenRef.current) return;
      await refreshIncomingData();
      syncTokenRef.current = token;
      window.dispatchEvent(new Event("fitnesstrackr:sync"));
    } catch {
      // ignore transient network errors
    } finally {
      syncInFlight.current = false;
    }
  }

  function refreshHistoryAndToday(waitForHealth = false) {
    const task = diaryRefreshQueue.current.then(() => refreshDiaryData(waitForHealth));
    diaryRefreshQueue.current = task.catch(() => undefined);
    return task;
  }

  async function refreshDiaryData(waitForHealth: boolean) {
    const focusDay = selectedDayRef.current;
    const focusHomeDay = homeDayRef.current;
    invalidateDayCache();
    const calendarToday = todayRef.current;
    const activeDay = activeHomeDayRef.current;
    const days = new Set([focusHomeDay, focusDay, activeDay]);
    const [history] = await Promise.all([
      fetch(`/api/nutrition?from=${addDays(calendarToday, -29)}&to=${calendarToday}`, { cache: "no-store" }),
      ...[...days].map((day) => loadDayPart(day, "daily")),
    ]);
    if (history.status === 401) {
      invalidateDayCache(undefined, true);
      void clearBrowserCache().finally(() => window.location.reload());
      return;
    }
    if (!history.ok) throw new Error("Could not refresh the diary.");
    const recent = await history.json();
    await updateStartupCache(() => ({ history30: recent }));
    setHistory30(recent);
    if (homeDayRef.current === focusHomeDay) {
      showHomeDay(focusHomeDay, dayCacheRef.current.get(focusHomeDay));
      if (focusHomeDay !== activeDay) void refreshHomeMetrics(focusHomeDay);
    }
    const diary = dayCacheRef.current.get(focusDay)?.daily;
    if (selectedDayRef.current === focusDay && diary) {
      setSelectedDay(focusDay);
      setSelectedDaily(diary);
    }
    const refreshActiveHealth = async () => {
      await refreshHomeMetrics(activeDay);
      const active = dayCacheRef.current.get(activeDay);
      if (active?.daily && calendarToday === todayRef.current && activeDay === activeHomeDayRef.current) {
        await updateStartupCache(() => ({
          today: calendarToday,
          calendarToday,
          activeDay,
          showSleep: showSleepRef.current,
          waitingForSleep: waitingForSleepRef.current,
          daily: active.daily,
          strain: active.strain,
          recoveryInsights: active.recovery,
          pulseInsights: wearableMode.current ? active.pulse ?? null : null,
        }));
      }
    };
    if (waitForHealth) await refreshActiveHealth();
    else void refreshActiveHealth();
  }

  async function refreshHomeMetrics(day: string) {
    await Promise.allSettled([loadDayPart(day, "strain"), wearableMode.current ? loadDayPart(day, "pulse") : undefined]);
    if (homeDayRef.current === day) showHomeDay(day, dayCacheRef.current.get(day));
  }

  async function selectHomeDay(day: string) {
    const target = day > todayRef.current ? todayRef.current : day;
    const selection = ++homeSelection.current;
    homeDayRef.current = target;
    const cached = dayCacheRef.current.get(target)?.daily
      ? dayCacheRef.current.get(target)
      : await readSavedDay(target);
    if (homeSelection.current !== selection || homeDayRef.current !== target) return;
    showHomeDay(target, cached);

    try {
      await loadDayPart(target, "daily");
      if (homeSelection.current === selection && homeDayRef.current === target) {
        showHomeDay(target, dayCacheRef.current.get(target));
        void refreshHomeMetrics(target);
      }
    } catch {
      if (homeSelection.current === selection && homeDayRef.current === target && !cached?.daily) {
        homeDayRef.current = homeDay;
        showToast("Could not load that date. Try again.", "error");
      }
    }
  }

  async function selectTrainingDay(day: string, force = false) {
    const target = day > todayRef.current ? todayRef.current : day;
    const selection = ++trainingSelection.current;
    const dateChanged = trainingDayRef.current !== target;
    trainingDayRef.current = target;
    setTrainingDay(target);
    const cached = dayCacheRef.current.get(target);
    if (dateChanged || cached?.strain) {
      setTrainingStrain(cached?.strain);
      setTrainingRecovery(cached?.recovery);
    }
    if (dateChanged) setTrainingPulse(cached?.pulse ?? null);
    setTrainingLoading(!cached?.strain);
    try {
      await readSavedDay(target);
      if (trainingSelection.current !== selection) return;
      await loadDayPart(target, "strain", force);
      if (trainingSelection.current === selection && trainingDayRef.current === target) {
        const entry = dayCacheRef.current.get(target);
        if (entry?.strain) setTrainingStrain(entry.strain);
        setTrainingRecovery(entry?.recovery);
      }
    } catch {
      if (trainingSelection.current === selection && !cached?.strain) showToast("Could not load strain for that date.", "error");
    } finally {
      if (trainingSelection.current === selection) setTrainingLoading(false);
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
        await cacheDay(day, { strain: json.strain, recovery: json.recoveryInsights, fetchedAt: { strain: Date.now() } });
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
      if (json?.settings) {
        await updateStartupCache(() => ({ strainSettings: json.settings }));
        setStrainSettings(json.settings);
      }
      invalidateDayCache();
      if (json?.strain) {
        await cacheDay(todayRef.current, { strain: json.strain, recovery: json.recoveryInsights, fetchedAt: { strain: Date.now() } });
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
      if (json?.status) {
        setHevy(json.status);
        await updateStartupCache(() => ({ hevy: json.status }));
      }
      await refreshIncomingData();
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
      if (json?.status) {
        setHevy(json.status);
        await updateStartupCache(() => ({ hevy: json.status }));
      }
      await refreshIncomingData();
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
      if (json?.status) {
        setHevy(json.status);
        await updateStartupCache(() => ({ hevy: json.status }));
      }
      void refreshSyncToken().catch(() => null);
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
    const selection = ++diarySelection.current;
    selectedDayRef.current = day;
    const cached = dayCacheRef.current.get(day)?.daily
      ? dayCacheRef.current.get(day)
      : await readSavedDay(day);
    if (diarySelection.current !== selection || selectedDayRef.current !== day) return;
    if (cached?.daily) {
      setSelectedDaily(cached.daily);
      setSelectedDay(day);
    }

    try {
      await loadDayPart(day, "daily");
      const daily = dayCacheRef.current.get(day)?.daily;
      if (diarySelection.current === selection && selectedDayRef.current === day && daily) {
        setSelectedDaily(daily);
        setSelectedDay(day);
      }
    } catch {
      if (diarySelection.current === selection && selectedDayRef.current === day && !cached?.daily) {
        selectedDayRef.current = selectedDay;
        showToast("Could not load that date. Try again.", "error");
      }
    }
  }

  async function saveTracker(action: object, successMessage: string): Promise<boolean> {
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
        await clearBrowserCache();
        location.reload();
        return true;
      }
      await saveTrackerSnapshot(payload, ++trackerRevision.current);
      await refreshHistoryAndToday();
      void refreshSyncToken().catch(() => null);
      showToast(successMessage, "success");
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not save.", "error");
      return false;
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

      const sourceRulesChanged = action.action === "preferences" && Boolean((action.data as { sourceSettings?: object })?.sourceSettings);
      if (action.action === "delete" || sourceRulesChanged) {
        invalidateDayCache(undefined, true);
        await clearBrowserCache();
      }
      const savedDay = typeof payload.day === "object" ? payload.day : payload.meals ? payload : null;
      if (savedDay) {
        await cacheDay(savedDay.day, { daily: savedDay, fetchedAt: { daily: Date.now() } });
        if (savedDay.day === homeDayRef.current) showHomeDay(savedDay.day, dayCacheRef.current.get(savedDay.day));
        if (savedDay.day === selectedDayRef.current) {
          setSelectedDay(savedDay.day);
          setSelectedDaily(savedDay);
        }
      }
      const previousTrainingDay = trainingDayRef.current;
      if (action.action === "target" || action.action === "macro-targets" || action.action === "preferences") {
        await updateStartupCache(() => ({ settings: payload }));
        setSettings(payload);
        if (action.action === "preferences") {
          await refreshAccountAndMeta().catch(() => null);
        }
      } else if (action.action === "revoke-mcp") {
        await updateStartupCache(() => ({ audit: [] }));
        setAudit([]);
        setMcpConnected(false);
      }
      let refreshed = true;
      await refreshHistoryAndToday(sourceRulesChanged).catch(() => {
        refreshed = false;
      });
      if (action.action === "preferences" && (sourceRulesChanged || trainingDayRef.current !== previousTrainingDay)) {
        void selectTrainingDay(trainingDayRef.current);
      }
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
      await fetch("/api/strain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recompute", day: today }),
      }).catch(() => null);
      setGoogleSyncPct(88);
      await refreshIncomingData();
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
        if (payload.status) {
          setGoogle(payload.status);
          void updateStartupCache(() => ({ google: payload.status }));
        }
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
      invalidateDayCache(undefined, true);
      await clearBrowserCache();
      await refreshIncomingData();
      void refreshSyncToken().catch(() => null);
      showToast("Google Health disconnected and synced data removed.", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not disconnect.", "error");
    } finally {
      setBusy(false);
    }
  }

  async function createOpenWearablesInvite(reset = false): Promise<{ code: string; expiresAt: string | null; apiUrl: string | null } | null> {
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/open-wearables/invite", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reset }) });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message ?? "Could not generate connection code.");
      if (payload.status) {
        setOpenWearables(payload.status);
        void updateStartupCache(() => ({ openWearables: payload.status }));
      }
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
      await refreshIncomingData();
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
      invalidateDayCache(undefined, true);
      await clearBrowserCache();
      await refreshIncomingData();
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
    wearableMode.current = isFitbitMode;
    if (isFitbitMode) void refreshHomeMetrics(homeDayRef.current);
    else setPulseInsights(null);
  }, [isFitbitMode]);

  // Warm today and the previous seven dates after rendering the initial view.
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      const days = Array.from({ length: PAST_WEEK_DAYS + 1 }, (_, offset) => addDays(today, -offset));
      void (async () => {
        for (const day of days) {
          if (!active) return;
          await readSavedDay(day);
        }
        for (let i = 0; i < days.length; i += 2) {
          if (!active) return;
          await Promise.allSettled(days.slice(i, i + 2).map((day) => loadDayPart(day, "daily")));
        }
        for (const day of days) {
          if (!active) return;
          await Promise.allSettled([loadDayPart(day, "strain"), isFitbitMode ? loadDayPart(day, "pulse") : undefined]);
          if (active && homeDayRef.current === day) showHomeDay(day, dayCacheRef.current.get(day));
        }
      })();
    }, 150);
    return () => { active = false; window.clearTimeout(timer); };
  }, [today, isFitbitMode]);

  useEffect(() => {
    if (tab !== "Training" || !isFitbitMode || trainingDay === homeDay) return;
    let active = true;
    const cached = dayCacheRef.current.get(trainingDay);
    setTrainingPulse(cached?.pulse ?? null);
    void readSavedDay(trainingDay)
      .then(() => loadDayPart(trainingDay, "pulse"))
      .then(() => {
        if (active) setTrainingPulse(dayCacheRef.current.get(trainingDay)?.pulse ?? null);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [tab, isFitbitMode, trainingDay, homeDay, trainingStrain?.computedAt]);

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
        {tab === "Today" && homeDaily.day !== homeDay && <p className="startup-status" role="status">Loading {homeDay}…</p>}
        {tab === "Today" && homeDaily.day === homeDay && (
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

        {tab === "Training" && !trainingStrain && (
          <div className="card">
            {trainingLoading ? <p role="status">Loading training…</p> : (
              <button type="button" className="secondary" onClick={() => void selectTrainingDay(trainingDayRef.current, true)}>
                Refresh training data
              </button>
            )}
          </div>
        )}

        {tab === "Training" && trainingStrain && strainSettings && hevy && (
          <TrainingView
            today={today}
            timezone={settings.timezone}
            selectedDay={trainingDay}
            strain={trainingStrain}
            recoveryInsights={trainingRecovery}
            pulseInsights={isFitbitMode ? (trainingDay === homeDay ? pulseInsights : trainingPulse) : null}
            strainSettings={strainSettings}
            hevy={hevy}
            google={google}
            openWearables={openWearables}
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
            loading={selectedDaily.day !== selectedDay}
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
            onSaveTracker={async (action, msg) => { await saveTracker(action, msg); }}
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
                onClick={() => dataSourcesOpen ? setDataSourcesOpen(false) : setSettingsOpen(false)}
              >
                <ArrowLeft size={16} /> Back
              </button>
              <h1 style={{ fontSize: "1.2rem", margin: 0, flex: 1, textAlign: "center" }}>{dataSourcesOpen ? "Data Sources" : "Settings & Profile"}</h1>
              <div style={{ minWidth: "64px" }} />
            </div>
            <SettingsView
              today={today}
              day={homeDaily}
              pulse={pulseInsights}
              dataSourcesOpen={dataSourcesOpen}
              setDataSourcesOpen={setDataSourcesOpen}
              userName={initial.userName}
              tracker={tracker}
              settings={settings}
              google={google}
              openWearables={openWearables}
              hevy={hevy}
              strainSettings={strainSettings}
              audit={audit}
              mcpEnabled={initial.mcpEnabled}
              mcpUrl={initial.mcpUrl}
              emailResetEnabled={initial.emailResetEnabled}
              busy={busy}
              googleSyncPct={googleSyncPct}
              onSaveTracker={async (action, msg) => { await saveTracker(action, msg); }}
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
                setOnboardingInitialStep(1);
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
        initialStep={onboardingInitialStep}
        userName={initial.userName}
        today={today}
        tracker={tracker}
        settings={settings}
        google={google}
        openWearables={openWearables}
        hevy={hevy}
        mcpEnabled={initial.mcpEnabled}
        mcpUrl={initial.mcpUrl}
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

      {quickLogMounted && (
        <QuickLogModal
          open={quickLogOpen}
          defaultDay={activeFocusDay}
          mcpConnected={mcpConnected}
          tracker={tracker}
          google={google}
          hevy={hevy}
          busy={busy}
          onClose={() => setQuickLogOpen(false)}
          onOpenMealComposer={(opts) => openNewMeal(activeFocusDay, Boolean(opts?.openBarcode))}
          onQuickLogFood={quickLogFood}
          onSaveTracker={async (action, msg) => { await saveTracker(action, msg); }}
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
          daily={homeDaily}
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
          onClick={() => { setQuickLogMounted(true); setQuickLogOpen(true); }}
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
