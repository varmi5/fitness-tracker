import { disconnectOpenWearables, openWearablesStatus } from "../../../../../lib/open-wearables";
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

  const db = getDatabase();
  const result = await disconnectOpenWearables(db, session.user.id);
  return json({ ...result, status: await openWearablesStatus(db, session.user.id) });
}
