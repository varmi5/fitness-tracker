"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { activateBrowserCache, clearBrowserCache, readBrowserCache, writeBrowserCache } from "../lib/browser-cache";
import { createStartupCache, type StartupCacheUpdate } from "../lib/startup-cache";
import type { InitialAppData } from "./types";
import { Login } from "./login";
const Dashboard = dynamic(() => import("./dashboard").then(m => m.Dashboard), { loading: () => <p className="startup-status" role="status">Opening your diary…</p> });
export function AppBootstrap({ signup }: { signup: boolean }) {
  const [snapshot, setSnapshot] = useState<{ data: InitialAppData; savedAt: number } | null>(null);
  const [login, setLogin] = useState(false);
  const [message, setMessage] = useState("Opening FitnessTrackr…");
  const [attempt, setAttempt] = useState(0);
  const [startupCache] = useState(createStartupCache);
  const authenticatedOwner = useRef<string | null>(null);
  const writeQueue = useRef(Promise.resolve());
  const fullSnapshotSavedAt = useRef(0);

  const persistSnapshot = useCallback((data: InitialAppData) => {
    const savedAt = fullSnapshotSavedAt.current;
    writeQueue.current = writeQueue.current.then(async () => {
      if (data.userId && data.userId === authenticatedOwner.current) {
        await writeBrowserCache(data.userId, "bootstrap", data, savedAt);
      }
    });
    return writeQueue.current;
  }, []);

  const updateStartupCache = useCallback(async (update: StartupCacheUpdate) => {
    if (!authenticatedOwner.current || startupCache.current?.userId !== authenticatedOwner.current) return;
    const updated = startupCache.update(update);
    if (updated) await persistSnapshot(updated);
  }, [persistSnapshot, startupCache]);

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
      if (!session?.user?.id) { authenticatedOwner.current = null; startupCache.seed(null); await clearBrowserCache(); setSnapshot(null); setLogin(true); return; }
      const owner = session.user.id as string;
      if (authenticatedOwner.current && authenticatedOwner.current !== owner) {
        startupCache.seed(null);
        setSnapshot(null);
      }
      authenticatedOwner.current = owner;
      await activateBrowserCache(owner);
      const cached = await readBrowserCache<InitialAppData>(owner, "bootstrap");
      if (!active) return;
      if (cached?.value.userId === owner && startupCache.current?.userId !== owner) {
        fullSnapshotSavedAt.current = cached.savedAt;
        startupCache.seed(cached.value);
        setSnapshot({ data: cached.value, savedAt: cached.savedAt });
        setMessage("");
      }
      const startedAt = startupCache.revision;
      const res = await fetch("/api/bootstrap", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]) });
      if (!active) return;
      if (res.status === 401) { authenticatedOwner.current = null; startupCache.seed(null); await clearBrowserCache(); setSnapshot(null); setLogin(true); return; }
      if (!res.ok) throw new Error("Showing saved data. Refresh failed; try again when your connection is stable.");
      const fresh = await res.json() as InitialAppData;
      if (!active) return;
      if (fresh.userId !== owner) {
        authenticatedOwner.current = null;
        startupCache.seed(null);
        await clearBrowserCache();
        setSnapshot(null);
        throw new Error("Your account changed. Please reopen the app.");
      }
      fullSnapshotSavedAt.current = Date.now();
      await persistSnapshot(startupCache.refresh(fresh, startedAt));
      if (!active || authenticatedOwner.current !== owner || !startupCache.current) return;
      setSnapshot({ data: startupCache.current, savedAt: fullSnapshotSavedAt.current });
      setMessage("");
    })().catch(() => { if (active) setMessage("Unable to refresh. Check your connection, then tap Retry. Saved data is kept on this device."); });
    return () => { active = false; controller.abort(); };
  }, [attempt, persistSnapshot, startupCache]);
  if (login) return <Login signup={signup} />;
  return <>
    {message && <div className={snapshot ? "cache-status" : "startup-status"} role="status"><span>{message}</span>{!message.includes("…") && <button type="button" className="secondary compact" onClick={() => { setMessage("Refreshing…"); setAttempt(n => n + 1); }}>Retry</button>}</div>}
    {snapshot && <Dashboard key={snapshot.data.userId} initial={snapshot.data} savedAt={snapshot.savedAt} updateStartupCache={updateStartupCache} />}
  </>;
}
