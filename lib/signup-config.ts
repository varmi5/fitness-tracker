import { createHash, timingSafeEqual } from "node:crypto";

export function signupMode(env: Record<string, string | undefined> = process.env) {
  const mode = env.SIGNUP_MODE ?? "closed";
  if (mode === "closed") return mode;
  if (mode !== "invite" && mode !== "open") throw new Error("Invalid SIGNUP_MODE.");
  for (const name of ["RESEND_API_KEY", "EMAIL_FROM", "TURNSTILE_SECRET_KEY", "NEXT_PUBLIC_TURNSTILE_SITE_KEY",
    ...(mode === "invite" ? ["INVITE_CODE"] : [])]) {
    if (!env[name]?.trim()) throw new Error(`${name} is required for ${mode} signup.`);
  }
  return mode;
}

export function equalCodes(expected: string, supplied: string) {
  const digest = (code: string) => createHash("sha256").update(code).digest();
  return timingSafeEqual(digest(expected), digest(supplied));
}

export async function sendEmail(to: string, subject: string, text: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to, subject, text }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Fitness could not send an email.");
}

export async function verifyTurnstile(token: string, origin: string) {
  if (!token || token.length > 2048) return false;
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return false;
  const data = await response.json();
  return data.success === true && data.hostname === new URL(origin).hostname && data.action === "signup";
}
