"use client";

import { useState, type FormEvent } from "react";

export function SetupForm() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    try {
      const response = await fetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Setup-Code": String(fields.get("setupCode") ?? ""),
        },
        body: JSON.stringify({
          name: fields.get("name"),
          email: fields.get("email"),
          password: fields.get("password"),
        }),
      });
      if (response.ok) {
        form.reset();
        setComplete(true);
        setMessage("Owner account created.");
        location.assign("/");
      } else {
        const body = await response.json();
        setMessage(body.message ?? "Setup failed.");
      }
    } catch {
      setMessage("Could not reach the setup endpoint. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!complete && (
        <form method="post" onSubmit={submit}>
          <label>Name<input name="name" autoComplete="name" required /></label>
          <label>Email<input name="email" type="email" autoComplete="email" required /></label>
          <label>Password<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label>
          <label>Setup code<input name="setupCode" type="password" autoComplete="off" required /></label>
          <button disabled={busy}>Create owner account</button>
        </form>
      )}
      <p aria-live="polite">{message}</p>
    </>
  );
}
