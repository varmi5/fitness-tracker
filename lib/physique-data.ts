import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { AuthDatabase } from "./auth";
import { physiqueCheckin, physiqueShare, physiqueVault } from "./schema";
import { physiqueProtectionInput, type PhysiqueProtection, type PhysiqueVault } from "./physique-protection";

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

export const protectedCheckinInput = createPhysiqueInput.omit({ photoData: true, note: true, weightKg: true, bodyFatPct: true })
  .extend({ protection: physiqueProtectionInput });
export const protectedCheckinUpdate = updatePhysiqueInput.omit({ note: true, weightKg: true })
  .extend({ details: physiqueProtectionInput.shape.details });

export interface PhysiqueCheckinRecord {
  id: string;
  day: string;
  pose: PhysiquePose;
  cadence: PhysiqueCadence;
  photoData: string;
  protection?: PhysiqueProtection | null;
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
    protection: row.protection,
    weightKg: row.weightKg ?? null,
    bodyFatPct: row.bodyFatPct ?? null,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

export function physiqueData(db: AuthDatabase, userId: string) {
  return {
    async getVault() {
      const [row] = await db.select({ vault: physiqueVault.vault }).from(physiqueVault).where(eq(physiqueVault.userId, userId));
      return row?.vault ?? null;
    },
    async setupVault(vault: PhysiqueVault) {
      const [row] = await db.insert(physiqueVault).values({ userId, vault })
        .onConflictDoNothing({ target: physiqueVault.userId }).returning({ vault: physiqueVault.vault });
      if (row) return row.vault;
      const [existing] = await db.select({ vault: physiqueVault.vault }).from(physiqueVault).where(eq(physiqueVault.userId, userId));
      return existing.vault;
    },
    async createProtected(raw: z.infer<typeof protectedCheckinInput>) {
      const input = protectedCheckinInput.parse(raw);
      const [saved] = await db.insert(physiqueCheckin).values({ ...input, id: crypto.randomUUID(), userId, photoData: "" }).returning();
      return toRecord(saved);
    },
    async migrate(id: string, protection: PhysiqueProtection) {
      return db.transaction(async (tx) => {
        const own = and(eq(physiqueCheckin.id, id), eq(physiqueCheckin.userId, userId));
        const [saved] = await tx.update(physiqueCheckin)
          .set({ protection, photoData: "", note: "", weightKg: null, bodyFatPct: null })
          .where(and(own, isNull(physiqueCheckin.protection))).returning();
        if (saved) {
          await tx.delete(physiqueShare).where(and(eq(physiqueShare.userId, userId), isNull(physiqueShare.protection), sql`${id} = any(${physiqueShare.checkinIds})`));
          return toRecord(saved);
        }
        const [existing] = await tx.select().from(physiqueCheckin).where(own);
        return existing ? toRecord(existing) : null;
      });
    },
    async updateProtected(id: string, input: z.infer<typeof protectedCheckinUpdate>) {
      const { details, ...metadata } = input;
      const [saved] = await db.update(physiqueCheckin)
        .set({ ...metadata, protection: sql`jsonb_set(${physiqueCheckin.protection}, '{details}', ${JSON.stringify(details)}::jsonb)` })
        .where(and(eq(physiqueCheckin.id, id), eq(physiqueCheckin.userId, userId), sql`${physiqueCheckin.protection} IS NOT NULL`))
        .returning();
      return saved ? toRecord(saved) : null;
    },
    async hasUnprotected() {
      const [found] = await db.select({ id: physiqueCheckin.id }).from(physiqueCheckin)
        .where(and(eq(physiqueCheckin.userId, userId), isNull(physiqueCheckin.protection))).limit(1);
      return Boolean(found);
    },
    async list(pose?: PhysiquePose, legacy = false): Promise<PhysiqueCheckinRecord[]> {
      const condition = pose
        ? and(eq(physiqueCheckin.userId, userId), eq(physiqueCheckin.pose, pose))
        : eq(physiqueCheckin.userId, userId);

      const rows = await db
        .select()
        .from(physiqueCheckin)
        .where(legacy ? and(condition, isNull(physiqueCheckin.protection)) : condition)
        .orderBy(desc(physiqueCheckin.day), desc(physiqueCheckin.createdAt))
        .limit(legacy ? 12 : 300);

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
