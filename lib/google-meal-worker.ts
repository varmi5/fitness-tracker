import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import type { AuthDatabase } from "./auth";
import { buildGoogleNutritionLogDataPoint, getFreshGrant } from "./google-health";
import type { GoogleMealSnapshot } from "./google-sync-queue";
import { googleMealSync, healthIntegration, meal, nutritionPreference } from "./schema";
const nutritionScope = "https://www.googleapis.com/auth/googlehealth.nutrition.writeonly";
const root = "https://health.googleapis.com/v4/";
const validName = (name: unknown): name is string => typeof name === "string" && /^users\/[A-Za-z0-9-]+\/dataTypes\/nutrition-log\/dataPoints\/[a-z0-9-]{4,63}$/.test(name);
class PendingOperation extends Error {}
async function google(request: string, token: string, method = "GET", payload?: unknown) {
  const response = await fetch(root + request, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(8000), cache: "no-store" });
  return response;
}
async function ensureRecord(snapshot: GoogleMealSnapshot, target: string, token: string, pending: (value: boolean) => Promise<void>) {
  const found = await google(target, token);
  if (found.ok) { const record = await found.json(); if (validName(record.name) && record.name.split("/").at(-1) === target.split("/").at(-1)) { await pending(false); return record.name as string; } throw new Error("Google returned an invalid meal reference."); }
  if (found.status !== 404) throw new Error(`Google meal lookup returned HTTP ${found.status}.`);
  await pending(true);
  const created = await google("users/me/dataTypes/nutrition-log/dataPoints", token, "POST", { name: target, ...buildGoogleNutritionLogDataPoint(snapshot) });
  if (created.status === 409) throw new PendingOperation("Google is finishing this meal. Retrying the same reference.");
  if (!created.ok) { if (created.status < 500) await pending(false); throw new Error(`Google meal creation returned HTTP ${created.status}.`); }
  const operation = await created.json();
  if (operation.error) { await pending(false); throw new Error(`Google meal operation failed (code ${Number(operation.error.code) || "unknown"}).`); }
  if (!operation.done) throw new PendingOperation("Google is processing this meal.");
  const name = operation.response?.name;
  if (!validName(name) || name.split("/").at(-1) !== target.split("/").at(-1)) throw new Error("Google did not confirm the saved meal reference.");
  await pending(false);
  return name;
}
async function removeRecords(names: string[], token: string) {
  if (!names.length) return;
  const response = await google("users/me/dataTypes/nutrition-log/dataPoints:batchDelete", token, "POST", { names });
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`Google meal deletion returned HTTP ${response.status}.`);
  const result = await response.json();
  if (result.error) throw new Error(`Google deletion operation failed (code ${Number(result.error.code) || "unknown"}).`);
  if (!result.done) throw new PendingOperation("Google is completing the deletion.");
}
export async function processGoogleMeals(db: AuthDatabase, userId?: string, limit = 4) {
  let synced = 0;
  for (let index = 0; index < limit; index++) {
    const job = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(googleMealSync).where(and(
        inArray(googleMealSync.state, ["pending", "error"]), lte(googleMealSync.nextAttemptAt, new Date()),
        or(isNull(googleMealSync.leasedUntil), lte(googleMealSync.leasedUntil, new Date())), userId ? eq(googleMealSync.userId, userId) : undefined,
      )).orderBy(asc(googleMealSync.nextAttemptAt)).limit(1).for("update", { skipLocked: true });
      if (!row) return null;
      await tx.update(googleMealSync).set({ leasedUntil: new Date(Date.now() + 120000) }).where(and(eq(googleMealSync.userId, row.userId), eq(googleMealSync.mealId, row.mealId)));
      return row;
    });
    if (!job) break;
    const own = and(eq(googleMealSync.userId, job.userId), eq(googleMealSync.mealId, job.mealId), eq(googleMealSync.connectionId, job.connectionId));
    const markPending = async (name: string, value: boolean) => db.transaction(async (tx) => {
      const [current] = await tx.select().from(googleMealSync).where(own).for("update");
      if (!current) return;
      const names = (Array.isArray(current.pendingNames) ? current.pendingNames : []).filter(validName);
      await tx.update(googleMealSync).set({ pendingNames: value ? [...new Set([...names, name])] : names.filter((n) => n !== name) }).where(own);
    });
    try {
      const [connection] = await db.select().from(healthIntegration).where(and(eq(healthIntegration.userId, job.userId), eq(healthIntegration.provider, "google")));
      const [prefs] = await db.select().from(nutritionPreference).where(eq(nutritionPreference.userId, job.userId));
      if (!connection || connection.connectionId !== job.connectionId) { await db.delete(googleMealSync).where(own); continue; }
      if (!job.manual && !prefs?.googleTwoWaySync) { await db.update(googleMealSync).set({ state: "paused", leasedUntil: null }).where(own); continue; }
      const { grant } = await getFreshGrant(db, job.userId);
      if (!grant.scopes.includes(nutritionScope)) throw new Error("Reconnect Google Health to grant meal write permission.");
      const oldNames = (Array.isArray(job.cleanupNames) ? job.cleanupNames : []).filter(validName);
      // A create with a lost/pending response can finish after a local edit or delete.
      // Keep its reference until Google confirms it, then include it in cleanup.
      const uncertain = (Array.isArray(job.pendingNames) ? job.pendingNames : []).filter(validName);
      for (const name of uncertain.filter((name) => job.action === "delete" || name !== job.targetName)) {
        const check = await google(name, grant.accessToken);
        if (check.status === 404) throw new PendingOperation("Google has not settled an earlier meal write. Cleanup will retry.");
        if (!check.ok) throw new Error(`Google meal lookup returned HTTP ${check.status}.`);
        if (!validName((await check.json()).name)) throw new Error("Google returned an invalid meal reference.");
        if (!oldNames.includes(name)) oldNames.push(name);
        await markPending(name, false);
      }
      if (job.action === "delete") {
        const names = [...new Set([...oldNames, ...(validName(job.remoteName) ? [job.remoteName] : []), ...(validName(job.targetName) ? [job.targetName] : [])])];
        await removeRecords(names, grant.accessToken);
        await db.delete(googleMealSync).where(and(own, eq(googleMealSync.version, job.version)));
        continue;
      }
      if (!validName(job.targetName) || !job.payload) throw new Error("The queued meal has no valid target.");
      const remote = job.remoteName === job.targetName ? job.remoteName : await ensureRecord(job.payload as GoogleMealSnapshot, job.targetName, grant.accessToken, (value) => markPending(job.targetName!, value));
      // Persist the confirmed new ID before cleaning up any older record. A failed replacement never removes the old meal.
      const cleanup = [...new Set([...oldNames, ...(validName(job.remoteName) && job.remoteName !== remote ? [job.remoteName] : [])])];
      await db.transaction(async (tx) => {
        const [current] = await tx.select().from(googleMealSync).where(own).for("update");
        if (!current) return;
        await tx.update(googleMealSync).set({ remoteName: remote, cleanupNames: [...new Set([...cleanup, ...(Array.isArray(current.cleanupNames) ? current.cleanupNames.filter(validName) : [])])], updatedAt: new Date() }).where(own);
        await tx.update(meal).set({ googleDatapointName: remote }).where(and(eq(meal.id, job.mealId), eq(meal.userId, job.userId)));
      });
      await removeRecords(cleanup, grant.accessToken);
      await db.update(googleMealSync).set({ state: "synced", cleanupNames: [], attempts: 0, lastError: null, leasedUntil: null, updatedAt: new Date() })
        .where(and(own, eq(googleMealSync.version, job.version)));
      await db.update(googleMealSync).set({ leasedUntil: null }).where(own);
      synced++;
    } catch (error) {
      const pending = error instanceof PendingOperation;
      const message = pending ? error.message : error instanceof Error && error.message.startsWith("Google") || error instanceof Error && error.message.startsWith("Reconnect") ? (error as Error).message : "Google could not confirm this meal. It remains queued for retry.";
      await db.update(googleMealSync).set({ state: pending ? "pending" : "error", attempts: job.attempts + 1, leasedUntil: null,
        lastError: message, nextAttemptAt: new Date(Date.now() + (pending ? 15000 : Math.min(3600000, 30000 * 2 ** Math.min(job.attempts, 7)))) })
        .where(and(own, eq(googleMealSync.version, job.version)));
      await db.update(googleMealSync).set({ leasedUntil: null }).where(own);
    }
  }
  return { synced };
}
export async function googleMealStatus(db: AuthDatabase, userId: string) {
  const rows = await db.select({ state: googleMealSync.state, error: googleMealSync.lastError, updatedAt: googleMealSync.updatedAt }).from(googleMealSync).where(eq(googleMealSync.userId, userId));
  return { pending: rows.filter((row) => row.state === "pending").length, failed: rows.filter((row) => row.state === "error").length,
    lastError: rows.filter((row) => row.error).sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]?.error ?? null };
}
