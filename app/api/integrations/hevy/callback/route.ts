import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { unseal } from "../../../../../lib/google-health";
import { connectHevy, exchangeHevyToken, hevyOAuthConfigured, syncHevyOAuth } from "../../../../../lib/hevy";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";

const OAUTH_COOKIE = "fitness_hevy_oauth";

export async function GET(request: Request) {
  const config = getAuthConfig();
  const origin = new URL(config.baseURL).origin;
  const fail = (reason: string) => {
    const res = NextResponse.redirect(`${origin}/?tab=Settings&hevy=error&reason=${encodeURIComponent(reason)}`);
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

  const cookieStore = await cookies();
  const sealed = cookieStore.get(OAUTH_COOKIE)?.value;
  if (!sealed) return fail("expired");

  let saved: { state: string; userId: string };
  try {
    saved = z
      .object({ state: z.string(), userId: z.string() })
      .parse(unseal(sealed, session.user.id));
  } catch {
    return fail("invalid-state");
  }
  if (saved.state !== state || saved.userId !== session.user.id) return fail("state-mismatch");

  try {
    const callback = `${origin}/api/integrations/hevy/callback`;
    const grant = await exchangeHevyToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: callback,
    });
    const db = getDatabase();
    await connectHevy(db, session.user.id, grant);
    await syncHevyOAuth(db, session.user.id).catch(() => null);

    const ok = NextResponse.redirect(`${origin}/?tab=Settings&hevy=connected`);
    ok.cookies.delete(OAUTH_COOKIE);
    return ok;
  } catch {
    return fail("exchange-failed");
  }
}
