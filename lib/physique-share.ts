import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { AuthDatabase } from "./auth";
import { physiqueShareProtectionInput, type PhysiqueShareProtection } from "./physique-protection";
import { physiqueCheckin, physiqueShare } from "./schema";

const shareToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const physiqueShareAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), checkinIds: z.array(z.uuid()).min(1).max(300), currentToken: shareToken.nullable(), protection: physiqueShareProtectionInput }),
  z.object({ action: z.literal("revoke"), currentToken: shareToken }),
]);

export interface PhysiqueShareLink {
  token: string;
  checkinIds: string[];
  protection?: PhysiqueShareProtection | null;
}

export function physiqueSharing(db: AuthDatabase, userId: string) {
  const owned = eq(physiqueShare.userId, userId);
  const fields = { token: physiqueShare.token, checkinIds: physiqueShare.checkinIds, protection: physiqueShare.protection };
  return {
    async get(): Promise<PhysiqueShareLink | null> {
      const [link] = await db.select(fields).from(physiqueShare).where(owned);
      return link ?? null;
    },
    async save(checkinIds: string[], currentToken: string | null, protection?: PhysiqueShareProtection) {
      const ids = [...new Set(checkinIds)];
      if (ids.length === 0 || ids.length > 300) return { status: "invalid_photos" } as const;
      const photos = await db.select({ id: physiqueCheckin.id, isProtected: sql<boolean>`${physiqueCheckin.protection} IS NOT NULL` }).from(physiqueCheckin)
        .where(and(eq(physiqueCheckin.userId, userId), inArray(physiqueCheckin.id, ids)));
      if (photos.length !== ids.length || photos.some((photo) => photo.isProtected !== Boolean(protection))
        || (protection && (Object.keys(protection.photos).length !== ids.length || ids.some((id) => !Object.hasOwn(protection.photos, id))))) {
        return { status: "invalid_photos" } as const;
      }

      const values = { token: randomBytes(32).toString("base64url"), checkinIds: ids, protection: protection ?? null };
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

export async function sharedPhysiqueProtection(db: AuthDatabase, token: string) {
  if (!shareToken.safeParse(token).success) return null;
  const [link] = await db.select({ protection: physiqueShare.protection }).from(physiqueShare).where(eq(physiqueShare.token, token));
  return link?.protection?.photos ?? null;
}

export async function sharedProtectedPhysiquePhoto(db: AuthDatabase, token: string, photoId: string) {
  if (!shareToken.safeParse(token).success || !z.uuid().safeParse(photoId).success) return null;
  const [row] = await db.select({
    image: sql<NonNullable<PhysiqueShareProtection["photos"][string]> | null>`${physiqueCheckin.protection} -> 'image'`,
  }).from(physiqueShare).innerJoin(physiqueCheckin, selectedPhoto)
    .where(and(eq(physiqueShare.token, token), eq(physiqueCheckin.id, photoId), sql`${physiqueShare.protection}->'photos' ? ${photoId}`));
  return row?.image ?? null;
}
