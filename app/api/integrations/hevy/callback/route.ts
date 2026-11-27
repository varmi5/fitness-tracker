import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { connectHevy, exchangeHevyToken, hevyOAuthConfigured, syncHevyOAuth } from "../../../../../lib/hevy";
import { nutritionData } from "../../../../../lib/nutrition-data";
import { localDay } from "../../../../../lib/nutrition-model";
import { consumeOAuthState, type OAuthReturnTo } from "../../../../../lib/oauth-state";
import { getValidatedRequestOrigin } from "../../../../../lib/origins";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../../../../../lib/runtime";
import { strainData } from "../../../../../lib/strain-data";

export const dynamic = "force-dynamic";

const OAUTH_COOKIE = "fitness_hevy_oauth";

export async function GET(request: Request) {
  const config = getAuthConfig();
  const origin = getValidatedRequestOrigin(request, config);
  const destFor = (returnTo: OAuthReturnTo | null | undefined, params: Record<string, string>) => {
    const dest = new URL("/", origin);
    if (returnTo === "onboarding-3") dest.searchParams.set("onboarding", "3");
    else dest.searchParams.set("tab", "Training");
    for (const [k, v] of Object.entries(params)) dest.searchParams.set(k, v);
    return dest.toString();
  };
  const fail = (reason: string, returnTo?: OAuthReturnTo | null) => {
    const res = NextResponse.redirect(destFor(returnTo, { hevy: "error", reason }));
    res.cookies.delete(OAUTH_COOKIE);
    return res;
  };

  if (!authConfigured() || !hevyOAuthConfigured()) return fail("not-configured");
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return fail("signed-out");

  const url = new URL(request.url);
  if (url.searchParams.get("error")) return fail("denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail("missing-code");

  const db = getDatabase();
  const cookieStore = await cookies();
  const stateResult = await consumeOAuthState(db, "hevy", session.user.id, state, cookieStore.get(OAUTH_COOKIE)?.value);
  if (!stateResult.ok || !stateResult.data) return fail(stateResult.reason ?? "expired");
  const returnTo = stateResult.data.returnTo;

  try {
    const callback = `${origin}/api/integrations/hevy/callback`;
    const grant = await exchangeHevyToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: callback,
    });
    await connectHevy(db, session.user.id, grant);
    const syncRes = await syncHevyOAuth(db, session.user.id).catch(() => null);

    const prefs = await nutritionData(db, session.user.id).settings();
    const strain = strainData(db, session.user.id);
    const today = localDay(new Date(), prefs.timezone);
    const daysToRecompute = new Set<string>([today, ...(syncRes?.affectedDays ?? [])]);
    for (const d of daysToRecompute) {
      await strain.computeDay(d).catch(() => null);
    }

    const ok = NextResponse.redirect(destFor(returnTo, { hevy: "connected" }));
    ok.cookies.delete(OAUTH_COOKIE);
    return ok;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 80) : "exchange-failed";
    return fail(reason, returnTo);
  }
}
