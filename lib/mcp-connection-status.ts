import { and, arrayContains, eq, gt, isNull, sql } from "drizzle-orm";
import type { AuthDatabase } from "./auth";
import { mcpRevocation, oauthAccessToken, oauthClient, oauthConsent, oauthRefreshToken, session } from "./schema";
// Checks this user's current logging authorisation, not ChatGPT's live availability.
export async function mcpMealLoggingAuthorised(db: AuthDatabase, userId: string): Promise<boolean> {
  const now = new Date();
  const [revocation] = await db.select({ at: mcpRevocation.revokedAt }).from(mcpRevocation).where(eq(mcpRevocation.userId, userId));
  async function validGrant(token: typeof oauthRefreshToken | typeof oauthAccessToken) {
    return db.select({ id: token.id }).from(token)
      .innerJoin(oauthClient, eq(oauthClient.clientId, token.clientId))
      .innerJoin(oauthConsent, and(eq(oauthConsent.clientId, token.clientId), eq(oauthConsent.userId, userId)))
      .innerJoin(session, and(eq(session.id, token.sessionId), eq(session.userId, userId)))
      .where(and(eq(token.userId, userId), isNull(token.revoked), gt(token.expiresAt, now),
        gt(session.expiresAt, now), sql`coalesce(${oauthClient.disabled}, false) = false`,
        arrayContains(token.scopes, ["fitness:read", "fitness:write"]),
        arrayContains(oauthConsent.scopes, ["fitness:read", "fitness:write"]),
        revocation ? gt(token.createdAt, revocation.at) : undefined,
      )).limit(1);
  }
  const [refresh, access] = await Promise.all([validGrant(oauthRefreshToken), validGrant(oauthAccessToken)]);
  return refresh.length > 0 || access.length > 0;
}
