import { getSetupStatus, hasValidSetupCode, SETUP_NOT_CONFIGURED, SIGNUP_CLOSED } from "../../lib/owner-setup";
import Link from "next/link";
import { authConfigured, getAuthConfig, getDatabase } from "../../lib/runtime";
import { OpenSignup } from "./open-signup";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const config = getAuthConfig();
  const ready = authConfigured();
  const status = ready && config.mode === "closed" && hasValidSetupCode(config)
    ? await getSetupStatus(getDatabase(), config) : "unconfigured";

  return (
    <main className="auth-card">
      <h1>Fitness setup</h1>
      {ready && config.mode !== "closed" ? (
        <OpenSignup siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!} invite={config.mode === "invite"} />
      ) : status === "available" ? <SetupForm /> : (
        <p>{status === "unconfigured" ? SETUP_NOT_CONFIGURED : SIGNUP_CLOSED}</p>
      )}
    <Link href="/">Back to sign in</Link>
    </main>
  );
}
