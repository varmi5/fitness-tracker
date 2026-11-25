import { logDiaryLoadFailure } from "../../../lib/diary-load-diagnostics";
import { z } from "zod";
import { localDay } from "../../../lib/nutrition-model";
import { getPulseInsightsForUser } from "../../../lib/pulse-data";
import { authConfigured, getAuth, getDatabase } from "../../../lib/runtime";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  if (!authConfigured()) return json({ message: "Setup is not configured." }, 503);
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ message: "Please sign in." }, 401);

  const dayParam = new URL(request.url).searchParams.get("day");
  try {
    const day = dayParam ? z.iso.date().parse(dayParam) : localDay(new Date());
    const insights = await getPulseInsightsForUser(getDatabase(), session.user.id, day);
    return json(insights);
  } catch (error) {
    if (error instanceof z.ZodError) return json({ message: error.issues[0]?.message ?? "Invalid day." }, 400);
    logDiaryLoadFailure("pulse", error);
    return json({ message: "Could not compute Pulse insights." }, 500);
  }
}
