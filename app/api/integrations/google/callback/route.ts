import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { connectGoogle, googleConfigured, syncGoogle, unseal } from "../../../../../lib/google-health";
import { nutritionData, NutritionError } from "../../../../../lib/nutrition-data";
import { addDays, localDay } from "../../../../../lib/nutrition-model";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = getAuthConfig();
  const back = (params: Record<string, string>) => {
    const dest = new URL("/", config.baseURL);
    for (const [k, v] of Object.entries(params)) dest.searchParams.set(k, v);
    const res = NextResponse.redirect(dest);
    res.cookies.delete({ name: "fitness_google_oauth", path: "/api/integrations/google/callback" });
    return res;
  };

  if (!authConfigured() || !googleConfigured()) {
    return back({ tab: "Settings", google: "error", reason: "not-configured" });
  }
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return back({ google: "error", reason: "signed-out" });

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthCookie = (await cookies()).get("fitness_google_oauth")?.value;
  if (!code || !state || !oauthCookie) {
    return back({ tab: "Settings", google: "error", reason: "cancelled" });
  }

  try {
    const sealed = z
      .object({ state: z.string(), verifier: z.string(), userId: z.string() })
      .parse(unseal(oauthCookie, session.user.id));
    if (sealed.state !== state || sealed.userId !== session.user.id) {
      return back({ tab: "Settings", google: "error", reason: "state-mismatch" });
    }
    const db = getDatabase();
    const callback = new URL("/api/integrations/google/callback", config.baseURL).href;
    await connectGoogle(db, session.user.id, code, sealed.verifier, callback);
    const settings = await nutritionData(db, session.user.id).settings();
    const today = localDay(new Date(), settings.timezone);
    await syncGoogle(db, session.user.id, addDays(today, -13), today).catch(() => null);
    return back({ tab: "Settings", google: "connected" });
  } catch (error) {
    const reason = error instanceof NutritionError ? error.message : "connection-failed";
    return back({ tab: "Settings", google: "error", reason });
  }
}
