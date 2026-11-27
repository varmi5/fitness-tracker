"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { authClient } from "../../lib/auth-client";

export function ResetPasswordForm({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirmPassword = String(form.get("confirmPassword") ?? "");
    if (password.length < 8) {
      setMessage("New password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("New passwords do not match.");
      return;
    }
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const result = await authClient.resetPassword({ token, newPassword: password });
      if (result.error) {
        setFailed(true);
        setMessage("Could not reset the password. This link may have expired — request a new link below.");
      } else {
        setMessage("Password updated! Taking you to sign in…");
        location.replace("/");
      }
    } catch {
      setMessage("Could not reach FitnessTrackr.");
    } finally {
      setBusy(false);
    }
  }
  return <form method="post" onSubmit={submit}>
    <label>New password<input type="password" name="password" autoComplete="new-password" minLength={8} required /></label>
    <label>Confirm new password<input type="password" name="confirmPassword" autoComplete="new-password" minLength={8} required /></label>
    <button disabled={busy}>Set new password</button>
    <p role="status">{message}</p>
    {failed && <Link href="/reset-password">Request a new reset link</Link>}
  </form>;
}

export function RequestPasswordResetForm({ initialError }: { initialError?: string }) {
  const [message, setMessage] = useState(initialError ?? "");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    setBusy(true);
    setMessage("");
    try {
      const result = await authClient.requestPasswordReset({
        email,
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setMessage(
        result.error
          ? "Could not request a password reset. Check your email and try again."
          : "If an account exists for that email, you’ll receive a password reset link shortly.",
      );
    } catch {
      setMessage("Could not reach FitnessTrackr. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return <form method="post" onSubmit={submit}>
    <label>Email<input type="email" name="email" autoComplete="username" required /></label>
    <button disabled={busy}>Send reset link</button>
    <p role="status">{message}</p>
  </form>;
}
