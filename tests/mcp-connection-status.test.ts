import assert from "node:assert/strict";
import { test } from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../lib/schema";
import type { AuthDatabase } from "../lib/auth";
import { mcpMealLoggingAuthorised } from "../lib/mcp-connection-status";
test("logging indicator requires this user's live, scoped, consented grant and respects revocation", async () => {
  const pg = new PGlite();
  try {
    for (const m of (await readdir("migrations")).filter(x => x.endsWith(".sql")).sort()) await pg.exec(await readFile(`migrations/${m}`, "utf8"));
    const db = drizzle(pg, { schema }), authDb = db as unknown as AuthDatabase;
    const now = new Date(), expires = new Date(Date.now() + 3600000);
    for (const id of ["a", "b"]) await db.insert(schema.user).values({ id, name: id, email: `${id}@example.test`, createdAt: now, updatedAt: now });
    await db.insert(schema.session).values({ id: "s", token: "synthetic", userId: "a", expiresAt: expires, createdAt: now, updatedAt: now });
    await db.insert(schema.oauthClient).values({ id: "c", clientId: "c", redirectUris: ["https://example.test/cb"] });
    await db.insert(schema.oauthConsent).values({ id: "c", userId: "a", clientId: "c", scopes: ["fitness:read", "fitness:write"], createdAt: now, updatedAt: now });
    await db.insert(schema.oauthRefreshToken).values({ id: "r", token: "synthetic-refresh", userId: "a", clientId: "c", sessionId: "s", expiresAt: expires, createdAt: now, scopes: ["fitness:read"] });
    assert.equal(await mcpMealLoggingAuthorised(authDb, "a"), false);
    await db.update(schema.oauthRefreshToken).set({ scopes: ["fitness:read", "fitness:write"] });
    assert.equal(await mcpMealLoggingAuthorised(authDb, "a"), true);
    assert.equal(await mcpMealLoggingAuthorised(authDb, "b"), false);
    await db.update(schema.oauthClient).set({ disabled: true });
    assert.equal(await mcpMealLoggingAuthorised(authDb, "a"), false);
    await db.update(schema.oauthClient).set({ disabled: false });
    await db.insert(schema.mcpRevocation).values({ userId: "a", revokedAt: new Date(now.getTime() + 1) });
    assert.equal(await mcpMealLoggingAuthorised(authDb, "a"), false);
    await db.delete(schema.mcpRevocation).where(eq(schema.mcpRevocation.userId, "a"));
    await db.update(schema.session).set({ expiresAt: new Date(0) });
    assert.equal(await mcpMealLoggingAuthorised(authDb, "a"), false);
  } finally { await pg.close(); }
});
