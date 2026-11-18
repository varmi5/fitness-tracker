import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import webpush from "web-push";
import { z } from "zod";
import type { AuthDatabase } from "./auth";
import { seal, unseal } from "./google-health";
import { localDay, localTime } from "./nutrition-model";
import { nutritionPreference, pushSubscription, reminderDelivery, reminderPreference } from "./schema";

export const reminderInput = z.object({ enabled: z.boolean(), times: z.array(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)).min(1).max(4).refine((times) => new Set(times).size === times.length, "Choose distinct reminder times.") });
export const subscriptionInput = z.object({ endpoint: z.url().max(2000).refine((raw) => {
  const url = new URL(raw);
  return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") &&
    (url.hostname === "fcm.googleapis.com" || url.hostname === "updates.push.services.mozilla.com" || url.hostname.endsWith(".push.apple.com"));
}, "This browser push provider is not supported."), keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}=?$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}={0,2}$/) }) });
function encryptionKey() { return createHash("sha256").update(`fitnesstrackr-push:${process.env.BETTER_AUTH_SECRET ?? ""}`).digest("hex"); }
export const pushConfigured = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.BETTER_AUTH_SECRET);
export async function reminderSettings(db: AuthDatabase, userId: string) {
  const [[pref], [tz], devices] = await Promise.all([
    db.select().from(reminderPreference).where(eq(reminderPreference.userId, userId)),
    db.select({ timezone: nutritionPreference.timezone }).from(nutritionPreference).where(eq(nutritionPreference.userId, userId)),
    db.select({ id: pushSubscription.id }).from(pushSubscription).where(eq(pushSubscription.userId, userId)),
  ]);
  return { enabled: pref?.enabled ?? false, times: (pref?.times ?? ["18:30"]) as string[], timezone: tz?.timezone ?? "Europe/London", deviceCount: devices.length,
    available: pushConfigured(), publicKey: process.env.VAPID_PUBLIC_KEY ?? null };
}
export async function saveReminderSettings(db: AuthDatabase, userId: string, raw: z.input<typeof reminderInput>) {
  const input = reminderInput.parse(raw);
  await db.insert(reminderPreference).values({ userId, ...input }).onConflictDoUpdate({ target: reminderPreference.userId, set: { ...input, updatedAt: new Date() } });
  return reminderSettings(db, userId);
}
export async function registerPush(db: AuthDatabase, userId: string, raw: unknown) {
  if (!pushConfigured()) throw new Error("Phone notifications are not configured yet.");
  const subscription = subscriptionInput.parse(raw);
  const endpointHash = createHash("sha256").update(subscription.endpoint).digest("hex");
  // A device can belong to only one signed-in account. Switching accounts atomically reassigns it.
  await db.insert(pushSubscription).values({ id: randomUUID(), userId, endpointHash, credential: seal(subscription, userId, encryptionKey()) })
    .onConflictDoUpdate({ target: pushSubscription.endpointHash, set: { userId, credential: seal(subscription, userId, encryptionKey()) } });
  return reminderSettings(db, userId);
}
export async function unregisterPush(db: AuthDatabase, userId: string, endpoint: string) {
  await db.delete(pushSubscription).where(and(eq(pushSubscription.userId, userId), eq(pushSubscription.endpointHash, createHash("sha256").update(endpoint).digest("hex"))));
}
export function dueTimes(times: string[], now: Date, timezone: string) {
  const current = localTime(now, timezone); const minutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
  return times.filter((time) => minutes(current) >= minutes(time) && minutes(current) - minutes(time) <= 90);
}
export async function processReminders(db: AuthDatabase, now = new Date(), send = webpush.sendNotification) {
  if (!pushConfigured()) return { sent: 0 };
  const preferences = await db.select({ userId: reminderPreference.userId, times: reminderPreference.times, timezone: nutritionPreference.timezone })
    .from(reminderPreference).leftJoin(nutritionPreference, eq(nutritionPreference.userId, reminderPreference.userId)).where(eq(reminderPreference.enabled, true));
  let sent = 0;
  for (const pref of preferences) {
    const timezone = pref.timezone ?? "Europe/London"; const day = localDay(now, timezone);
    const devices = await db.select().from(pushSubscription).where(eq(pushSubscription.userId, pref.userId));
    for (const time of dueTimes(pref.times as string[], now, timezone)) for (const device of devices) {
      await db.insert(reminderDelivery).values({ userId: pref.userId, day, time, subscriptionId: device.id, nextAttemptAt: now }).onConflictDoNothing();
      const own = and(eq(reminderDelivery.userId, pref.userId), eq(reminderDelivery.day, day), eq(reminderDelivery.time, time), eq(reminderDelivery.subscriptionId, device.id));
      const [claimed] = await db.update(reminderDelivery).set({ leasedUntil: new Date(now.getTime() + 60000) }).where(and(own,
        eq(reminderDelivery.state, "pending"), lte(reminderDelivery.nextAttemptAt, now), or(isNull(reminderDelivery.leasedUntil), lte(reminderDelivery.leasedUntil, now)),
      )).returning();
      if (!claimed) continue;
      // Recheck device ownership and preference after claiming, avoiding cross-account delivery after reassignment.
      const [current] = await db.select().from(pushSubscription).where(and(eq(pushSubscription.id, device.id), eq(pushSubscription.userId, pref.userId)));
      const [enabled] = await db.select().from(reminderPreference).where(eq(reminderPreference.userId, pref.userId));
      if (!current || !enabled?.enabled) continue;
      try {
        const subscription = subscriptionInput.parse(unseal(current.credential, pref.userId, encryptionKey()));
        await send(subscription, JSON.stringify({ title: "FitnessTrackr", body: "Ready to log a meal? Open your diary when you have a moment.", url: "/?tab=Nutrition", tag: `meal-reminder-${day}-${time}` }), {
          vapidDetails: { subject: process.env.VAPID_SUBJECT ?? "mailto:support@fitnesstrackr.co.uk", publicKey: process.env.VAPID_PUBLIC_KEY!, privateKey: process.env.VAPID_PRIVATE_KEY! }, TTL: 3600, timeout: 8000, urgency: "normal",
        });
        await db.update(reminderDelivery).set({ state: "sent", leasedUntil: null }).where(own); sent++;
      } catch (error) {
        const status = (error as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) await db.delete(pushSubscription).where(and(eq(pushSubscription.id, current.id), eq(pushSubscription.userId, pref.userId)));
        else await db.update(reminderDelivery).set({ leasedUntil: null, attempts: sql`${reminderDelivery.attempts} + 1`, nextAttemptAt: new Date(now.getTime() + 300000) }).where(own);
      }
    }
  }
  return { sent };
}
