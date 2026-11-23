import { hevyOAuthConfigured, hevyStatus, syncHevyOAuth } from "../../../../../lib/hevy";
import { NutritionError } from "../../../../../lib/nutrition-data";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(getAuthConfig().baseURL).origin) {
    return json({ message: "A same-origin request is required." }, 403);
  }
  if (!authConfigured()) return json({ message: "Setup is not configured." }, 503);
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ message: "Please sign in." }, 401);
  if (!hevyOAuthConfigured()) {
    return json({ message: "Hevy OAuth is not configured. Import your Hevy CSV/JSON export instead." }, 503);
  }

  const db = getDatabase();
  try {
    const result = await syncHevyOAuth(db, session.user.id);
    return json({ ...result, status: await hevyStatus(db, session.user.id) });
  } catch (error) {
    if (error instanceof NutritionError) return json({ message: error.message }, error.status);
    return json({ message: "Could not sync Hevy right now." }, 500);
  }
}
