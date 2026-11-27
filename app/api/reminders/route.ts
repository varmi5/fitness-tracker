import { z } from "zod";
import { isSameAllowedOrigin } from "../../../lib/origins";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../../../lib/runtime";
import { registerPush, reminderInput, reminderSettings, saveReminderSettings, unregisterPush } from "../../../lib/reminders";
export const dynamic = "force-dynamic";
const json = (v: unknown, status = 200) => Response.json(v, { status, headers: { "Cache-Control": "private, no-store" } });
async function user(request: Request) { return authConfigured() ? (await getAuth().api.getSession({ headers: request.headers }))?.user : null; }
export async function GET(request: Request) { const viewer = await user(request); return viewer ? json(await reminderSettings(getDatabase(), viewer.id)) : json({ message: "Please sign in." }, 401); }
const input = z.discriminatedUnion("action", [z.object({ action: z.literal("settings"), data: reminderInput }), z.object({ action: z.literal("subscribe"), subscription: z.unknown() }), z.object({ action: z.literal("unsubscribe"), endpoint: z.string().max(2000) })]);
export async function POST(request: Request) {
  if (!isSameAllowedOrigin(request, getAuthConfig())) return json({ message: "A same-origin request is required." }, 403);
  const viewer = await user(request); if (!viewer) return json({ message: "Please sign in." }, 401);
  try {
    const data = input.parse(await request.json()); const db = getDatabase();
    if (data.action === "settings") return json(await saveReminderSettings(db, viewer.id, data.data));
    if (data.action === "subscribe") return json(await registerPush(db, viewer.id, data.subscription));
    await unregisterPush(db, viewer.id, data.endpoint); return json(await reminderSettings(db, viewer.id));
  } catch (error) { return json({ message: error instanceof z.ZodError ? error.issues[0]?.message : "Could not update phone notifications." }, 400); }
}
