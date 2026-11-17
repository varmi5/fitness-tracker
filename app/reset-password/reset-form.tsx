"use client";

import { useState, type FormEvent } from "react";
import { authClient } from "../../lib/auth-client";

export function ResetPasswordForm({ token }: { token: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password"));
    setBusy(true);
    try {
      const result = await authClient.resetPassword({ token, newPassword: password });
      if (result.error) setMessage("Could not reset the password. Request a new link and try again.");
      else location.replace("/");
    } catch { setMessage("Could not reach FitnessTrackr."); }
    finally { setBusy(false); }
  }
  return <form method="post" onSubmit={submit}>
    <label>New password<input type="password" name="password" autoComplete="new-password" minLength={8} required /></label>
    <button disabled={busy}>Set new password</button>
    <p role="status">{message}</p>
  </form>;
}
