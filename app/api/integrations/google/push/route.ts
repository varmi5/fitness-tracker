import { z } from "zod";
import { googleConfigured, googleStatus, pushPendingToGoogle } from "../../../../../lib/google-health";
import { nutritionData, NutritionError } from "../../../../../lib/nutrition-data";
import { addDays, historyInput, localDay } from "../../../../../lib/nutrition-model";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../../../../../lib/runtime";
import { processGoogleMeals } from "../../../../../lib/google-meal-worker";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  if (!authConfigured()) return json({ message: "Setup is not configured." }, 503);
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ message: "Please sign in." }, 401);
  return json({ status: await googleStatus(getDatabase(), session.user.id) });
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(getAuthConfig().baseURL).origin) {
    return json({ message: "A same-origin request is required." }, 403);
  }
  if (!authConfigured()) return json({ message: "Setup is not configured." }, 503);
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ message: "Please sign in." }, 401);
  if (!googleConfigured()) return json({ message: "Google Health is not configured." }, 503);

  const db = getDatabase();
  try {
    const body = await request.json().catch(() => ({}));
    const settings = await nutritionData(db, session.user.id).settings();
    const today = localDay(new Date(), settings.timezone);
    const parsed = z
      .object({
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
        allHistory: z.boolean().default(false),
        cursor: z.uuid().optional(),
      })
      .parse(body);

    const from = parsed.allHistory ? undefined : parsed.from ?? addDays(today, -13);
    const to = parsed.to ?? today;
    if (from) historyInput.parse({ from, to });

    const result = await pushPendingToGoogle(db, session.user.id, from, to, parsed.cursor);
    const processed = await processGoogleMeals(db, session.user.id, 1);
    return json({ ...result, mealsPushed: processed.synced, status: await googleStatus(db, session.user.id) });
  } catch (error) {
    if (error instanceof NutritionError) return json({ message: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ message: error.issues[0]?.message ?? "Invalid push range." }, 400);
    return json({ message: "Could not push data to Google Health right now." }, 500);
  }
}
