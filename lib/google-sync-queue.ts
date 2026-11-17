import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AuthDatabase } from "./auth";
import { googleMealSync, healthIntegration, meal, mealItem, nutritionPreference } from "./schema";
import { summarizeItems, type MealCategory } from "./nutrition-model";
export type QueueDatabase = AuthDatabase | Parameters<Parameters<AuthDatabase["transaction"]>[0]>[0];
export interface GoogleMealSnapshot { id: string; name: string; category: MealCategory; consumedAt: string; totals: ReturnType<typeof summarizeItems> }
export function googleMealTarget(snapshot: GoogleMealSnapshot) {
  const version = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  return { version, name: `users/me/dataTypes/nutrition-log/dataPoints/ft-${snapshot.id}-${version.slice(0, 12)}` };
}
export async function queueGoogleMeal(db: QueueDatabase, userId: string, mealId: string, action: "upsert" | "delete" = "upsert", force = false) {
  const [connection] = await db.select({ connectionId: healthIntegration.connectionId }).from(healthIntegration)
    .where(and(eq(healthIntegration.userId, userId), eq(healthIntegration.provider, "google")));
  if (!connection) return false;
  const [prefs] = await db.select().from(nutritionPreference).where(eq(nutritionPreference.userId, userId));
  if (!force && !prefs?.googleTwoWaySync) return false;
  const [entry] = await db.select().from(meal).where(and(eq(meal.userId, userId), eq(meal.id, mealId)));
  if (!entry && action === "upsert") return false;
  const rows = action === "upsert" ? await db.select().from(mealItem).where(and(eq(mealItem.userId, userId), eq(mealItem.mealId, mealId))) : [];
  const snapshot: GoogleMealSnapshot | null = entry && action === "upsert" ? { id: mealId, name: entry.name, category: entry.category as MealCategory, consumedAt: entry.consumedAt.toISOString(), totals: summarizeItems(rows) } : null;
  const target = snapshot ? googleMealTarget(snapshot) : { version: "deleted", name: null };
  await db.insert(googleMealSync).values({ userId, mealId, connectionId: connection.connectionId, manual: force, action, payload: snapshot, version: target.version,
    targetName: target.name, remoteName: entry?.googleDatapointName ?? null, state: "pending" }).onConflictDoUpdate({
      target: [googleMealSync.userId, googleMealSync.mealId], set: { action, manual: force, payload: snapshot, version: target.version, targetName: action === "delete" ? googleMealSync.targetName : target.name,
        state: "pending", nextAttemptAt: new Date(), attempts: 0, lastError: null, updatedAt: new Date() },
    });
  return true;
}
