import { NextResponse } from "next/server";
import { googleConfigured, googleConsent, pkcePair } from "../../../../../lib/google-health";
import { createOAuthState, parseOAuthReturnTo } from "../../../../../lib/oauth-state";
import { getValidatedRequestOrigin } from "../../../../../lib/origins";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authConfigured() || !googleConfigured()) {
    return NextResponse.json({ message: "Google Health is not configured." }, { status: 503 });
  }
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ message: "Please sign in." }, { status: 401 });

  const config = getAuthConfig();
  const reqOrigin = getValidatedRequestOrigin(request, config);
  const reqUrl = new URL(request.url);
  const returnTo = parseOAuthReturnTo(reqUrl.searchParams.get("returnTo"));
  const callback = new URL("/api/integrations/google/callback", reqOrigin).href;
  const { verifier, challenge } = pkcePair();
  const { state, sealed, maxAge } = await createOAuthState(getDatabase(), "google", session.user.id, {
    returnTo,
    verifier,
  });
  const consentUrl = googleConsent(callback, state, challenge, reqUrl.searchParams.get("write") === "1");

  const response = NextResponse.redirect(consentUrl);
  response.cookies.set("fitness_google_oauth", sealed, {
    httpOnly: true,
    sameSite: "lax",
    secure: reqOrigin.startsWith("https:"),
    path: "/api/integrations/google/callback",
    maxAge,
  });
  return response;
}
