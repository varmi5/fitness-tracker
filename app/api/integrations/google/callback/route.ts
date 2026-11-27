import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { connectGoogle, googleConfigured, syncGoogle } from "../../../../../lib/google-health";
import { nutritionData, NutritionError } from "../../../../../lib/nutrition-data";
import { addDays, localDay } from "../../../../../lib/nutrition-model";
import { consumeOAuthState, type OAuthReturnTo } from "../../../../../lib/oauth-state";
import { getValidatedRequestOrigin } from "../../../../../lib/origins";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = getAuthConfig();
  const reqOrigin = getValidatedRequestOrigin(request, config);
  const back = (params: Record<string, string>, returnTo?: OAuthReturnTo | null) => {
    const dest = new URL("/", reqOrigin);
    if (returnTo === "onboarding-1") dest.searchParams.set("onboarding", "1");
    else dest.searchParams.set("tab", "Settings");
    for (const [k, v] of Object.entries(params)) dest.searchParams.set(k, v);
    const res = NextResponse.redirect(dest);
    res.cookies.delete({ name: "fitness_google_oauth", path: "/api/integrations/google/callback" });
    return res;
  };

  if (!authConfigured() || !googleConfigured()) {
    return back({ google: "error", reason: "not-configured" });
  }
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return back({ google: "error", reason: "signed-out" });

  const url = new URL(request.url);
  if (url.searchParams.get("error")) {
    return back({ google: "error", reason: "cancelled" });
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthCookie = (await cookies()).get("fitness_google_oauth")?.value;
  if (!code || !state) {
    return back({ google: "error", reason: "cancelled" });
  }

  const db = getDatabase();
  const stateResult = await consumeOAuthState(db, "google", session.user.id, state, oauthCookie);
  if (!stateResult.ok || !stateResult.data?.verifier) {
    return back(
      { google: "error", reason: stateResult.reason ?? "expired" },
      stateResult.data?.returnTo,
    );
  }
  const returnTo = stateResult.data.returnTo;

  try {
    const callback = new URL("/api/integrations/google/callback", reqOrigin).href;
    await connectGoogle(db, session.user.id, code, stateResult.data.verifier, callback);
    const settings = await nutritionData(db, session.user.id).settings();
    const today = localDay(new Date(), settings.timezone);
    await syncGoogle(db, session.user.id, addDays(today, -6), today).catch(() => null);
    return back({ google: "connected" }, returnTo);
  } catch (error) {
    const reason = error instanceof NutritionError ? error.message : "connection-failed";
    return back({ google: "error", reason }, returnTo);
  }
}
