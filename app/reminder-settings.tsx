"use client";
import { useEffect, useState } from "react";
interface Settings { enabled: boolean; times: string[]; timezone: string; deviceCount: number; available: boolean; publicKey: string | null }
export function ReminderSettings() {
  const [settings, setSettings] = useState<Settings | null>(null); const [times, setTimes] = useState("18:30");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const supported = typeof window !== "undefined" && "PushManager" in window && "Notification" in window && "serviceWorker" in navigator;
  useEffect(() => { let active = true; fetch("/api/reminders").then((r) => r.ok ? r.json() : null).then((v) => { if (active && v) { setSettings(v); setTimes(v.times.join(", ")); } }).catch(() => { if (active) setMessage("Could not load reminders. Reopen Settings to retry."); }); return () => { active = false; }; }, []);
  async function post(value: unknown): Promise<Settings> {
    const response = await fetch("/api/reminders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
    const result = await response.json(); if (!response.ok) throw new Error(result.message ?? "Could not update reminders."); return result;
  }
  async function enablePhone() {
    if (!settings?.publicKey) return;
    setBusy(true); setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Notifications are not allowed. You can enable them in your phone's app settings.");
      const registration = await navigator.serviceWorker.ready;
      const old = await registration.pushManager.getSubscription();
      const key = Uint8Array.from(atob(settings.publicKey.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(settings.publicKey.length / 4) * 4, "=")), (char) => char.charCodeAt(0));
      const subscription = old ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await post({ action: "subscribe", subscription: subscription.toJSON() });
      setSettings(await post({ action: "settings", data: { enabled: true, times: times.split(",").map((v) => v.trim()).filter(Boolean) } }));
      setMessage("Phone reminders enabled for your account on this device.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not enable phone reminders."); }
    finally { setBusy(false); }
  }
  async function save(enabled: boolean) {
    setBusy(true); setMessage("");
    try { setSettings(await post({ action: "settings", data: { enabled, times: times.split(",").map((v) => v.trim()).filter(Boolean) } })); setMessage(enabled ? "Your reminder schedule is saved." : "Your reminders are paused."); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Could not save reminders."); } finally { setBusy(false); }
  }
  async function removeDevice() {
    setBusy(true); setMessage("");
    try { const registration = await navigator.serviceWorker.ready; const subscription = await registration.pushManager.getSubscription(); if (subscription) { setSettings(await post({ action: "unsubscribe", endpoint: subscription.endpoint })); await subscription.unsubscribe(); } setMessage("Notifications removed from this device."); }
    catch { setMessage("Could not remove this device. Please try again."); } finally { setBusy(false); }
  }
  return <section className="card"><h2>Meal reminders</h2><p className="search-hint">Private, opt-in phone notifications. Your own schedule uses your account timezone and skips days marked complete. Notification text contains no meal, calorie or body data.</p>
    <p className="search-hint">On iPhone, add FitnessTrackr to your Home Screen in Safari, open the installed app, then enable notifications here.</p>
    {settings && <><label>Reminder times ({settings.timezone})<input value={times} onChange={(e) => setTimes(e.target.value)} placeholder="09:00, 13:00, 18:30" /></label>
      <p className="search-hint">Up to four times, separated by commas. {settings.deviceCount} device(s) connected · {settings.enabled ? "Reminders on" : "Reminders paused"}</p>
      {!settings.available && <p>Phone notifications are not configured on this server yet.</p>}
      {!supported && <p>This browser does not support phone push here. On iPhone, open the installed Home Screen app.</p>}
      <div className="button-row"><button type="button" disabled={busy || !supported || !settings.available} onClick={() => void enablePhone()}>Enable on this phone</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => void save(true)}>Save schedule</button>
        <button type="button" className="secondary" disabled={busy || !settings.enabled} onClick={() => void save(false)}>Pause reminders</button>
        <button type="button" className="secondary" disabled={busy || !supported} onClick={() => void removeDevice()}>Remove this device</button></div>
    </>}{message && <p role="status">{message}</p>}
  </section>;
}
