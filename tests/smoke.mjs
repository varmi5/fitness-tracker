import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
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
  ...process.env, FITNESS_BACKGROUND_WORKER: "false", HOSTNAME: "127.0.0.1", PORT: "3088", SIGNUP_MODE: "closed",
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
  assert.match(dashboard, /Energy Balance/);
  assert.match(dashboard, /Measurements/);
  assert.doesNotMatch(dashboard, /class="masthead"/);
  const result = await post("/api/tracker", {
    action: "log", data: { date: "2026-11-01", values: [{ key: "waist", value: 80 }], note: "Test" },
  }, { Cookie: cookie });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).readings[0].value, 80);
  assert.equal((await fetch(url("/api/tracker"))).status, 401);

  // Verify nutrition API endpoints and auth isolation
  assert.equal((await fetch(url("/api/nutrition"))).status, 401);
  const mealRes = await post("/api/nutrition", {
    action: "log",
    data: {
      day: "2026-11-17",
      time: "08:30",
      name: "Breakfast eggs",
      category: "breakfast",
      idempotencyKey: "smoke-breakfast-1",
      items: [{ name: "Three large eggs", amount: 180, unit: "g", calories: 257, proteinG: 22.7, carbsG: 2, fatG: 17.5, estimationMethod: "weighed" }],
    },
  }, { Cookie: cookie });
  assert.equal(mealRes.status, 200);
  const mealJson = await mealRes.json();
  assert.equal(mealJson.dailyTotals.calories, 257);
  assert.equal(mealJson.remainingCalorieAllowance, 1643);
  assert.equal((await fetch(url("/api/nutrition/barcode?code=bad"), { headers: { Cookie: cookie } })).status, 400);
  assert.equal((await fetch(url("/.well-known/oauth-protected-resource/mcp"))).status, 404);
  assert.equal((await fetch(url("/mcp"), { method: "POST" })).status, 404);

  const passkeys = await fetch(url("/api/auth/passkey/list-user-passkeys"), { headers: { Cookie: cookie } });
  assert.equal(passkeys.status, 200);
  assert.deepEqual(await passkeys.json(), []);
  assert.equal((await post("/api/auth/sign-in/email", { email, password })).status, 200);
  assert.equal((await post("/api/auth/sign-up/email", { name: "Other", email: "other@example.test", password }, { "X-Setup-Code": code })).status, 403);
  assert.equal((await fetch(url("/sw.js"))).status, 200);
  assert.equal((await fetch(url("/manifest.webmanifest"))).status, 200);
  console.log("Migrations, owner creation, login, tracker API, nutrition API, passkey listing, CSP and PWA endpoints passed.");
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
  assert.match(signupHtml, /Create your FitnessTrackr account/);
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
  const memberSignIn = await post("/api/auth/sign-in/email", { email: member.email, password });
  assert.equal(memberSignIn.status, 200);
  const memberCookie = memberSignIn.headers.getSetCookie().map((header) => header.split(";")[0]).join("; ");
  assert.ok(memberCookie);
  console.log("Public signup, bot challenge rejection and replay protection, and verified member sign-in passed with simulated providers.");
  await stopApp();

  // Simulate the old production resource policy; startup must merge the fixed scopes.
  await db.query(`INSERT INTO "oauthResource" (id, name, identifier, "allowedScopes") VALUES ('old-resource', 'Legacy MCP', $1, $2)`, [`${origin}/mcp`, ["fitness:read", "fitness:write"]]);
  app = spawn(process.execPath, [".next/standalone/server.js"], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...env, FITNESS_MCP_ENABLED: "true" },
  });
  await waitForSetup();
  const prm = await fetch(url("/.well-known/oauth-protected-resource/mcp"));
  assert.equal(prm.status, 200);
  const prmJson = await prm.json();
  assert.equal(prmJson.resource, `${origin}/mcp`);
  const asMeta = await fetch(url("/.well-known/oauth-authorization-server"));
  assert.equal(asMeta.status, 200);
  const asJson = await asMeta.json();
  assert.ok(asJson.registration_endpoint);
  const mcpChallenge = await fetch(url("/mcp"), { method: "POST" });
  assert.equal(mcpChallenge.status, 401);
  assert.match(mcpChallenge.headers.get("www-authenticate") ?? "", /resource_metadata="/);
  console.log("MCP OAuth discovery metadata and Bearer challenge passed.");

  const missingToken = await fetch(url("/mcp"));
  assert.match(missingToken.headers.get("www-authenticate"), /scope="fitness:read fitness:write offline_access"/);
  assert.equal(missingToken.headers.get("www-authenticate").includes("fitness:settings:write"), false);
  const expiredToken = await fetch(url("/mcp"), {headers:{Authorization:"Bearer invalid-synthetic-token"}});
  assert.match(expiredToken.headers.get("www-authenticate"), /error="invalid_token"/);
  const packagedAuth = JSON.parse(await readFile("plugins/mcp-logger/mcp.json", "utf8")).mcpServers["mcp-logger"].extensions["com.openai"].auth;
  assert.deepEqual(packagedAuth.baseScopes, ["fitness:read", "fitness:write", "offline_access"]);

  const callback = "http://127.0.0.1:3089/callback";
  const verifier = randomBytes(32).toString("base64url");
  const registration = await post("/api/auth/oauth2/register", {
    client_name: "FitnessTrackr smoke test", application_type: "native", redirect_uris: [callback],
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
    token_endpoint_auth_method: "none", scope: "fitness:read fitness:write offline_access",
  });
  if (!registration.ok) { const err = await registration.json(); throw new Error(`OAuth registration failed (${registration.status}): ${err.error ?? ""} ${err.error_description ?? err.message ?? ""}`); }
  const client = await registration.json();
  const authorization = new URL(asJson.authorization_endpoint);
  authorization.search = new URLSearchParams({ client_id: client.client_id, response_type: "code",
    redirect_uri: callback, scope: "fitness:read fitness:write offline_access", state: "synthetic-smoke-state",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
    resource: `${origin}/mcp` }).toString();
  const consentRedirect = await fetch(url(authorization.pathname + authorization.search), { headers: { Cookie: cookie }, redirect: "manual" });
  const redirectBody = consentRedirect.status === 200 ? await consentRedirect.json() : null;
  const nextUrl = consentRedirect.headers.get("location") ?? redirectBody?.url;
  assert.ok(nextUrl, `OAuth authorization must redirect to consent (${consentRedirect.status})`);
  const consentUrl = new URL(nextUrl, origin);
  assert.equal(consentUrl.pathname, "/oauth/consent");
  const consent = await post("/api/auth/oauth2/consent", { accept: true, oauth_query: consentUrl.search.slice(1) }, { Cookie: cookie });
  assert.ok(consent.ok, "OAuth consent must succeed");
  const consentResult = await consent.json();
  const authorized = new URL(consentResult.url);
  assert.equal(authorized.origin, new URL(callback).origin);
  const tokenResponse = await fetch(url(new URL(asJson.token_endpoint).pathname), {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: authorized.searchParams.get("code"),
      client_id: client.client_id, redirect_uri: callback, code_verifier: verifier, resource: `${origin}/mcp` }),
  });
  assert.ok(tokenResponse.ok, "OAuth token exchange must succeed");
  const grant = await tokenResponse.json();
  assert.ok(grant.access_token);
  assert.ok(grant.refresh_token, "Offline access must issue a refresh token");
  for (let refresh = 0; refresh < 2; refresh++) {
    const previousRefreshToken = grant.refresh_token;
    const renewed = await fetch(url(new URL(asJson.token_endpoint).pathname), {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: grant.refresh_token,
        client_id: client.client_id, resource: `${origin}/mcp` }),
    });
    assert.ok(renewed.ok, `Refresh ${refresh + 1} must succeed (${renewed.status})`);
    const result = await renewed.json();
    assert.ok(result.refresh_token, `Refresh ${refresh + 1} must retain offline access for the next refresh`);
    const retry = await fetch(url(new URL(asJson.token_endpoint).pathname), {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: previousRefreshToken,
        client_id: client.client_id, resource: `${origin}/mcp` }),
    });
    assert.ok(retry.ok, "Immediate refresh retry must not invalidate the connection");
    assert.equal((await retry.json()).refresh_token, result.refresh_token);
    Object.assign(grant, result);
  }

  const mcpCall = async (method, params) => {
    const response = await post("/mcp", { jsonrpc: "2.0", id: 1, method, params }, {
      Authorization: `Bearer ${grant.access_token}`, Accept: "application/json, text/event-stream",
    });
    assert.equal(response.status, 200, "Authenticated MCP HTTP calls must succeed");
    const result = await response.json();
    assert.equal(result.error, undefined);
    return result.result;
  };
  await mcpCall("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "smoke", version: "1" } });
  const listed = await mcpCall("tools/list", {});
  assert.equal(listed.tools.length, 14);
  const dailyLog = await mcpCall("tools/call", { name: "get_daily_log", arguments: { day: "2026-11-17" } });
  assert.equal(dailyLog.isError, false);
  assert.equal(JSON.parse(dailyLog.content[0].text).totals.calories, 257);

  // User-scoped /api/nutrition?sync=1 token must reflect owner's MCP writes without affecting other users
  assert.equal((await fetch(url("/api/nutrition?sync=1"))).status, 401);
  assert.equal((await fetch(url("/api/integrations/google/push"))).status, 401);
  const googleStateResponse = await fetch(url("/api/integrations/google/push"), { headers: { Cookie: cookie } });
  assert.equal(googleStateResponse.status, 200);
  assert.match(googleStateResponse.headers.get("cache-control"), /private, no-store/);
  assert.equal((await googleStateResponse.json()).status.mealSync.verified, 0);
  const ownerSyncBefore = await (await fetch(url("/api/nutrition?sync=1"), { headers: { Cookie: cookie } })).json();
  const memberSyncBefore = await (await fetch(url("/api/nutrition?sync=1"), { headers: { Cookie: memberCookie } })).json();
  assert.ok(ownerSyncBefore.token && memberSyncBefore.token);
  assert.notEqual(ownerSyncBefore.token, memberSyncBefore.token);
  const mcpLogged = await mcpCall("tools/call", {
    name: "log_meal",
    arguments: {
      day: "2026-11-17",
      time: "19:10",
      name: "ChatGPT dinner bowl",
      category: "dinner",
      idempotencyKey: "smoke-mcp-sync-1",
      items: [{ name: "Chicken", amount: 150, unit: "g", calories: 250, proteinG: 45, carbsG: 0, fatG: 6, estimationMethod: "weighed" }],
    },
  });
  assert.equal(mcpLogged.isError, false);
  const ownerSyncAfter = await (await fetch(url("/api/nutrition?sync=1"), { headers: { Cookie: cookie } })).json();
  const memberSyncAfter = await (await fetch(url("/api/nutrition?sync=1"), { headers: { Cookie: memberCookie } })).json();
  assert.notEqual(ownerSyncAfter.token, ownerSyncBefore.token);
  assert.equal(memberSyncAfter.token, memberSyncBefore.token);
  console.log("OAuth registration, PKCE, consent, token exchange, authenticated HTTP MCP tools, and user-scoped sync token passed.");
} finally {
  await stopApp();
  await database.stop();
  await db.close();
  await rm(scratch, { recursive: true, force: true });
}
