import Link from "next/link";
import { signupMode } from "../../lib/signup-config";
import { RequestPasswordResetForm, ResetPasswordForm } from "./reset-form";

export const dynamic = "force-dynamic";

export default async function ResetPassword({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  return <main className="auth-card">
    <h1>Reset password</h1>
    {signupMode() === "closed" ? <p>Email password recovery is disabled.</p>
      : typeof token === "string" && token.trim() ? <ResetPasswordForm token={token} />
      : <RequestPasswordResetForm initialError={error ? "This reset link has expired or was already used. Request a new one below." : undefined} />}
    <Link href="/">Back to sign in</Link>
  </main>;
}
