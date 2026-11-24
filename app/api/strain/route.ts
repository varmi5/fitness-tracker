import { z } from "zod";
import { historyInput } from "../../../lib/nutrition-model";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../../../lib/runtime";
import { strainData } from "../../../lib/strain-data";
import { getRecoveryInsightsForUser } from "../../../lib/recovery-insights";
import { trainingPreferenceInput } from "../../../lib/strain-engine";
import { getTrainingLoadSummary } from "../../../lib/training-load";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  if (!authConfigured()) return json({ message: "Setup is not configured." }, 503);
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ message: "Please sign in." }, 401);

  const db = getDatabase();
  const strain = strainData(db, session.user.id);
  const query = new URL(request.url).searchParams;

  try {
    if (query.get("loads") === "1" || query.get("mode") === "loads") {
      const range = historyInput.parse({ from: query.get("from"), to: query.get("to") });
      return json(await getTrainingLoadSummary(db, session.user.id, range.from, range.to));
    }
    if (query.has("day")) {
      const day = z.iso.date().parse(query.get("day"));
      const force = query.get("recompute") === "1";
      const [data, settings, recoveryInsights] = await Promise.all([
        force ? strain.computeDay(day) : (await strain.history(day, day))[0],
        strain.getSettings(),
        getRecoveryInsightsForUser(db, session.user.id, day),
      ]);
      return json({ strain: data, settings, recoveryInsights });
    }
    if (query.has("from") || query.has("to")) {
      const range = historyInput.parse({ from: query.get("from"), to: query.get("to") });
      return json({ days: await strain.history(range.from, range.to), settings: await strain.getSettings() });
    }
    return json({ settings: await strain.getSettings() });
  } catch (error) {
    if (error instanceof z.ZodError) return json({ message: error.issues[0]?.message ?? "Invalid request." }, 400);
    return json({ message: "Could not load strain data." }, 500);
  }
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(getAuthConfig().baseURL).origin) {
    return json({ message: "A same-origin request is required." }, 403);
  }
  if (!authConfigured()) return json({ message: "Setup is not configured." }, 503);
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return json({ message: "Please sign in." }, 401);

  const db = getDatabase();
  const strain = strainData(db, session.user.id);

  try {
    const body = await request.json();
    const action = z
      .discriminatedUnion("action", [
        z.object({
          action: z.literal("preferences"),
          data: trainingPreferenceInput,
          recomputeFrom: z.iso.date().optional(),
          recomputeTo: z.iso.date().optional(),
        }),
        z.object({
          action: z.literal("recompute"),
          day: z.iso.date().optional(),
          from: z.iso.date().optional(),
          to: z.iso.date().optional(),
        }),
      ])
      .parse(body);

    if (action.action === "preferences") {
      const settings = await strain.updateSettings(action.data);
      if (action.recomputeFrom && action.recomputeTo) {
        historyInput.parse({ from: action.recomputeFrom, to: action.recomputeTo });
        await strain.recomputeRange(action.recomputeFrom, action.recomputeTo);
      }
      return json({ settings });
    }

    if (action.day) {
      const [computedStrain, recoveryInsights] = await Promise.all([
        strain.computeDay(action.day),
        getRecoveryInsightsForUser(db, session.user.id, action.day),
      ]);
      return json({ strain: computedStrain, recoveryInsights });
    }
    if (action.from && action.to) {
      historyInput.parse({ from: action.from, to: action.to });
      return json({ days: await strain.recomputeRange(action.from, action.to) });
    }
    return json({ message: "Specify day or from/to range." }, 400);
  } catch (error) {
    if (error instanceof z.ZodError) return json({ message: error.issues[0]?.message ?? "Invalid request." }, 400);
    return json({ message: "Could not update strain data." }, 500);
  }
}
