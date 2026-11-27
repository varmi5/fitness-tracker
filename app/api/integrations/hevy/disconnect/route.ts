import { z } from "zod";
import { disconnectHevy, hevyStatus } from "../../../../../lib/hevy";
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
  const body = await request.json().catch(() => ({}));
  const parsed = z.object({ deleteWorkouts: z.boolean().optional().default(false) }).parse(body);
  await disconnectHevy(db, session.user.id, parsed.deleteWorkouts);
  return json({ disconnected: true, status: await hevyStatus(db, session.user.id) });
}
