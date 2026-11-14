import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const scratch = await mkdtemp(join(tmpdir(), "fitness-signup-"));
const verificationFile = join(scratch, "email.json");
let app;

const url = (path) => "http://127.0.0.1:3088" + path;
async function waitForSetup() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const response = await fetch(url("/setup")).catch(() => null);
    if (response) return response;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Fitness did not start.");
}

async function stopApp() {
  if (app?.exitCode === null && app.signalCode === null) {
    const exited = once(app, "exit");
    app.kill();
    await exited;
  }
}

try {
  for (let count = 0; count < 2; count++) {
    const [exitCode] = await once(run("scripts/migrate.mjs"), "exit");
    assert.equal(exitCode, 0, "Migrations must apply and rerun cleanly");
  }
  await cp("public", ".next/standalone/public", { recursive: true });
  await cp(".next/static", ".next/standalone/.next/static", { recursive: true });
  app = run(".next/standalone/server.js");
  const page = await waitForSetup();
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
  await stopApp();

  // The production server uses its normal HTTP handlers, with only external
  // provider responses replaced in this isolated test process.
  app = spawn(process.execPath, [
    "--import", "./tests/mock-signup-providers.mjs", ".next/standalone/server.js",
  ], { stdio: ["ignore", "inherit", "inherit"], env: {
    ...env, SIGNUP_MODE: "open", RESEND_API_KEY: "local-test", EMAIL_FROM: "fitness@example.test",
    TURNSTILE_SECRET_KEY: "local-test", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "local-test",
    FITNESS_TEST_EMAIL: verificationFile, INVITE_CODE: "",
  } });
  const signupPage = await waitForSetup();
  assert.equal(signupPage.status, 200);
  const signupHtml = await signupPage.text();
  assert.match(signupHtml, /Create your Fitness account/);
  assert.doesNotMatch(signupHtml, /name="invite"/);
  assert.match(signupPage.headers.get("content-security-policy"), /challenges\.cloudflare\.com/);
  assert.equal((await post("/api/auth/sign-in/email", { email, password })).status, 200);

  const member = { name: "Member", email: "member@example.test", password };
  const register = (token, details = member) => post("/api/auth/sign-up/email", details,
    token ? { "X-Turnstile-Response": token } : {});
  for (const token of [undefined, "wrong-action", "wrong-host"]) {
    assert.equal((await register(token)).status, 403);
  }
  await assert.rejects(readFile(verificationFile), { code: "ENOENT" });

  const signup = await register("valid-challenge");
  assert.equal(signup.status, 200);
  assert.equal((await signup.json()).user.role, "member");
  assert.equal(signup.headers.get("set-cookie"), null);
  assert.equal((await register("valid-challenge", { ...member, email: "another@example.test" })).status, 403);

  const denied = await post("/api/auth/sign-in/email", { email: member.email, password });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, "EMAIL_NOT_VERIFIED");
  const emailPayload = JSON.parse(await readFile(verificationFile, "utf8"));
  assert.equal(emailPayload.to, member.email);
  assert.equal(emailPayload.from, "fitness@example.test");
  const link = new URL(emailPayload.text);
  assert.equal(link.origin, origin);
  assert.equal(link.pathname, "/api/auth/verify-email");
  const verified = await fetch(url(link.pathname + link.search), { redirect: "manual" });
  assert.equal(verified.status, 302);
  assert.equal((await post("/api/auth/sign-in/email", { email: member.email, password })).status, 200);
  console.log("Public signup, bot challenge rejection and replay protection, and verified member sign-in passed with simulated providers.");
} finally {
  await stopApp();
  await database.stop();
  await db.close();
  await rm(scratch, { recursive: true, force: true });
}
