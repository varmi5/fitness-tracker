import { z } from "zod";
import { openWearablesConfigured, openWearablesStatus, syncOpenWearables } from "../../../../../lib/open-wearables";
import { nutritionData, NutritionError } from "../../../../../lib/nutrition-data";
import { addDays, historyInput, localDay } from "../../../../../lib/nutrition-model";
import { isSameAllowedOrigin } from "../../../../../lib/origins";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(request: Request) {
  if (!isSameAllowedOrigin(request, getAuthConfig())) {
    return json({ message: "A same-origin request is required." }, 403);
  }
  if (!authConfigured()) return json({ message: "Setup is not configured." }, 503);
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ message: "Please sign in." }, 401);
  if (!openWearablesConfigured()) return json({ message: "Open Wearables is not configured." }, 503);

  const db = getDatabase();
  try {
    const body = await request.json().catch(() => ({}));
    const settings = await nutritionData(db, session.user.id).settings();
    const today = localDay(new Date(), settings.timezone);
    const parsed = z
      .object({
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
      })
      .parse(body);

    const from = parsed.from ?? addDays(today, -13);
    const to = parsed.to ?? today;
    historyInput.parse({ from, to });

    const result = await syncOpenWearables(db, session.user.id, { from, to });
    return json({ ...result, status: await openWearablesStatus(db, session.user.id) });
  } catch (error) {
    if (error instanceof NutritionError) return json({ message: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ message: error.issues[0]?.message ?? "Invalid sync range." }, 400);
    return json({ message: "Could not sync Open Wearables right now." }, 500);
  }
}
