import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { AuthDatabase } from "./auth";
import { physiqueCheckin } from "./schema";

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

export const updatePhysiqueInput = z.object({
  day: z.iso.date().optional(),
  pose: z.enum(PHYSIQUE_POSES).optional(),
  cadence: z.enum(PHYSIQUE_CADENCES).optional(),
  weightKg: z.number().positive().max(400).nullable().optional(),
  note: z.string().trim().max(300).optional(),
});

export type UpdatePhysiqueInput = z.infer<typeof updatePhysiqueInput>;

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
        .limit(300);

      return rows.map(toRecord);
    },

    async create(raw: CreatePhysiqueInput): Promise<PhysiqueCheckinRecord> {
      const input = createPhysiqueInput.parse(raw);

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
          weightKg: input.weightKg ?? null,
          bodyFatPct: null,
          note: input.note,
        })
        .returning();

      return toRecord(inserted);
    },

    async update(id: string, raw: UpdatePhysiqueInput): Promise<PhysiqueCheckinRecord | null> {
      const input = updatePhysiqueInput.parse(raw);
      const patch: Partial<typeof physiqueCheckin.$inferInsert> = {};
      if (input.day !== undefined) patch.day = input.day;
      if (input.pose !== undefined) patch.pose = input.pose;
      if (input.cadence !== undefined) patch.cadence = input.cadence;
      if (input.weightKg !== undefined) patch.weightKg = input.weightKg;
      if (input.note !== undefined) patch.note = input.note;

      if (Object.keys(patch).length === 0) {
        const [existing] = await db
          .select()
          .from(physiqueCheckin)
          .where(and(eq(physiqueCheckin.id, id), eq(physiqueCheckin.userId, userId)))
          .limit(1);
        return existing ? toRecord(existing) : null;
      }

      const [updated] = await db
        .update(physiqueCheckin)
        .set(patch)
        .where(and(eq(physiqueCheckin.id, id), eq(physiqueCheckin.userId, userId)))
        .returning();

      return updated ? toRecord(updated) : null;
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
