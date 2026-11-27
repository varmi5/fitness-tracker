import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { consumeOAuthState, createOAuthState, parseOAuthReturnTo } from "../lib/oauth-state";
import * as schema from "../lib/schema";

const pg = new PGlite();
const db = drizzle(pg, { schema });

before(async () => {
  const migrations = (await readdir("migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const m of migrations) {
    await pg.exec(await readFile(`migrations/${m}`, "utf8"));
  }
  await db.insert(schema.user).values([
    { id: "OA-1", name: "OA-1", email: "oa1@example.test", createdAt: new Date(), updatedAt: new Date() },
    { id: "OA-2", name: "OA-2", email: "oa2@example.test", createdAt: new Date(), updatedAt: new Date() },
  ]);
  process.env.FITNESS_INTEGRATION_KEY = randomBytes(32).toString("hex");
});

after(async () => {
  delete process.env.FITNESS_INTEGRATION_KEY;
  await pg.close();
});

test("parseOAuthReturnTo accepts only whitelisted onboarding destinations", () => {
  assert.equal(parseOAuthReturnTo("onboarding-1"), "onboarding-1");
  assert.equal(parseOAuthReturnTo("onboarding-3"), "onboarding-3");
  assert.equal(parseOAuthReturnTo("https://evil.test"), null);
  assert.equal(parseOAuthReturnTo("../admin"), null);
  assert.equal(parseOAuthReturnTo(null), null);
});

test("OAuth state succeeds without cookie via single-use DB verification row and blocks replay or cross-user access", async () => {
  const created = await createOAuthState(db, "hevy", "OA-1", { returnTo: "onboarding-3" });

  // Cross-user attempt with cookie fails without accepting
  const crossUserCookie = await consumeOAuthState(db, "hevy", "OA-2", created.state, created.sealed);
  assert.equal(crossUserCookie.ok, false);

  // Re-create for OA-1 and simulate missing cookie (e.g. iOS PWA -> Safari redirect)
  const fresh = await createOAuthState(db, "google", "OA-1", { returnTo: "onboarding-1", verifier: "pkce-v1" });
  const consumed = await consumeOAuthState(db, "google", "OA-1", fresh.state, null);
  assert.equal(consumed.ok, true);
  if (consumed.ok) {
    assert.equal(consumed.data.returnTo, "onboarding-1");
    assert.equal(consumed.data.verifier, "pkce-v1");
  }

  // Second consume (replay) without cookie fails as expired
  const replay = await consumeOAuthState(db, "google", "OA-1", fresh.state, null);
  assert.deepEqual(replay, { ok: false, reason: "expired" });
});

test("expired DB OAuth state fails when cookie is absent", async () => {
  const created = await createOAuthState(db, "hevy", "OA-1");
  await db
    .update(schema.verification)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(schema.verification.identifier, `oauth_state:hevy:${created.state}`));

  const res = await consumeOAuthState(db, "hevy", "OA-1", created.state, null);
  assert.deepEqual(res, { ok: false, reason: "expired" });
});
