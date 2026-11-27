import { NextResponse } from "next/server";
import { hevyConsentUrl, hevyOAuthConfigured } from "../../../../../lib/hevy";
import { createOAuthState, parseOAuthReturnTo } from "../../../../../lib/oauth-state";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";

const OAUTH_COOKIE = "fitness_hevy_oauth";

export async function GET(request: Request) {
  if (!authConfigured()) return NextResponse.json({ message: "Setup is not configured." }, { status: 503 });
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ message: "Please sign in." }, { status: 401 });
  if (!hevyOAuthConfigured()) {
    return NextResponse.json(
      { message: "Hevy OAuth is not configured. Use Hevy CSV/JSON import or configure HEVY_CLIENT_ID and HEVY_CLIENT_SECRET." },
      { status: 503 },
    );
  }

  const config = getAuthConfig();
  const returnTo = parseOAuthReturnTo(new URL(request.url).searchParams.get("returnTo"));
  const { state, sealed, maxAge } = await createOAuthState(getDatabase(), "hevy", session.user.id, { returnTo });
  const callback = `${new URL(config.baseURL).origin}/api/integrations/hevy/callback`;
  const consent = hevyConsentUrl(callback, state);

  const response = NextResponse.redirect(consent);
  response.cookies.set(OAUTH_COOKIE, sealed, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(config.baseURL).protocol === "https:",
    path: "/",
    maxAge,
  });
  return response;
}
