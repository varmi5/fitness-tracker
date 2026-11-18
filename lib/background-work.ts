import { authConfigured, getDatabase } from "./runtime";
import { googleConfigured, syncGoogleAllUsers } from "./google-health";
import { processGoogleMeals } from "./google-meal-worker";
import { processReminders, pushConfigured } from "./reminders";
const state = globalThis as typeof globalThis & { __fitnessWorker?: ReturnType<typeof setInterval>; __lastGooglePull?: number };
export function startBackgroundWork() {
  if (state.__fitnessWorker || !authConfigured() || process.env.FITNESS_BACKGROUND_WORKER === "false") return;
  let running = false;
  const tick = async () => {
    if (running) return; running = true;
    try {
      const db = getDatabase();
      if (googleConfigured()) {
        await processGoogleMeals(db).catch(() => undefined);
        const now = Date.now();
        if (!state.__lastGooglePull || now - state.__lastGooglePull >= 15 * 60 * 1000) {
          state.__lastGooglePull = now;
          await syncGoogleAllUsers(db).catch(() => undefined);
        }
      }
      if (pushConfigured()) await processReminders(db).catch(() => undefined);
    } finally { running = false; }
  };
  state.__fitnessWorker = setInterval(() => void tick(), 15000);
  state.__fitnessWorker.unref();
}
