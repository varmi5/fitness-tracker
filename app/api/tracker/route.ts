import { z } from "zod";
import { pushWeightToGoogle } from "../../../lib/google-health";
import { nutritionData } from "../../../lib/nutrition-data";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../../../lib/runtime";
import { logInput, profileInput, trackerData } from "../../../lib/tracker-data";

const update = z.discriminatedUnion("action", [
  z.object({ action: z.literal("log"), data: logInput }),
  z.object({ action: z.literal("settings"), data: profileInput }),
  z.object({ action: z.literal("delete-reading"), id: z.uuid() }),
  z.object({ action: z.literal("delete-account"), confirmation: z.literal("DELETE") }),
]);

const json = (data: unknown, status = 200) => Response.json(data, {
  status, headers: { "Cache-Control": "no-store" },
});

async function userSession(request: Request) {
  if (!authConfigured()) return null;
  const session = await getAuth().api.getSession({ headers: request.headers });
  return session?.user ?? null;
}

export async function GET(request: Request) {
  const user = await userSession(request);
  if (!user) return json({ message: "Please sign in." }, 401);
  return json(await trackerData(getDatabase(), user.id).snapshot());
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(getAuthConfig().baseURL).origin) {
    return json({ message: "A same-origin request is required." }, 403);
  }
  const user = await userSession(request);
  if (!user) return json({ message: "Please sign in." }, 401);
  const db = getDatabase();
  const data = trackerData(db, user.id);
  const parsed = update.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ message: "Check your entries and try again." }, 400);
  const input = parsed.data;
  switch (input.action) {
    case "log": {
      await data.saveLog(input.data);
      const weightEntry = input.data.values.find((v) => v.key === "weight");
      if (weightEntry) {
        const prefs = await nutritionData(db, user.id).settings();
        if (prefs.googleTwoWaySync) {
          await pushWeightToGoogle(db, user.id, {
            weightKg: weightEntry.value,
            day: input.data.date,
            timezone: prefs.timezone,
            note: input.data.note,
          }).catch(() => null);
        }
      }
      break;
    }
    case "settings":
      await data.saveSettings(input.data);
      break;
    case "delete-reading":
      if (!await data.deleteReading(input.id)) return json({ message: "Measurement not found." }, 404);
      break;
    case "delete-account":
      await data.deleteAccount();
      return json({ deleted: true });
  }
  return json(await data.snapshot());
}
