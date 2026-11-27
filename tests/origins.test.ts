import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getAllowedOrigins,
  getMcpPublicOrigin,
  getPrimaryOrigin,
  getValidatedRequestOrigin,
  isAllowedOrigin,
  isLegacyBrowserRedirectPath,
  isSameAllowedOrigin,
  resolveRequestOrigin,
} from "../lib/origins";
import { verifyTurnstile } from "../lib/signup-config";

test("origin helpers parse BETTER_AUTH_URL, ALLOWED_ORIGINS, and decoupled MCP_PUBLIC_URL", () => {
  const env = {
    BETTER_AUTH_URL: "https://fitnesstrackr.co.uk/app",
    ALLOWED_ORIGINS: " https://fitnesstrackr.co.uk/ , invalid-url, https://fitnesstrackr.co.uk, ftp://bad.example ",
    MCP_PUBLIC_URL: "https://fitnesstrackr.co.uk/mcp",
  };
  assert.equal(getPrimaryOrigin(env), "https://fitnesstrackr.co.uk");
  assert.deepEqual(getAllowedOrigins(env), [
    "https://fitnesstrackr.co.uk",
    "https://fitnesstrackr.co.uk",
  ]);
  assert.equal(getMcpPublicOrigin(env), "https://fitnesstrackr.co.uk");
  assert.equal(getMcpPublicOrigin({ BETTER_AUTH_URL: "https://fitnesstrackr.co.uk" }), "https://fitnesstrackr.co.uk");
});

test("isAllowedOrigin, isSameAllowedOrigin, and resolveRequestOrigin enforce allowlists and fall back safely", () => {
  const allowed = ["https://fitnesstrackr.co.uk", "https://fitnesstrackr.co.uk"];
  assert.equal(isAllowedOrigin("https://fitnesstrackr.co.uk", allowed), true);
  assert.equal(isAllowedOrigin("https://evil.example", allowed), false);
  assert.equal(isAllowedOrigin(null, allowed), false);

  const goodPost = new Request("https://fitnesstrackr.co.uk/api/nutrition", {
    method: "POST",
    headers: { origin: "https://fitnesstrackr.co.uk" },
  });
  assert.equal(isSameAllowedOrigin(goodPost, { baseURL: allowed[0], allowedOrigins: allowed }), true);

  const evilPost = new Request("https://fitnesstrackr.co.uk/api/nutrition", {
    method: "POST",
    headers: { origin: "https://evil.example" },
  });
  assert.equal(isSameAllowedOrigin(evilPost, { baseURL: allowed[0], allowedOrigins: allowed }), false);

  const forwardedReq = new Request("http://127.0.0.1:3000/api/integrations/google/connect", {
    headers: {
      "x-forwarded-host": "fitnesstrackr.co.uk",
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(
    getValidatedRequestOrigin(forwardedReq, { baseURL: allowed[0], allowedOrigins: allowed }),
    "https://fitnesstrackr.co.uk",
  );

  const spoofedReq = new Request("http://127.0.0.1:3000/api/integrations/google/connect", {
    headers: {
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(
    resolveRequestOrigin(spoofedReq, allowed, allowed[0]),
    "https://fitnesstrackr.co.uk",
  );
});

test("isLegacyBrowserRedirectPath redirects browser pages only and never API, MCP, OAuth, or well-known endpoints", () => {
  for (const page of ["/", "/connect", "/privacy", "/terms", "/support", "/setup", "/share/physique/abc"]) {
    assert.equal(isLegacyBrowserRedirectPath(page), true, `${page} should redirect for legacy browser visits`);
  }
  for (const endpoint of [
    "/api/integrations/google/webhook",
    "/api/nutrition",
    "/mcp",
    "/oauth/consent",
    "/oauth/login",
    "/.well-known/oauth-protected-resource/mcp",
    "/.well-known/openai-apps-challenge",
    "/sw.js",
    "/manifest.webmanifest",
  ]) {
    assert.equal(isLegacyBrowserRedirectPath(endpoint), false, `${endpoint} must never redirect`);
  }
});

test("verifyTurnstile validates hostname against the supplied request origin", async () => {
  const prevSecret = process.env.TURNSTILE_SECRET_KEY;
  const prevFetch = globalThis.fetch;
  process.env.TURNSTILE_SECRET_KEY = "test-secret";
  globalThis.fetch = (async () =>
    Response.json({
      success: true,
      hostname: "fitnesstrackr.co.uk",
      action: "signup",
    })) as typeof fetch;

  try {
    assert.equal(await verifyTurnstile("tok", "https://fitnesstrackr.co.uk"), true);
    assert.equal(await verifyTurnstile("tok", "https://fitnesstrackr.co.uk"), false);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = prevSecret;
  }
});
