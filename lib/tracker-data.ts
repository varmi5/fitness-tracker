import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { AuthDatabase } from "./auth";
import { measurement, profile, user } from "./schema";
import { metrics, type Units } from "./metrics";
import { z } from "zod";

export const logInput = z.object({
  date: z.iso.date(),
  note: z.string().max(1000).optional(),
  values: z.array(z.object({
    key: z.enum(metrics.map((m) => m.key)),
    value: z.number().positive().max(1000),
  })).min(1).max(metrics.length).refine((values) => new Set(values.map((v) => v.key)).size === values.length),
});

export const profileInput = z.object({
  heightCm: z.number().positive().max(300).nullable(),
  units: z.enum(["metric", "imperial"]),
  goals: z.string().max(2000),
});

export function trackerData(db: AuthDatabase, userId: string) {
  if (!userId) throw new Error("A session user ID is required.");
  return {
    async snapshot() {
      const [rows, settings] = await Promise.all([
        db.select({
          id: measurement.id, metric: measurement.metric, side: measurement.side,
          date: measurement.date, value: measurement.value, note: measurement.note,
        }).from(measurement).where(eq(measurement.userId, userId)).orderBy(desc(measurement.date)),
        db.select({ heightCm: profile.heightCm, units: profile.units, goals: profile.goals })
          .from(profile).where(eq(profile.userId, userId)),
      ]);
      const settingsRow = settings[0];
      return {
        readings: rows,
        settings: { heightCm: settingsRow?.heightCm ?? null, goals: settingsRow?.goals ?? "",
          units: (settingsRow?.units ?? "metric") as Units },
      };
    },
    async saveLog(input: z.infer<typeof logInput>) {
      await db.transaction(async (tx) => {
        for (const entry of input.values) {
          const metric = metrics.find((item) => item.key === entry.key)!;
          await tx.insert(measurement).values({
            id: randomUUID(), userId, metric: metric.metric, side: metric.side,
            date: input.date, value: entry.value, note: input.note ?? "",
          }).onConflictDoUpdate({
            target: [measurement.userId, measurement.metric, measurement.side, measurement.date],
            set: { value: entry.value, ...(input.note === undefined ? {} : { note: input.note }) },
          });
        }
      });
    },
    async deleteReading(id: string) {
      const rows = await db.delete(measurement)
        .where(and(eq(measurement.userId, userId), eq(measurement.id, id))).returning({ id: measurement.id });
      return rows.length > 0;
    },
    async saveSettings(input: z.infer<typeof profileInput>) {
      await db.insert(profile).values({ userId, ...input }).onConflictDoUpdate({
        target: profile.userId, set: input,
      });
    },
    async deleteAccount() {
      await db.delete(user).where(eq(user.id, userId));
    },
  };
}
