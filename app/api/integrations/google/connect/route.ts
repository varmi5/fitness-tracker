import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { googleConfigured, googleConsent, pkcePair, seal } from "../../../../../lib/google-health";
import { authConfigured, getAuth, getAuthConfig } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authConfigured() || !googleConfigured()) {
    return NextResponse.json({ message: "Google Health is not configured." }, { status: 503 });
  }
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ message: "Please sign in." }, { status: 401 });

  const config = getAuthConfig();
  const callback = new URL("/api/integrations/google/callback", config.baseURL).href;
  const state = randomBytes(24).toString("base64url");
  const { verifier, challenge } = pkcePair();
  const consentUrl = googleConsent(callback, state, challenge);

  const response = NextResponse.redirect(consentUrl);
  response.cookies.set("fitness_google_oauth", seal({ state, verifier, userId: session.user.id }, session.user.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(config.baseURL).protocol === "https:",
    path: "/api/integrations/google/callback",
    maxAge: 600,
  });
  return response;
}
