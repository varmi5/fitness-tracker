import { logDiaryLoadFailure } from "../../../lib/diary-load-diagnostics";
import { macroTargetInput } from "../../../lib/macro-targets";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  googleStatus,
  parseSavedHealthImport,
  pushWeightToGoogle,
} from "../../../lib/google-health";
import { NutritionError, nutritionData, preferencesInput, targetInput } from "../../../lib/nutrition-data";
import { energyInput, historyInput, logMealInput, templateInput, updateMealInput } from "../../../lib/nutrition-model";
import { mcpResource } from "../../../lib/mcp-config";
import { isSameAllowedOrigin } from "../../../lib/origins";
import { authConfigured, getAuth, getAuthConfig, getDatabase } from "../../../lib/runtime";
import { mcpRevocation, oauthAccessToken, oauthConsent, oauthRefreshToken } from "../../../lib/schema";
import { hevyStatus } from "../../../lib/hevy";
import { openWearablesStatus } from "../../../lib/open-wearables";
import { trackerData } from "../../../lib/tracker-data";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

const mutation = z.discriminatedUnion("action", [
  z.object({ action: z.literal("log"), data: z.unknown() }),
  z.object({ action: z.literal("update"), data: z.unknown() }),
  z.object({ action: z.literal("duplicate"), id: z.uuid(), targetDay: z.iso.date().optional() }),
  z.object({ action: z.literal("delete"), id: z.uuid() }),
  z.object({ action: z.literal("complete"), data: z.object({ day: z.iso.date(), completed: z.boolean().optional() }) }),
  z.object({ action: z.literal("target"), data: targetInput }),
  z.object({ action: z.literal("macro-targets"), data: macroTargetInput }),
  z.object({ action: z.literal("preferences"), data: preferencesInput }),
  z.object({ action: z.literal("energy"), data: energyInput }),
  z.object({ action: z.literal("energy-import"), entries: z.array(energyInput).min(1).max(365) }),
  z.object({ action: z.literal("import-health-file"), rawText: z.string().min(1).max(2_000_000) }),
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
  return json({ message: "FitnessTrackr could not complete this request." }, 500);
}

export async function GET(request: Request) {
  const user = await getUser(request);
  if (!user) return json({ message: "Please sign in." }, 401);
  const db = getDatabase();
  const data = nutritionData(db, user.id);
  const query = new URL(request.url).searchParams;

  try {
    if (query.get("sync") === "1") {
      return json({ token: await data.syncToken() });
    }
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
    const [settings, google, hevy, openWearables, audit] = await Promise.all([
      data.settings(),
      googleStatus(db, user.id),
      hevyStatus(db, user.id),
      openWearablesStatus(db, user.id),
      data.recentAudit(15),
    ]);
    const homeState = await data.homeState({ canReadSleep: google.canReadSleep, timezone: settings.timezone });
    const authConfig = getAuthConfig();
    return json({ settings, google, hevy, openWearables, audit, homeState, mcpEnabled: authConfig.mcpEnabled, mcpUrl: mcpResource(authConfig.mcpBaseURL ?? authConfig.baseURL) });
  } catch (error) {
    if (!(error instanceof z.ZodError) && !(error instanceof NutritionError)) logDiaryLoadFailure("nutrition", error);
    return handleError(error);
  }
}

export async function POST(request: Request) {
  if (!isSameAllowedOrigin(request, getAuthConfig())) {
    return json({ message: "A same-origin request is required." }, 403);
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 2_500_000) {
    return json({ message: "Request payload is too large." }, 413);
  }
  const user = await getUser(request);
  if (!user) return json({ message: "Please sign in." }, 401);
  const db = getDatabase();
  const data = nutritionData(db, user.id);

  try {
    const rawBody = await request.text();
    if (rawBody.length > 2_500_000) {
      return json({ message: "Request payload is too large." }, 413);
    }
    const parsedJson = (() => {
      try { return JSON.parse(rawBody); } catch { return null; }
    })();
    const input = mutation.parse(parsedJson);
    switch (input.action) {
      case "log": {
        const res = await data.log(logMealInput.parse(input.data));
        return json(res);
      }
      case "update": {
        const res = await data.update(updateMealInput.parse(input.data));
        return json(res);
      }
      case "duplicate": {
        const res = await data.duplicate(input.id, input.targetDay);
        return json(res);
      }
      case "delete":
        return json(await data.remove(input.id, true));
      case "complete":
        return json(await data.daily(input.data.day));
      case "macro-targets":
        return json(await data.setNutritionTargets(input.data));
      case "target":
        return json(await data.setTarget(input.data));
      case "preferences":
        return json(await data.setPreferences(input.data));
      case "energy": {
        const saved = await data.saveEnergy(input.data);
        const prefs = await data.settings();
        if (prefs.googleTwoWaySync && input.data.weightKg != null) {
          await pushWeightToGoogle(db, user.id, {
            weightKg: input.data.weightKg,
            day: input.data.day,
            timezone: prefs.timezone,
          }).catch(() => null);
        }
        return json(saved);
      }
      case "energy-import": {
        for (const entry of input.entries) {
          await data.saveEnergy(entry);
        }
        return json({ imported: input.entries.length });
      }
      case "import-health-file": {
        const prefs = await data.settings();
        const parsed = parseSavedHealthImport(input.rawText, prefs.timezone);
        return json(await data.importHealthRecords(parsed));
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
