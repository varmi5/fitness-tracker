import Link from "next/link";
import { signupMode } from "../../lib/signup-config";
import { ResetPasswordForm } from "./reset-form";

export const dynamic = "force-dynamic";

export default async function ResetPassword({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <main className="auth-card">
    <h1>Reset password</h1>
    {signupMode() === "closed" ? <p>Email password recovery is disabled.</p>
      : typeof token === "string" ? <ResetPasswordForm token={token} /> : <p>This reset link is missing or has expired.</p>}
    <Link href="/">Back to sign in</Link>
  </main>;
}
