"use client";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="auth-card"><h1>Let’s reconnect</h1><p>The app could not finish loading. Your saved records are still on the server.</p><div className="button-row"><button type="button" className="primary" onClick={reset}>Try again</button><button type="button" className="secondary" onClick={() => window.location.reload()}>Reload app</button></div></main>;
}
