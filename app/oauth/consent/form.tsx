"use client";

import { useState } from "react";

export function ConsentForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(accept: boolean) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ accept, oauth_query: location.search.slice(1) }),
      });
      const result = await response.json();
      if (!response.ok || !result.redirect || !result.url) throw new Error();
      const url = new URL(result.url, location.origin);
      if (!["https:", "http:"].includes(url.protocol)) throw new Error();
      location.assign(url);
    } catch {
      setError("This connection request could not be completed. Restart the connection in your client.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <div className="button-row">
      <button disabled={busy} onClick={() => void decide(true)}>Allow access</button>
      <button className="secondary" disabled={busy} onClick={() => void decide(false)}>Deny</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </>;
}
