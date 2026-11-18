import { headers } from "next/headers";
import { googleStatus } from "../lib/google-health";
import { nutritionData } from "../lib/nutrition-data";
import { localDay } from "../lib/nutrition-model";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../lib/runtime";
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

  const tracker = await trackerData(db, userId).snapshot();
  const [google, audit, syncToken] = await Promise.all([
    googleStatus(db, userId),
    nutrition.recentAudit(15),
    nutrition.syncToken(),
  ]);

  const prefToday = localDay(new Date(), (await nutrition.settings()).timezone);
  const home = await nutrition.homeSnapshot(prefToday, { canReadSleep: google.canReadSleep });

  return (
    <Dashboard
      initial={{
        tracker,
        settings: home.settings,
        today: home.calendarToday,
        calendarToday: home.calendarToday,
        activeDay: home.activeDay,
        showSleep: home.showSleep,
        daily: home.daily,
        history30: home.history30,
        google,
        audit,
        mcpEnabled: Boolean(config.mcpEnabled),
        syncToken,
      }}
    />
  );
}
