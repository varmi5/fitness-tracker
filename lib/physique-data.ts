import { and, desc, eq, isNotNull, lte } from "drizzle-orm";
import { z } from "zod";
import type { AuthDatabase } from "./auth";
import { dailyEnergy, dailyRecovery, measurement, physiqueCheckin } from "./schema";

export const PHYSIQUE_POSES = ["front", "side", "back"] as const;
export type PhysiquePose = (typeof PHYSIQUE_POSES)[number];

export const PHYSIQUE_CADENCES = ["weekly", "daily"] as const;
export type PhysiqueCadence = (typeof PHYSIQUE_CADENCES)[number];

export const createPhysiqueInput = z.object({
  day: z.iso.date(),
  pose: z.enum(PHYSIQUE_POSES).default("front"),
  cadence: z.enum(PHYSIQUE_CADENCES).default("weekly"),
  photoData: z
    .string()
    .min(32)
    .max(900_000)
    .regex(/^data:image\/(jpeg|jpg|png|webp);base64,/i, "Photo must be a valid JPEG, PNG, or WebP data URL."),
  weightKg: z.number().positive().max(400).nullable().optional(),
  bodyFatPct: z.number().min(2).max(75).nullable().optional(),
  note: z.string().trim().max(300).optional().default(""),
});

export type CreatePhysiqueInput = z.infer<typeof createPhysiqueInput>;

export interface PhysiqueCheckinRecord {
  id: string;
  day: string;
  pose: PhysiquePose;
  cadence: PhysiqueCadence;
  photoData: string;
  weightKg: number | null;
  bodyFatPct: number | null;
  note: string;
  createdAt: string;
}

function toRecord(row: typeof physiqueCheckin.$inferSelect): PhysiqueCheckinRecord {
  return {
    id: row.id,
    day: row.day,
    pose: (PHYSIQUE_POSES.includes(row.pose as PhysiquePose) ? row.pose : "front") as PhysiquePose,
    cadence: (PHYSIQUE_CADENCES.includes(row.cadence as PhysiqueCadence) ? row.cadence : "weekly") as PhysiqueCadence,
    photoData: row.photoData,
    weightKg: row.weightKg ?? null,
    bodyFatPct: row.bodyFatPct ?? null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

export function physiqueData(db: AuthDatabase, userId: string) {
  return {
    async list(pose?: PhysiquePose): Promise<PhysiqueCheckinRecord[]> {
      const condition = pose
        ? and(eq(physiqueCheckin.userId, userId), eq(physiqueCheckin.pose, pose))
        : eq(physiqueCheckin.userId, userId);

      const rows = await db
        .select()
        .from(physiqueCheckin)
        .where(condition)
        .orderBy(desc(physiqueCheckin.day), desc(physiqueCheckin.createdAt))
        .limit(120);

      return rows.map(toRecord);
    },

    async create(raw: CreatePhysiqueInput): Promise<PhysiqueCheckinRecord> {
      const input = createPhysiqueInput.parse(raw);

      let resolvedWeight = input.weightKg ?? null;
      if (resolvedWeight == null) {
        const [latestMeasureWeight, latestEnergyWeight] = await Promise.all([
          db
            .select({ value: measurement.value, date: measurement.date })
            .from(measurement)
            .where(and(eq(measurement.userId, userId), eq(measurement.metric, "weight"), lte(measurement.date, input.day)))
            .orderBy(desc(measurement.date))
            .limit(1),
          db
            .select({ weightKg: dailyEnergy.weightKg, day: dailyEnergy.day })
            .from(dailyEnergy)
            .where(and(eq(dailyEnergy.userId, userId), isNotNull(dailyEnergy.weightKg), lte(dailyEnergy.day, input.day)))
            .orderBy(desc(dailyEnergy.day))
            .limit(1),
        ]);
        const mRow = latestMeasureWeight[0];
        const eRow = latestEnergyWeight[0];
        if (mRow && (!eRow || mRow.date >= eRow.day)) {
          resolvedWeight = mRow.value;
        } else if (eRow?.weightKg != null) {
          resolvedWeight = eRow.weightKg;
        }
      }

      let resolvedBodyFat = input.bodyFatPct ?? null;
      if (resolvedBodyFat == null) {
        const latestRec = await db
          .select({ bodyFatPct: dailyRecovery.bodyFatPct })
          .from(dailyRecovery)
          .where(and(eq(dailyRecovery.userId, userId), isNotNull(dailyRecovery.bodyFatPct), lte(dailyRecovery.day, input.day)))
          .orderBy(desc(dailyRecovery.day))
          .limit(1);
        resolvedBodyFat = latestRec[0]?.bodyFatPct ?? null;
      }

      const id = crypto.randomUUID();
      const [inserted] = await db
        .insert(physiqueCheckin)
        .values({
          id,
          userId,
          day: input.day,
          pose: input.pose,
          cadence: input.cadence,
          photoData: input.photoData,
          weightKg: resolvedWeight,
          bodyFatPct: resolvedBodyFat,
          note: input.note,
        })
        .returning();

      return toRecord(inserted);
    },

    async remove(id: string): Promise<{ deleted: boolean }> {
      const deleted = await db
        .delete(physiqueCheckin)
        .where(and(eq(physiqueCheckin.id, id), eq(physiqueCheckin.userId, userId)))
        .returning({ id: physiqueCheckin.id });
      return { deleted: deleted.length > 0 };
    },
  };
}
