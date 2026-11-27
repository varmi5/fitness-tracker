import { physiqueShareAction, physiqueSharing } from "../../../../lib/physique-share";
import { isSameAllowedOrigin } from "../../../../lib/origins";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../../../../lib/runtime";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request) {
  if (!authConfigured()) return json({ message: "Setup is not configured." }, 503);
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ message: "Please sign in." }, 401);
  return json({ link: await physiqueSharing(getDatabase(), session.user.id).get() });
}

export async function POST(request: Request) {
  if (!authConfigured()) return json({ message: "Setup is not configured." }, 503);
  if (!isSameAllowedOrigin(request, getAuthConfig())) {
    return json({ message: "A same-origin request is required." }, 403);
  }
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ message: "Please sign in." }, 401);

  const body = await request.text();
  if (body.length > 65_536) return json({ message: "The share request is too large." }, 413);
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ message: "Invalid share request." }, 400);
  }
  const action = physiqueShareAction.safeParse(payload);
  if (!action.success) return json({ message: "Choose at least one photo to share." }, 400);
  const sharing = physiqueSharing(getDatabase(), session.user.id);
  if (action.data.action === "revoke") {
    return await sharing.revoke(action.data.currentToken)
      ? json({ link: null })
      : json({ message: "The active link changed. Reopen sharing to see it." }, 409);
  }
  const result = await sharing.save(action.data.checkinIds, action.data.currentToken, action.data.protection);
  if (result.status === "invalid_photos") return json({ message: "Some selected photos are unavailable. Reopen sharing and try again." }, 400);
  if (result.status === "conflict") return json({ message: "The active link changed. Reopen sharing to see it." }, 409);
  return json({ link: result.link });
}
