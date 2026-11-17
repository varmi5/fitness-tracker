"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Fingerprint } from "lucide-react";
import { authClient } from "../lib/auth-client";

export function Login({ signup, oauth = false }: { signup: boolean; oauth?: boolean }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(false);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage("");
    setBusy(true);
    try {
      if (reset) {
        const result = await authClient.requestPasswordReset({
          email: String(form.get("email")), redirectTo: "/reset-password",
        });
        setMessage(result.error ? "Could not request a password reset." : "If the account exists, you’ll receive a reset email.");
        return;
      }
      if (oauth) {
        const response = await fetch("/api/auth/sign-in/email", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            email: String(form.get("email")),
            password: String(form.get("password")),
            oauth_query: location.search.slice(1),
          }),
        });
        const data = await response.json().catch(() => null);
        if (response.ok && data?.url) {
          const next = new URL(data.url, location.origin);
          if (["https:", "http:"].includes(next.protocol)) {
            location.assign(next);
            return;
          }
        }
        setMessage("Could not connect Fitness. Check your credentials and restart the connection if needed.");
        return;
      }
      const result = await authClient.signIn.email({
        email: String(form.get("email")), password: String(form.get("password")),
      });
      if (result.error?.code === "EMAIL_NOT_VERIFIED") {
        setMessage("Verify your email before signing in. Check your inbox for the verification link.");
      } else if (result.error) setMessage("Could not sign in. Check your email and password.");
      else location.reload();
    } catch {
      setMessage("Could not reach Fitness. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-card">
    <h1>Fitness</h1>
    <p>{oauth ? "Sign in to connect your Fitness account." : "Sign in to your nutrition and measurement tracker."}</p>
    <form onSubmit={signIn} method="post">
      <label>Email<input type="email" name="email" autoComplete="username webauthn" required /></label>
      {!reset && <label>Password<input type="password" name="password" autoComplete="current-password" required /></label>}
      <button disabled={busy}>{reset ? "Send reset link" : "Sign in"}</button>
    </form>
    {!oauth && <button className="secondary wide" onClick={async () => {
      try {
        const result = await authClient.signIn.passkey();
        if (result.error) setMessage("Could not sign in with a passkey.");
        else if (result.data) location.reload();
      } catch { setMessage("Passkey sign-in is unavailable."); }
    }}><Fingerprint size={19} /> Use a passkey</button>}
    {!oauth && signup && <button className="secondary" onClick={() => { setReset(!reset); setMessage(""); }}>{reset ? "Back to sign in" : "Forgot password?"}</button>}
    <p aria-live="polite">{message}</p>
    {!oauth && <Link href="/setup">{signup ? "Create an account" : "Owner setup"}</Link>}
  </main>;
}
