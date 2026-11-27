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
    BETTER_AUTH_URL: "https://primary.example.test/app",
    ALLOWED_ORIGINS: " https://legacy.example.test/ , invalid-url, https://primary.example.test, ftp://bad.example ",
    MCP_PUBLIC_URL: "https://legacy.example.test/mcp",
  };
  assert.equal(getPrimaryOrigin(env), "https://primary.example.test");
  assert.deepEqual(getAllowedOrigins(env), [
    "https://primary.example.test",
    "https://legacy.example.test",
  ]);
  assert.equal(getMcpPublicOrigin(env), "https://legacy.example.test");
  assert.equal(getMcpPublicOrigin({ BETTER_AUTH_URL: "https://primary.example.test" }), "https://primary.example.test");
});

test("isAllowedOrigin, isSameAllowedOrigin, and resolveRequestOrigin enforce allowlists and fall back safely", () => {
  const allowed = ["https://legacy.example.test", "https://primary.example.test"];
  assert.equal(isAllowedOrigin("https://primary.example.test", allowed), true);
  assert.equal(isAllowedOrigin("https://evil.example", allowed), false);
  assert.equal(isAllowedOrigin(null, allowed), false);

  const goodPost = new Request("https://primary.example.test/api/nutrition", {
    method: "POST",
    headers: { origin: "https://primary.example.test" },
  });
  assert.equal(isSameAllowedOrigin(goodPost, { baseURL: allowed[0], allowedOrigins: allowed }), true);

  const evilPost = new Request("https://primary.example.test/api/nutrition", {
    method: "POST",
    headers: { origin: "https://evil.example" },
  });
  assert.equal(isSameAllowedOrigin(evilPost, { baseURL: allowed[0], allowedOrigins: allowed }), false);

  const forwardedReq = new Request("http://127.0.0.1:3000/api/integrations/google/connect", {
    headers: {
      "x-forwarded-host": "primary.example.test",
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(
    getValidatedRequestOrigin(forwardedReq, { baseURL: allowed[0], allowedOrigins: allowed }),
    "https://primary.example.test",
  );

  const forwardedHttpProxyReq = new Request("http://127.0.0.1:3000/api/integrations/google/connect", {
    headers: {
      "x-forwarded-host": "primary.example.test",
      "x-forwarded-proto": "http",
    },
  });
  assert.equal(
    getValidatedRequestOrigin(forwardedHttpProxyReq, { baseURL: allowed[0], allowedOrigins: allowed }),
    "https://primary.example.test",
  );

  const spoofedReq = new Request("http://127.0.0.1:3000/api/integrations/google/connect", {
    headers: {
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(
    resolveRequestOrigin(spoofedReq, allowed, allowed[0]),
    "https://legacy.example.test",
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
      hostname: "primary.example.test",
      action: "signup",
    })) as typeof fetch;

  try {
    assert.equal(await verifyTurnstile("tok", "https://primary.example.test"), true);
    assert.equal(await verifyTurnstile("tok", "https://legacy.example.test"), false);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = prevSecret;
  }
});
