import { z } from "zod";
import { hevyStatus, importHevyWorkouts, parseHevyImport } from "../../../../../lib/hevy";
import { NutritionError, nutritionData } from "../../../../../lib/nutrition-data";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(getAuthConfig().baseURL).origin) {
    return json({ message: "A same-origin request is required." }, 403);
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 2_500_000) {
    return json({ message: "Hevy export file is too large (max 2 MB)." }, 413);
  }
  if (!authConfigured()) return json({ message: "Setup is not configured." }, 503);
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ message: "Please sign in." }, 401);

  const db = getDatabase();
  try {
    const rawBody = await request.text();
    if (rawBody.length > 2_500_000) {
      return json({ message: "Hevy export file is too large (max 2 MB)." }, 413);
    }
    const body = z
      .object({ rawText: z.string().min(1).max(2_000_000) })
      .parse(JSON.parse(rawBody));
    const prefs = await nutritionData(db, session.user.id).settings();
    const workouts = parseHevyImport(body.rawText, prefs.timezone);
    const result = await importHevyWorkouts(db, session.user.id, workouts);
    return json({ ...result, status: await hevyStatus(db, session.user.id) });
  } catch (error) {
    if (error instanceof NutritionError) return json({ message: error.message }, error.status);
    if (error instanceof z.ZodError) return json({ message: error.issues[0]?.message ?? "Invalid Hevy export." }, 400);
    return json({ message: "Could not import Hevy workouts." }, 500);
  }
}
