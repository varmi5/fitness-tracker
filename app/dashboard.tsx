"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import {
  HomeRingIcon,
  MeasurementsCaliperIcon,
  NutritionBowlIcon,
  SettingsSlidersIcon,
} from "../components/icons";
import type { DailyNutritionView, MealRecord } from "../lib/nutrition-data";
import { addDays } from "../lib/nutrition-model";
import { HomeView } from "./home-view";
import { MeasurementsView } from "./measurements-view";
import { NutritionView } from "./nutrition-view";
import { SettingsView } from "./settings-view";
import type { AppTab, InitialAppData } from "./types";

const MealComposer = dynamic(() => import("./meal-composer").then((m) => m.MealComposer), {
  ssr: false,
});

const tabs: { title: AppTab; icon: typeof HomeRingIcon }[] = [
  { title: "Home", icon: HomeRingIcon },
  { title: "Nutrition", icon: NutritionBowlIcon },
  { title: "Measurements", icon: MeasurementsCaliperIcon },
  { title: "Settings", icon: SettingsSlidersIcon },
];

export function Dashboard({ initial }: { initial: InitialAppData }) {
  const [tab, setTab] = useState<AppTab>("Home");
  const [tracker, setTracker] = useState(initial.tracker);
  const [settings, setSettings] = useState(initial.settings);
  const [today] = useState(initial.today);
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reqTab = params.get("tab") as AppTab | null;
    if (reqTab && tabs.some((t) => t.title === reqTab)) setTab(reqTab);
    const googleState = params.get("google");
    if (googleState === "connected") {
      setMessage("Google Health connected and synced.");
      window.history.replaceState({}, "", "/");
    } else if (googleState === "error") {
      const reason = params.get("reason") ?? "connection failed";
      setMessage(`Google Health: ${reason}`);
      window.history.replaceState({}, "", "/");
    }
  }, []);

  function navigate(next: AppTab) {
    setMessage("");
    setTab(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  async function refreshHistoryAndToday(focusDay = selectedDay) {
    const [histRes, dayRes, todayRes] = await Promise.all([
      fetch(`/api/nutrition?from=${addDays(today, -29)}&to=${today}`),
      focusDay === today ? Promise.resolve(null) : fetch(`/api/nutrition?day=${focusDay}`),
      fetch(`/api/nutrition?day=${today}`),
    ]);
    if (histRes.ok) setHistory30(await histRes.json());
    if (todayRes.ok) {
      const freshToday = await todayRes.json();
      setTodayDaily(freshToday);
      if (focusDay === today) setSelectedDaily(freshToday);
    }
    if (dayRes?.ok) setSelectedDaily(await dayRes.json());
  }

  async function selectDay(day: string) {
    setSelectedDay(day);
    if (day === today) {
      setSelectedDaily(todayDaily);
      return;
    }
    const res = await fetch(`/api/nutrition?day=${day}`);
    if (res.ok) setSelectedDaily(await res.json());
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
      setMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function runNutritionAction(action: { action: string; [k: string]: unknown }, successMessage: string) {
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

      if (action.action === "target" || action.action === "preferences") {
        setSettings(payload);
      } else if (action.action === "revoke-mcp") {
        setAudit([]);
      }
      await refreshHistoryAndToday(selectedDay);
      setMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save.");
    } finally {
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
      await refreshHistoryAndToday(selectedDay);
      setMessage(`Synced ${payload.syncedDays} days from Google Health.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Google sync failed.");
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
      await refreshHistoryAndToday(selectedDay);
      setMessage("Google Health disconnected and synced data removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not disconnect.");
    } finally {
      setBusy(false);
    }
  }

  function openNewMeal(day = selectedDay) {
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
            google={google}
            busy={busy}
            onLogMeal={() => openNewMeal(today)}
            onEditMeal={openEditMeal}
            onToggleComplete={(day, complete) =>
              void runNutritionAction(
                { action: "complete", day, complete },
                complete ? "Day marked complete." : "Day marked in progress.",
              )
            }
            onSyncGoogle={() => void syncGoogle(14)}
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
            busy={busy}
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
          <MeasurementsView snapshot={tracker} today={today} busy={busy} onSaveTracker={saveTracker} />
        )}

        {tab === "Settings" && (
          <SettingsView
            today={today}
            tracker={tracker}
            settings={settings}
            google={google}
            audit={audit}
            mcpEnabled={initial.mcpEnabled}
            busy={busy}
            onSaveTracker={saveTracker}
            onNutritionAction={(action, msg) => runNutritionAction(action as { action: string }, msg)}
            onSyncGoogle={syncGoogle}
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
          onClose={() => {
            setComposerOpen(false);
            setEditingMeal(null);
          }}
          onSaveMeal={async ({ mode, data }) => {
            await runNutritionAction(
              { action: mode, data },
              mode === "update" ? "Meal updated." : "Meal saved.",
            );
          }}
          onSaveTemplate={async (data) => {
            await runNutritionAction({ action: "save-template", data }, "Saved to recipes & templates.");
          }}
        />
      )}

      <nav className="tabs" aria-label="Fitness views">
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
