import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AuthDatabase } from "./auth";
import { googleMealSync, healthIntegration, meal, mealItem, nutritionPreference } from "./schema";
import { summarizeItems, type MealCategory } from "./nutrition-model";
export type QueueDatabase = AuthDatabase | Parameters<Parameters<AuthDatabase["transaction"]>[0]>[0];
export interface GoogleMealSnapshot { id: string; name: string; category: MealCategory; consumedAt: string; totals: ReturnType<typeof summarizeItems> }
export function googleMealTarget(snapshot: GoogleMealSnapshot) {
  // Include the wire-format revision: an immutable anonymous Google log needs replacement
  // when its serialization changes, even if the local meal did not change.
  const version = createHash("sha256").update("nutrition-log:v2:").update(JSON.stringify(snapshot)).digest("hex");
  return { version, name: `users/me/dataTypes/nutrition-log/dataPoints/ft-${snapshot.id}-${version.slice(0, 12)}` };
}
export async function queueGoogleMeal(db: QueueDatabase, userId: string, mealId: string, action: "upsert" | "delete" = "upsert", force = false) {
  const [connection] = await db.select({ connectionId: healthIntegration.connectionId }).from(healthIntegration)
    .where(and(eq(healthIntegration.userId, userId), eq(healthIntegration.provider, "google")));
  if (!connection) return false;
  const [prefs] = await db.select().from(nutritionPreference).where(eq(nutritionPreference.userId, userId));
  const [existing] = await db.select().from(googleMealSync).where(and(eq(googleMealSync.userId, userId), eq(googleMealSync.mealId, mealId)));
  // Continue maintaining an already-exported record, including deletion, when auto-export is off.
  if (!force && !prefs?.googleTwoWaySync && !existing?.remoteName && !(Array.isArray(existing?.pendingNames) && existing.pendingNames.length)) return false;
  const [entry] = await db.select().from(meal).where(and(eq(meal.userId, userId), eq(meal.id, mealId)));
  if (!entry && action === "upsert") return false;
  if (action === "upsert" && entry?.origin !== "local") return false;
  const rows = action === "upsert" ? await db.select().from(mealItem).where(and(eq(mealItem.userId, userId), eq(mealItem.mealId, mealId))) : [];
  const snapshot: GoogleMealSnapshot | null = entry && action === "upsert" ? { id: mealId, name: entry.name, category: entry.category as MealCategory, consumedAt: entry.consumedAt.toISOString(), totals: summarizeItems(rows) } : null;
  const target = snapshot ? googleMealTarget(snapshot) : { version: "deleted", name: null };
  if (action === "upsert" && existing?.connectionId === connection.connectionId && existing.version === target.version && existing.state === "synced" && existing.verifiedAt) return false;
  const manual = force || Boolean(existing?.manual) || (action === "delete" && Boolean(existing?.remoteName || entry?.googleDatapointName));
  await db.insert(googleMealSync).values({ userId, mealId, connectionId: connection.connectionId, manual, action, payload: snapshot, version: target.version,
    targetName: target.name, remoteName: entry?.googleDatapointName ?? null, state: "pending" }).onConflictDoUpdate({
      target: [googleMealSync.userId, googleMealSync.mealId], set: { action, manual, payload: snapshot, version: target.version, targetName: action === "delete" ? googleMealSync.targetName : target.name,
        state: "pending", verifiedAt: null, nextAttemptAt: new Date(), attempts: 0, lastError: null, updatedAt: new Date() },
    });
  return true;
}
