import { eq } from "drizzle-orm";
import { z } from "zod";
import { googleStatus } from "../../../lib/google-health";
import { NutritionError, nutritionData, preferencesInput, targetInput } from "../../../lib/nutrition-data";
import { energyInput, historyInput, logMealInput, templateInput, updateMealInput } from "../../../lib/nutrition-model";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../../../lib/runtime";
import { mcpRevocation, oauthAccessToken, oauthConsent, oauthRefreshToken } from "../../../lib/schema";
import { trackerData } from "../../../lib/tracker-data";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("log"), data: z.unknown() }),
  z.object({ action: z.literal("update"), data: z.unknown() }),
  z.object({ action: z.literal("duplicate"), id: z.uuid(), targetDay: z.iso.date().optional() }),
  z.object({ action: z.literal("delete"), id: z.uuid() }),
  z.object({ action: z.literal("target"), data: targetInput }),
  z.object({ action: z.literal("preferences"), data: preferencesInput }),
  z.object({ action: z.literal("complete"), day: z.iso.date(), complete: z.boolean() }),
  z.object({ action: z.literal("energy"), data: energyInput }),
  z.object({ action: z.literal("energy-import"), entries: z.array(energyInput).min(1).max(90) }),
  z.object({ action: z.literal("save-template"), data: templateInput }),
  z.object({ action: z.literal("remove-template"), id: z.uuid() }),
  z.object({ action: z.literal("revoke-mcp") }),
]);

async function getUser(request: Request) {
  return authConfigured() ? (await getAuth().api.getSession({ headers: request.headers }))?.user : undefined;
}

function handleError(error: unknown) {
  if (error instanceof NutritionError) return json({ message: error.message }, error.status);
  if (error instanceof z.ZodError) return json({ message: error.issues[0]?.message ?? "Invalid entry." }, 400);
  return json({ message: "Fitness could not complete this request." }, 500);
}

export async function GET(request: Request) {
  const user = await getUser(request);
  if (!user) return json({ message: "Please sign in." }, 401);
  const db = getDatabase();
  const data = nutritionData(db, user.id);
  const query = new URL(request.url).searchParams;

  try {
    if (query.get("export") === "json") {
      return json({
        body: await trackerData(db, user.id).snapshot(),
        nutrition: await data.export(),
      });
    }
    if (query.get("library") !== null) {
      return json(await data.library(z.string().max(150).parse(query.get("library") ?? "")));
    }
    if (query.has("day")) {
      return json(await data.daily(z.iso.date().parse(query.get("day"))));
    }
    if (query.has("from") || query.has("to")) {
      const range = historyInput.parse({ from: query.get("from"), to: query.get("to") });
      return json(await data.history(range.from, range.to));
    }
    const [settings, google, audit] = await Promise.all([
      data.settings(),
      googleStatus(db, user.id),
      data.recentAudit(15),
    ]);
    return json({ settings, google, audit, mcpEnabled: getAuthConfig().mcpEnabled });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(getAuthConfig().baseURL).origin) {
    return json({ message: "A same-origin request is required." }, 403);
  }
  const user = await getUser(request);
  if (!user) return json({ message: "Please sign in." }, 401);
  const db = getDatabase();
  const data = nutritionData(db, user.id);

  try {
    const input = mutation.parse(await request.json().catch(() => null));
    switch (input.action) {
      case "log":
        return json(await data.log(logMealInput.parse(input.data)));
      case "update":
        return json(await data.update(updateMealInput.parse(input.data)));
      case "duplicate":
        return json(await data.duplicate(input.id, input.targetDay));
      case "delete":
        return json(await data.remove(input.id, true));
      case "target":
        return json(await data.setTarget(input.data));
      case "preferences":
        return json(await data.setPreferences(input.data));
      case "complete":
        return json(await data.markDay(input.day, input.complete));
      case "energy":
        return json(await data.saveEnergy(input.data));
      case "energy-import": {
        for (const entry of input.entries) {
          await data.saveEnergy(entry);
        }
        return json({ imported: input.entries.length });
      }
      case "save-template":
        return json(await data.saveTemplate(input.data));
      case "remove-template":
        return json(await data.removeTemplate(input.id));
      case "revoke-mcp":
        await db.transaction(async (tx) => {
          const revokedAt = new Date();
          await tx
            .insert(mcpRevocation)
            .values({ userId: user.id, revokedAt })
            .onConflictDoUpdate({ target: mcpRevocation.userId, set: { revokedAt } });
          await tx.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, user.id));
          await tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, user.id));
          await tx.delete(oauthConsent).where(eq(oauthConsent.userId, user.id));
        });
        return json({ revoked: true });
    }
  } catch (error) {
    return handleError(error);
  }
}
