import { createOpenWearablesInviteCode } from "../../../../../lib/open-wearables";
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

  try {
    const body = await request.json().catch(() => ({}));
    if (body === null || typeof body !== "object" || (body.reset !== undefined && typeof body.reset !== "boolean")) return json({ message: "Invalid reset request." }, 400);
    const result = await createOpenWearablesInviteCode(getDatabase(), session.user.id, body.reset === true);
    return json(result);
  } catch (error) {
    if (error instanceof NutritionError) return json({ message: error.message }, error.status);
    return json({ message: "Could not create Open Wearables invitation code." }, 500);
  }
}
