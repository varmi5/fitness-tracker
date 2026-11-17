import { authConfigured, getDatabase } from "./runtime";
import { googleConfigured } from "./google-health";
import { processGoogleMeals } from "./google-meal-worker";
import { processReminders, pushConfigured } from "./reminders";
const state = globalThis as typeof globalThis & { __fitnessWorker?: ReturnType<typeof setInterval> };
export function startBackgroundWork() {
  if (state.__fitnessWorker || !authConfigured() || process.env.FITNESS_BACKGROUND_WORKER === "false") return;
  let running = false;
  const tick = async () => {
    if (running) return; running = true;
    try {
      if (googleConfigured()) await processGoogleMeals(getDatabase()).catch(() => undefined);
      if (pushConfigured()) await processReminders(getDatabase()).catch(() => undefined);
    } finally { running = false; }
  };
  state.__fitnessWorker = setInterval(() => void tick(), 15000);
  state.__fitnessWorker.unref();
}
