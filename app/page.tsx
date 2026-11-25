import { headers } from "next/headers";
import { googleStatus } from "../lib/google-health";
import { hevyStatus } from "../lib/hevy";
import { nutritionData } from "../lib/nutrition-data";
import { localDay } from "../lib/nutrition-model";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../lib/runtime";
import { getPulseInsightsForUser } from "../lib/pulse-data";
import { getRecoveryInsightsForUser } from "../lib/recovery-insights";
import { strainData } from "../lib/strain-data";
import { trackerData } from "../lib/tracker-data";
import { Dashboard } from "./dashboard";
import { Login } from "./login";

export const dynamic = "force-dynamic";

export default async function Home() {
  const config = getAuthConfig();
  if (!authConfigured()) {
    return (
      <main className="auth-card">
        <h1>FitnessTrackr</h1>
        <p>Setup is not configured.</p>
      </main>
    );
  }
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return <Login signup={config.mode !== "closed"} />;

  const db = getDatabase();
  const userId = session.user.id;
  const nutrition = nutritionData(db, userId);
  const strainSvc = strainData(db, userId);

  const tracker = await trackerData(db, userId).snapshot();
  const [google, hevy, audit] = await Promise.all([
    googleStatus(db, userId),
    hevyStatus(db, userId),
    nutrition.recentAudit(15),
  ]);
  const [syncToken, strainSettings, nutritionSettings] = await Promise.all([
    nutrition.syncToken(),
    strainSvc.getSettings(),
    nutrition.settings(),
  ]);

  const prefToday = localDay(new Date(), nutritionSettings.timezone);
  const home = await nutrition.homeSnapshot(prefToday, { canReadSleep: google.canReadSleep });
  const isFitbit = (home.settings.trackingMode ?? (home.settings.preferredEnergySource === "google" ? "fitbit" : "manual")) === "fitbit";
  const [strain, recoveryInsights, pulseInsights] = await Promise.all([
    strainSvc.computeDay(home.activeDay, strainSettings),
    getRecoveryInsightsForUser(db, userId, home.activeDay),
    isFitbit ? getPulseInsightsForUser(db, userId, home.activeDay).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <Dashboard
      initial={{
        userName: session.user.name || session.user.email || null,
        tracker,
        settings: home.settings,
        today: home.calendarToday,
        calendarToday: home.calendarToday,
        activeDay: home.activeDay,
        showSleep: home.showSleep,
        daily: home.daily,
        history30: home.history30,
        google,
        hevy,
        strain,
        strainSettings,
        recoveryInsights,
        pulseInsights,
        audit,
        mcpEnabled: Boolean(config.mcpEnabled),
        syncToken,
      }}
    />
  );
}
