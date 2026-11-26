import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { AuthDatabase } from "./auth";
import { physiqueCheckin, physiqueShare } from "./schema";

const shareToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const physiqueShareAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), checkinIds: z.array(z.uuid()).min(1).max(300), currentToken: shareToken.nullable() }),
  z.object({ action: z.literal("revoke"), currentToken: shareToken }),
]);

export interface PhysiqueShareLink {
  token: string;
  checkinIds: string[];
}

export function physiqueSharing(db: AuthDatabase, userId: string) {
  const owned = eq(physiqueShare.userId, userId);
  const fields = { token: physiqueShare.token, checkinIds: physiqueShare.checkinIds };
  return {
    async get(): Promise<PhysiqueShareLink | null> {
      const [link] = await db.select(fields).from(physiqueShare).where(owned);
      return link ?? null;
    },
    async save(checkinIds: string[], currentToken: string | null) {
      const ids = [...new Set(checkinIds)];
      if (ids.length === 0 || ids.length > 300) return { status: "invalid_photos" } as const;
      const photos = await db.select({ id: physiqueCheckin.id }).from(physiqueCheckin)
        .where(and(eq(physiqueCheckin.userId, userId), inArray(physiqueCheckin.id, ids)));
      if (photos.length !== ids.length) return { status: "invalid_photos" } as const;

      const values = { token: randomBytes(32).toString("base64url"), checkinIds: ids };
      const [link] = currentToken == null
        ? await db.insert(physiqueShare).values({ userId, ...values }).onConflictDoNothing({ target: physiqueShare.userId }).returning(fields)
        : await db.update(physiqueShare).set(values).where(and(owned, eq(physiqueShare.token, currentToken))).returning(fields);
      return link ? { status: "saved", link } as const : { status: "conflict" } as const;
    },
    async revoke(currentToken: string) {
      const [removed] = await db.delete(physiqueShare).where(and(owned, eq(physiqueShare.token, currentToken))).returning({ token: physiqueShare.token });
      return Boolean(removed);
    },
  };
}

const selectedPhoto = and(
  eq(physiqueShare.userId, physiqueCheckin.userId),
  sql`${physiqueCheckin.id} = any(${physiqueShare.checkinIds})`,
);

export async function sharedPhysiquePhotos(db: AuthDatabase, token: string) {
  if (!shareToken.safeParse(token).success) return [];
  return db.select({ id: physiqueCheckin.id, day: physiqueCheckin.day, pose: physiqueCheckin.pose })
    .from(physiqueShare).innerJoin(physiqueCheckin, selectedPhoto)
    .where(eq(physiqueShare.token, token)).orderBy(asc(physiqueCheckin.day), asc(physiqueCheckin.createdAt));
}

export async function sharedPhysiquePhoto(db: AuthDatabase, token: string, photoId: string) {
  if (!shareToken.safeParse(token).success || !z.uuid().safeParse(photoId).success) return null;
  const [photo] = await db.select({ photoData: physiqueCheckin.photoData })
    .from(physiqueShare).innerJoin(physiqueCheckin, selectedPhoto)
    .where(and(eq(physiqueShare.token, token), eq(physiqueCheckin.id, photoId)));
  return photo?.photoData ?? null;
}
