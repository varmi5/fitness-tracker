// Container-only maintenance command. No public auth bypass or new credentials.
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq } from "drizzle-orm";
import { getFreshGrant, googleStatus, pushPendingToGoogle } from "../lib/google-health";
import { findGoogleMealRecords, processGoogleMeals, verifyGoogleNutritionRecord } from "../lib/google-meal-worker";
import type { GoogleMealSnapshot } from "../lib/google-sync-queue";
import * as schema from "../lib/schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, statement_timeout: 15000 });
async function main() {
  const email = process.argv.find((arg) => arg.startsWith("--account="))?.slice(10);
  if (!email || !process.env.DATABASE_URL) throw new Error("Account and database configuration required.");
  const db = drizzle(pool, { schema });
  const matches = await db.select({ userId: schema.healthIntegration.userId, connectionId: schema.healthIntegration.connectionId })
    .from(schema.healthIntegration).where(and(eq(schema.healthIntegration.provider, "google"), eq(schema.healthIntegration.accountLabel, email)));
  if (matches.length !== 1) throw new Error("Google account is not uniquely identified.");
  const { userId, connectionId } = matches[0];
  const local = await db.select({ day: schema.meal.localDay }).from(schema.meal).where(and(eq(schema.meal.userId, userId), eq(schema.meal.origin, "local")));
  console.log(JSON.stringify({ userId, localMeals: local.length, mealSync: (await googleStatus(db, userId)).mealSync }));
  if (process.argv.includes("--adopt-existing")) {
    const { grant } = await getFreshGrant(db, userId);
    const jobs = await db.select().from(schema.googleMealSync).where(and(eq(schema.googleMealSync.userId, userId), eq(schema.googleMealSync.connectionId, connectionId)));
    let adopted = 0;
    for (const job of jobs) {
      if (job.action !== "upsert" || !job.payload) continue;
      const reserved = jobs.filter((other) => other.mealId !== job.mealId && other.remoteName).map((other) => other.remoteName!);
      const matches = await findGoogleMealRecords(job.payload as GoogleMealSnapshot, grant.accessToken, reserved, true);
      if (matches.length !== 1) throw new Error("Existing Google records are ambiguous; no deletion attempted.");
      const remoteName = matches[0];
      await db.transaction(async (tx) => {
        await tx.update(schema.googleMealSync).set({ remoteName, pendingNames: [], pendingPayloads: {}, leasedUntil: null }).where(and(eq(schema.googleMealSync.userId, userId), eq(schema.googleMealSync.mealId, job.mealId), eq(schema.googleMealSync.connectionId, connectionId), eq(schema.googleMealSync.version, job.version)));
        await tx.update(schema.meal).set({ googleDatapointName: remoteName }).where(and(eq(schema.meal.userId, userId), eq(schema.meal.id, job.mealId)));
      });
      job.remoteName = remoteName; adopted++;
    }
    console.log(JSON.stringify({ adoptedExistingProviderReferences: adopted, deletedRecords: 0 }));
  }
  if (process.argv.includes("--apply")) {
    const to = local.map((entry) => entry.day).sort().at(-1) ?? new Date().toISOString().slice(0, 10);
    let cursor: string | null = null, queued = 0;
    do {
      const result = await pushPendingToGoogle(db, userId, undefined, to, cursor ?? undefined);
      queued += result.mealsQueued; cursor = result.nextCursor;
    } while (cursor);
    const processed = await processGoogleMeals(db, userId, 10);
    console.log(JSON.stringify({ queued, processed, mealSync: (await googleStatus(db, userId)).mealSync }));
  }
  if (process.argv.includes("--verify")) {
    const { grant } = await getFreshGrant(db, userId);
    const rows = await db.select().from(schema.googleMealSync).where(and(eq(schema.googleMealSync.userId, userId), eq(schema.googleMealSync.connectionId, connectionId), eq(schema.googleMealSync.state, "synced")));
    let verified = 0;
    for (const row of rows) {
      if (!row.remoteName || !row.payload) throw new Error("A synced meal lacks its reference.");
      const response = await fetch(`https://health.googleapis.com/v4/${row.remoteName}`, { headers: { Authorization: `Bearer ${grant.accessToken}` }, signal: AbortSignal.timeout(8000), cache: "no-store" });
      if (!response.ok) throw new Error("Provider read-back failed.");
      verifyGoogleNutritionRecord(await response.json(), row.payload as GoogleMealSnapshot, row.targetName!);
      verified++;
    }
    console.log(JSON.stringify({ liveReadBackVerified: verified, duplicateLocalMealJobs: rows.length - new Set(rows.map((row) => row.mealId)).size }));
  }
}
main().catch(() => { console.error("Google meal maintenance failed; credentials and health details omitted. Check the account-specific sync status."); process.exitCode = 1; }).finally(() => pool.end());
