import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { createAuth, type AuthConfig } from "../lib/auth";
import { getSetupStatus, signUpOwner } from "../lib/owner-setup";
import * as schema from "../lib/schema";

const pg = new PGlite();
const db = drizzle(pg, { schema });
const config: AuthConfig = {
  baseURL: "http://localhost:3000",
  secret: randomBytes(32).toString("hex"),
  setupCode: randomBytes(24).toString("hex"),
  mode: "closed",
};

function request(code?: string, email = "owner@example.test", origin = config.baseURL) {
  const headers = new Headers({ origin, "Content-Type": "application/json" });
  if (code !== undefined) headers.set("X-Setup-Code", code);
  return new Request(`${config.baseURL}/api/auth/sign-up/email`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Owner", email, password: randomBytes(24).toString("hex"), role: "member" }),
  });
}

before(async () => pg.exec(await readFile("migrations/001-auth.sql", "utf8")));
beforeEach(async () => {
  await pg.exec('TRUNCATE "user", owner_setup CASCADE; INSERT INTO owner_setup (id) VALUES (1);');
});
after(async () => pg.close());

test("missing, short, and padded or repeated placeholder codes fail closed", async () => {
  for (const setupCode of [undefined, "", "changeme", "short", "PLACEHOLDER-12345678901234567890", "change-me-change-me-change-me"]) {
    const unconfigured = { ...config, setupCode };
    assert.equal(await getSetupStatus(db, unconfigured), "unconfigured");
    const response = await signUpOwner(request(config.setupCode), db, unconfigured);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { message: "Setup is not configured." });
  }
});

test("cross-origin requests and direct Better Auth signup cannot create the owner", async () => {
  const crossOrigin = await signUpOwner(request(config.setupCode, undefined, "http://example.test"), db, config);
  assert.equal(crossOrigin.status, 403);
  assert.equal((await createAuth(db, config).handler(request(config.setupCode))).status, 400);
  assert.equal((await db.select().from(schema.user)).length, 0);
});

test("rate limit applies globally to valid, invalid, and missing codes after five failed attempts", async () => {
  for (const code of [undefined, "wrong", "wrong", "wrong", "wrong"]) {
    assert.equal((await signUpOwner(request(code), db, config)).status, 403);
  }
  const limited = await signUpOwner(request(config.setupCode), db, config);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  await db.update(schema.ownerSetup).set({ windowStartedAt: new Date(0) });
  assert.equal((await signUpOwner(request(config.setupCode), db, config)).status, 200);
});

test("concurrent requests create one owner and the code stays retired after owner deletion", async () => {
  assert.equal(await getSetupStatus(db, config), "available");
  const responses = await Promise.all([
    signUpOwner(request(config.setupCode, "a@example.test"), db, config),
    signUpOwner(request(config.setupCode, "b@example.test"), db, config),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 403]);
  const users = await db.select().from(schema.user);
  assert.equal(users.length, 1);
  assert.equal(users[0].role, "owner");
  assert.equal((await db.select().from(schema.account)).length, 1);
  assert.equal((await db.select().from(schema.session)).length, 1);
  assert.equal(await getSetupStatus(db, config), "closed");
  await db.delete(schema.user);
  assert.equal(await getSetupStatus(db, config), "closed");
  assert.equal((await signUpOwner(request(config.setupCode), db, config)).status, 403);
});

test("an existing user closes setup even if the marker has not been consumed", async () => {
  await db.insert(schema.user).values({
    id: "existing", name: "Existing", email: "existing@example.test", createdAt: new Date(), updatedAt: new Date(),
  });
  assert.equal(await getSetupStatus(db, config), "closed");
  assert.equal((await signUpOwner(request(config.setupCode), db, config)).status, 403);
  assert.equal((await db.select().from(schema.user)).length, 1);
});

test("the owner access migration preserves only the established owner's access", async () => {
  const now = new Date();
  await db.insert(schema.user).values([
    { id: "owner", role: "owner", name: "Owner", email: "owner@example.test", createdAt: now, updatedAt: now },
    { id: "member", role: "member", name: "Member", email: "member@example.test", createdAt: now, updatedAt: now },
  ]);
  const migration = await readFile("migrations/003-preserve-owner-access.sql", "utf8");
  const verification = () => pg.query<{ role: string; email_verified: boolean }>(
    'SELECT role, email_verified FROM "user" ORDER BY role',
  );
  await pg.exec(migration);
  assert.ok((await verification()).rows.every((row) => !row.email_verified));
  await db.update(schema.ownerSetup).set({ consumed: true });
  await pg.exec(migration);
  assert.deepEqual((await verification()).rows, [
    { role: "member", email_verified: false },
    { role: "owner", email_verified: true },
  ]);
});
