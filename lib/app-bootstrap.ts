import { googleStatus } from "./google-health";
import { hevyStatus } from "./hevy";
import { mcpResource } from "./mcp-config";
import { openWearablesStatus } from "./open-wearables";
import { nutritionData } from "./nutrition-data";
import { localDay } from "./nutrition-model";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "./runtime";
import { getPulseInsightsForUser } from "./pulse-data";
import { getRecoveryInsightsForUser } from "./recovery-insights";
import { strainData } from "./strain-data";
import { trackerData } from "./tracker-data";

import type { InitialAppData } from "../app/types";

export async function getAppBootstrap(requestHeaders: Headers): Promise<InitialAppData | null> {
  const config = getAuthConfig();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const db = getDatabase();
  const userId = session.user.id;
  const nutrition = nutritionData(db, userId);
  const strainSvc = strainData(db, userId);

  const [tracker, google, hevy, openWearables, audit] = await Promise.all([
    trackerData(db, userId).snapshot(),
    googleStatus(db, userId),
    hevyStatus(db, userId),
    openWearablesStatus(db, userId),
    nutrition.recentAudit(15),
  ]);
  const [syncToken, strainSettings, nutritionSettings] = await Promise.all([
    nutrition.syncToken(),
    strainSvc.getSettings(),
    nutrition.settings(),
  ]);

  const prefToday = localDay(new Date(), nutritionSettings.timezone);
  const home = await nutrition.homeSnapshot(prefToday, { canReadSleep: google.canReadSleep || openWearables.connected });
  const isFitbit =
    (home.settings.trackingMode ?? (home.settings.preferredEnergySource === "google" ? "fitbit" : "manual")) === "fitbit" ||
    openWearables.connected;
  const [strain, recoveryInsights, pulseInsights] = await Promise.all([
    strainSvc.computeDay(home.activeDay, strainSettings),
    getRecoveryInsightsForUser(db, userId, home.activeDay),
    isFitbit ? getPulseInsightsForUser(db, userId, home.activeDay).catch(() => null) : Promise.resolve(null),
  ]);

  return {
    userId,

        userName: session.user.name || session.user.email || null,
        tracker,
        settings: home.settings,
        today: home.calendarToday,
        calendarToday: home.calendarToday,
        activeDay: home.activeDay,
        showSleep: home.showSleep,
        waitingForSleep: home.waitingForSleep,
        daily: home.daily,
        history30: home.history30,
        google,
        hevy,
        openWearables,
        strain,
        strainSettings,
        recoveryInsights,
        pulseInsights,
        audit,
        mcpEnabled: Boolean(config.mcpEnabled),
        mcpUrl: mcpResource(config.mcpBaseURL ?? config.baseURL),
        syncToken,
  };
}
