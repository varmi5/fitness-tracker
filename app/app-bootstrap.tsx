"use client";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { activateBrowserCache, clearBrowserCache, readBrowserCache, writeBrowserCache } from "../lib/browser-cache";
import type { InitialAppData } from "./types";
import { Login } from "./login";
const Dashboard = dynamic(() => import("./dashboard").then(m => m.Dashboard), { loading: () => <p className="startup-status" role="status">Opening your diary…</p> });
export function AppBootstrap({ signup }: { signup: boolean }) {
  const [snapshot, setSnapshot] = useState<{ data: InitialAppData; savedAt: number } | null>(null);
  const [login, setLogin] = useState(false);
  const [message, setMessage] = useState("Opening FitnessTrackr…");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    void (async () => {
      // Verify the browser session before rendering health data from local storage.
      let sessionResponse: Response | undefined;
      for (let retry = 0; retry < 2; retry++) {
        try { sessionResponse = await fetch("/api/auth/get-session", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]) }); break; }
        catch (error) { if (controller.signal.aborted || retry === 1) throw error; }
      }
      if (!sessionResponse?.ok) throw new Error("Could not verify your session. Check your connection and try again.");
      const session = await sessionResponse.json();
      if (!active) return;
      if (!session?.user?.id) { await clearBrowserCache(); setSnapshot(null); setLogin(true); return; }
      const owner = session.user.id as string;
      await activateBrowserCache(owner);
      const cached = await readBrowserCache<InitialAppData>(owner, "bootstrap");
      if (!active) return;
      if (cached?.value.userId === owner) { setSnapshot({ data: cached.value, savedAt: cached.savedAt }); setMessage(""); }
      const res = await fetch("/api/bootstrap", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
      if (!active) return;
      if (res.status === 401) { await clearBrowserCache(); setSnapshot(null); setLogin(true); return; }
      if (!res.ok) throw new Error("Showing saved data. Refresh failed; try again when your connection is stable.");
      const fresh = await res.json() as InitialAppData;
      if (fresh.userId !== owner) { await clearBrowserCache(); throw new Error("Your account changed. Please reopen the app."); }
      setSnapshot({ data: fresh, savedAt: Date.now() }); setMessage("");
      void writeBrowserCache(owner, "bootstrap", fresh);
    })().catch(() => { if (active) setMessage("Unable to refresh. Check your connection, then tap Retry. Saved data is kept on this device."); });
    return () => { active = false; controller.abort(); };
  }, [attempt]);
  if (login) return <Login signup={signup} />;
  return <>
    {message && <div className={snapshot ? "cache-status" : "startup-status"} role="status"><span>{message}</span>{!message.includes("…") && <button type="button" className="secondary compact" onClick={() => { setMessage("Refreshing…"); setAttempt(n => n + 1); }}>Retry</button>}</div>}
    {snapshot && <Dashboard key={snapshot.data.userId} initial={snapshot.data} savedAt={snapshot.savedAt} />}
  </>;
}
