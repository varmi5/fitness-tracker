import { refreshOpenWearablesConnection } from "../../../../../lib/open-wearables";
import { authConfigured, getAuth, getDatabase } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET(request: Request) {
  if (!authConfigured()) return json({ message: "Setup is not configured." }, 503);
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ message: "Please sign in." }, 401);
  try {
    return json({ status: await refreshOpenWearablesConnection(getDatabase(), session.user.id) });
  } catch {
    return json({ message: "Could not check Open Wearables connection. Please try again." }, 502);
  }
}
