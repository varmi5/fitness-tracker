import { z } from "zod";
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

async function dataFor(request: Request) {
  if (!authConfigured()) return null;
  const session = await getAuth().api.getSession({ headers: request.headers });
  return session ? trackerData(getDatabase(), session.user.id) : null;
}

export async function GET(request: Request) {
  const data = await dataFor(request);
  if (!data) return json({ message: "Please sign in." }, 401);
  return json(await data.snapshot());
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(getAuthConfig().baseURL).origin) {
    return json({ message: "A same-origin request is required." }, 403);
  }
  const data = await dataFor(request);
  if (!data) return json({ message: "Please sign in." }, 401);
  const parsed = update.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ message: "Check your entries and try again." }, 400);
  const input = parsed.data;
  switch (input.action) {
    case "log":
      await data.saveLog(input.data);
      break;
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
