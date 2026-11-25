import { authConfigured, getAuthConfig } from "../lib/runtime";
import { AppBootstrap } from "./app-bootstrap";
export const dynamic = "force-dynamic";
export default function Home() {
  if (!authConfigured()) return <main className="auth-card"><h1>FitnessTrackr</h1><p>Setup is not configured.</p></main>;
  return <AppBootstrap signup={getAuthConfig().mode !== "closed"} />;
}
