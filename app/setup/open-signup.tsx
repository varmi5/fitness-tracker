"use client";

import Script from "next/script";
import { useEffect, useRef, useState, type FormEvent } from "react";

interface Turnstile {
  render(element: HTMLElement, options: { sitekey: string; action: string }): string;
  reset(id: string): void;
  remove(id: string): void;
  getResponse(id: string): string;
}

export function OpenSignup({ siteKey, invite }: { siteKey: string; invite: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | undefined>(undefined);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const turnstile = () => (window as Window & { turnstile?: Turnstile }).turnstile;

  useEffect(() => {
    const api = turnstile();
    if (!ready || !box.current || !api) return;
    const id = api.render(box.current, { sitekey: siteKey, action: "signup" });
    widget.current = id;
    return () => { api.remove(id); widget.current = undefined; };
  }, [ready, siteKey]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const id = widget.current;
    const token = id ? turnstile()?.getResponse(id) : undefined;
    if (!token) { setMessage("Complete the verification challenge first."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Turnstile-Response": token, "X-Invite-Code": String(fields.get("invite") ?? "") },
        body: JSON.stringify({ name: fields.get("name"), email: fields.get("email"), password: fields.get("password") }),
      });
      if (!response.ok) setMessage((await response.json()).message ?? "Signup failed.");
      else { setDone(true); setMessage("Check your email to verify your account."); }
    } catch { setMessage("Could not complete signup. Try again."); }
    finally { if (id) turnstile()?.reset(id); setBusy(false); }
  }

  return <>
    {!done && <form onSubmit={submit} method="post">
      <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" onReady={() => setReady(true)}
        onError={() => setMessage("Could not load the verification challenge.")} />
      <label>Name<input name="name" autoComplete="name" required /></label>
      <label>Email<input name="email" type="email" autoComplete="email" required /></label>
      <label>Password<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
      {invite && <label>Invite code<input name="invite" type="password" autoComplete="off" required /></label>}
      <div ref={box} />
      <button disabled={busy || !ready}>Create account</button>
    </form>}
    <p role="status">{message}</p>
  </>;
}
