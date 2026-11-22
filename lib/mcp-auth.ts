import { randomUUID } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { createLocalJWKSet, jwtVerify } from "jose";
import type { AuthDatabase } from "./auth";
import { mcpResource, metadataURL } from "./mcp-config";
import { getAuth, getAuthConfig, getDatabase } from "./runtime";
import { mcpAudit, mcpRevocation, oauthClient, oauthConsent, session } from "./schema";

export async function mcpIdentity(request: Request) {
  const config = getAuthConfig();
  const token = /^Bearer\s+([^\s,]{1,8192})$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  const unauthorized = (invalid = false) =>
    Response.json(
      { error: "Authentication required." },
      {
        status: 401,
        headers: {
          "WWW-Authenticate": `Bearer resource_metadata="${metadataURL(config.baseURL)}", scope="fitness:read fitness:write offline_access"${invalid ? ', error="invalid_token"' : ""}`,
        },
      },
    );

  if (!token) return unauthorized();

  let payload;
  try {
    const jwksRes = await getAuth().handler(new Request(new URL("/api/auth/jwks", config.baseURL)));
    const keys = createLocalJWKSet(await jwksRes.json());
    ({ payload } = await jwtVerify(token, keys, {
      issuer: new URL(config.baseURL).origin,
      audience: mcpResource(config.baseURL),
      requiredClaims: ["exp", "iat", "sub"],
    }));
  } catch {
    return unauthorized(true);
  }

  const { sub, sid, azp, scope, iat } = payload;
  if (
    typeof sub !== "string" ||
    typeof sid !== "string" ||
    typeof azp !== "string" ||
    typeof scope !== "string" ||
    typeof iat !== "number" ||
    payload.cnf
  ) {
    return unauthorized(true);
  }

  const db = getDatabase();
  const [[consent], [active], [revocation]] = await Promise.all([
    db
      .select({ scopes: oauthConsent.scopes })
      .from(oauthConsent)
      .innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
      .where(
        and(
          eq(oauthConsent.userId, sub),
          eq(oauthConsent.clientId, azp),
          sql`coalesce(${oauthClient.disabled}, false) = false`,
        ),
      ),
    db
      .select({ id: session.id })
      .from(session)
      .where(and(eq(session.id, sid), eq(session.userId, sub), gt(session.expiresAt, new Date()))),
    db.select().from(mcpRevocation).where(eq(mcpRevocation.userId, sub)),
  ]);

  if (!consent || !active || (revocation && iat <= Math.floor(revocation.revokedAt.getTime() / 1000))) {
    return unauthorized(true);
  }

  return {
    userId: sub,
    scopes: scope.split(" ").filter((entry) => consent.scopes.includes(entry)),
  };
}

export async function auditTool(userId: string, tool: string, summary = "", db: AuthDatabase = getDatabase()) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"fitness-mcp:" + userId}))`);
    const [result] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(mcpAudit)
      .where(and(eq(mcpAudit.userId, userId), gt(mcpAudit.createdAt, new Date(Date.now() - 60000))));
    if (result.count >= 60) return false;
    await tx.insert(mcpAudit).values({
      id: randomUUID(),
      userId,
      tool,
      summary: summary.slice(0, 200),
    });
    return true;
  });
}
