import { headers } from "next/headers";
import { getAuth, getAuthConfig, getDatabase, authConfigured } from "../lib/runtime";
import { trackerData } from "../lib/tracker-data";
import { Dashboard } from "./dashboard";
import { Login } from "./login";

export const dynamic = "force-dynamic";

export default async function Home() {
  const config = getAuthConfig();
  if (!authConfigured()) return <main className="auth-card"><h1>Fitness</h1><p>Setup is not configured.</p></main>;
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return <Login signup={config.mode !== "closed"} />;
  return <Dashboard initial={await trackerData(getDatabase(), session.user.id).snapshot()} />;
}
