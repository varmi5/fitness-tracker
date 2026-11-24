import { and, eq, inArray, lte } from "drizzle-orm";
import { authConfigured, getDatabase } from "./runtime";
import { googleConfigured, syncGoogleAllUsers } from "./google-health";
import { processGoogleMeals } from "./google-meal-worker";
import { hevyOAuthConfigured, syncHevyOAuth } from "./hevy";
import { processReminders, pushConfigured } from "./reminders";
import * as schema from "./schema";

const state = globalThis as typeof globalThis & {
  __fitnessWorker?: ReturnType<typeof setInterval>;
  __lastGooglePull?: number;
  __lastHevyPull?: number;
};

export async function processBackgroundGoogleMeals(db: Parameters<typeof processGoogleMeals>[0], limit = 10) {
  const pendingRows = await db
    .select({ userId: schema.googleMealSync.userId, manual: schema.googleMealSync.manual })
    .from(schema.googleMealSync)
    .where(and(inArray(schema.googleMealSync.state, ["pending", "error"]), lte(schema.googleMealSync.nextAttemptAt, new Date())));
  const userIds: string[] = Array.from(new Set(pendingRows.map((row) => row.userId)));
  if (!userIds.length) return { synced: 0, skippedUsers: 0 };

  const prefs = await db.select().from(schema.nutritionPreference).where(inArray(schema.nutritionPreference.userId, userIds));
  const prefByUser = new Map(prefs.map((pref) => [pref.userId, pref]));

  let synced = 0;
  let skippedUsers = 0;
  for (const userId of userIds) {
    const pref = prefByUser.get(userId);
    if ((!pref || pref.trackingMode === "manual" || pref.preferredEnergySource !== "google") && !pendingRows.some((row) => row.userId === userId && row.manual)) {
      skippedUsers += 1;
      continue;
    }
    const res = await processGoogleMeals(db, userId, limit);
    synced += res.synced;
  }
  return { synced, skippedUsers };
}

export function startBackgroundWork() {
  if (state.__fitnessWorker || !authConfigured() || process.env.FITNESS_BACKGROUND_WORKER === "false") return;
  let running = false;
  const tick = async () => {
    if (running) return; running = true;
    try {
      const db = getDatabase();
      const now = Date.now();
      if (googleConfigured()) {
        await processBackgroundGoogleMeals(db).catch(() => undefined);
        if (!state.__lastGooglePull || now - state.__lastGooglePull >= 3 * 60 * 1000) {
          state.__lastGooglePull = now;
          await syncGoogleAllUsers(db).catch(() => undefined);
        }
      }
      if (hevyOAuthConfigured() && (!state.__lastHevyPull || now - state.__lastHevyPull >= 5 * 60 * 1000)) {
        state.__lastHevyPull = now;
        const hevyUsers = await db
          .select({ userId: schema.healthIntegration.userId })
          .from(schema.healthIntegration)
          .where(and(eq(schema.healthIntegration.provider, "hevy"), eq(schema.healthIntegration.status, "connected")))
          .catch(() => []);
        for (const row of hevyUsers) {
          await syncHevyOAuth(db, row.userId).catch(() => undefined);
        }
      }
      if (pushConfigured()) await processReminders(db).catch(() => undefined);
    } finally { running = false; }
  };
  state.__fitnessWorker = setInterval(() => void tick(), 15000);
  state.__fitnessWorker.unref();
}

