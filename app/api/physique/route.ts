import { z } from "zod";
import { createPhysiqueInput, PHYSIQUE_POSES, physiqueData, updatePhysiqueInput } from "../../../lib/physique-data";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../../../lib/runtime";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  if (!authConfigured()) return json({ message: "Setup is not configured." }, 503);
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ message: "Please sign in." }, 401);

  const db = getDatabase();
  const data = physiqueData(db, session.user.id);
  const poseParam = new URL(request.url).searchParams.get("pose");

  try {
    const pose = poseParam ? z.enum(PHYSIQUE_POSES).parse(poseParam) : undefined;
    const checkins = await data.list(pose);
    return json({ checkins });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ message: error.issues[0]?.message ?? "Invalid pose filter." }, 400);
    return json({ message: "Could not load physique check-ins." }, 500);
  }
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(getAuthConfig().baseURL).origin) {
    return json({ message: "A same-origin request is required." }, 403);
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_500_000) {
    return json({ message: "Photo payload is too large." }, 413);
  }
  if (!authConfigured()) return json({ message: "Setup is not configured." }, 503);
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ message: "Please sign in." }, 401);

  const db = getDatabase();
  const data = physiqueData(db, session.user.id);

  try {
    const rawBody = await request.text();
    if (rawBody.length > 1_500_000) {
      return json({ message: "Photo payload is too large." }, 413);
    }
    const parsedJson = (() => {
      try {
        return JSON.parse(rawBody);
      } catch {
        return null;
      }
    })();

    const action = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("create"), data: createPhysiqueInput }),
        z.object({ action: z.literal("update"), id: z.string().min(1), data: updatePhysiqueInput }),
        z.object({ action: z.literal("delete"), id: z.string().min(1) }),
      ])
      .parse(parsedJson);

    if (action.action === "create") {
      const checkin = await data.create(action.data);
      return json({ checkin });
    }
    if (action.action === "update") {
      const checkin = await data.update(action.id, action.data);
      if (!checkin) return json({ message: "Check-in not found." }, 404);
      return json({ checkin });
    }
    return json(await data.remove(action.id));
  } catch (error) {
    if (error instanceof z.ZodError) return json({ message: error.issues[0]?.message ?? "Invalid request." }, 400);
    return json({ message: "Could not save physique check-in." }, 500);
  }
}
