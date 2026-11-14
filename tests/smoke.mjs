import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp } from "node:fs/promises";
import { once } from "node:events";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const db = await PGlite.create();
const database = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0, maxConnections: 4 });
await database.start();
const origin = "http://localhost:3088";
const code = randomBytes(24).toString("hex");
const password = randomBytes(24).toString("hex");
const email = "owner@example.test";
const env = {
  ...process.env, HOSTNAME: "127.0.0.1", PORT: "3088", SIGNUP_MODE: "closed",
  BETTER_AUTH_URL: origin, SETUP_CODE: code,
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
  DATABASE_URL: `postgresql://postgres:postgres@${database.getServerConn()}/postgres`,
};

const run = (script) => spawn(process.execPath, [script], { env, stdio: ["ignore", "inherit", "inherit"] });
let app;
try {
  for (let count = 0; count < 2; count++) {
    const [exitCode] = await once(run("scripts/migrate.mjs"), "exit");
    assert.equal(exitCode, 0, "Migrations must apply and rerun cleanly");
  }
  await cp("public", ".next/standalone/public", { recursive: true });
  await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
  app = run(".next/standalone/server.js");
  const url = (path) => "http://127.0.0.1:3088" + path;
  let page;
  for (let attempt = 0; attempt < 40; attempt++) {
    page = await fetch(url("/setup")).catch(() => null);
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(page?.status, 200);
  assert.match(await page.text(), /Create owner account/);
  assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  const post = (path, data, headers = {}) => fetch(url(path), {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, ...headers },
    body: JSON.stringify(data),
  });
  const owner = await post("/api/auth/sign-up/email", { name: "Owner", email, password }, { "X-Setup-Code": code });
  assert.equal(owner.status, 200);
  const cookie = owner.headers.getSetCookie().map((header) => header.split(";")[0]).join("; ");
  assert.ok(cookie);
  const loggedIn = await fetch(url("/"), { headers: { Cookie: cookie } });
  assert.equal(loggedIn.status, 200);
  const dashboard = await loggedIn.text();
  assert.match(dashboard, /Waist-to-height/);
  assert.doesNotMatch(dashboard, /class="masthead"/);
  const result = await post("/api/tracker", {
    action: "log", data: { date: "2026-11-01", values: [{ key: "waist", value: 80 }], note: "Test" },
  }, { Cookie: cookie });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).readings[0].value, 80);
  assert.equal((await fetch(url("/api/tracker"))).status, 401);
  const passkeys = await fetch(url("/api/auth/passkey/list-user-passkeys"), { headers: { Cookie: cookie } });
  assert.equal(passkeys.status, 200);
  assert.deepEqual(await passkeys.json(), []);
  assert.equal((await post("/api/auth/sign-in/email", { email, password })).status, 200);
  assert.equal((await post("/api/auth/sign-up/email", { name: "Other", email: "other@example.test", password }, { "X-Setup-Code": code })).status, 403);
  assert.equal((await fetch(url("/sw.js"))).status, 200);
  assert.equal((await fetch(url("/manifest.webmanifest"))).status, 200);
  console.log("Migrations, owner creation, login, tracker API, passkey listing, CSP and PWA endpoints passed.");
} finally {
  if (app && app.exitCode == null) { app.kill(); await once(app, "exit"); }
  await database.stop();
  await db.close();
}
