import { NextRequest, NextResponse } from "next/server";
import {
  getAllowedOrigins,
  getPrimaryOrigin,
  isLegacyBrowserRedirectPath,
  resolveRequestOrigin,
} from "./lib/origins";

export function proxy(request: NextRequest) {
  const primaryOrigin = getPrimaryOrigin();
  const allowedOrigins = getAllowedOrigins();
  const reqOrigin = resolveRequestOrigin(request, allowedOrigins, primaryOrigin);
  const isLegacyHost = reqOrigin !== primaryOrigin;

  if (
    process.env.REDIRECT_LEGACY_WEB_TO_PRIMARY === "true" &&
    isLegacyHost &&
    (request.method === "GET" || request.method === "HEAD") &&
    isLegacyBrowserRedirectPath(request.nextUrl.pathname)
  ) {
    return NextResponse.redirect(
      new URL(request.nextUrl.pathname + request.nextUrl.search, primaryOrigin),
      301,
    );
  }

  const nonce = btoa(crypto.randomUUID());
  const turnstile = process.env.SIGNUP_MODE === "invite" || process.env.SIGNUP_MODE === "open";
  const challenge = turnstile ? " https://challenges.cloudflare.com" : "";
  const dev = process.env.NODE_ENV !== "production" ? " 'unsafe-eval'" : "";
  const csp = [
    "default-src 'self'", `script-src 'self' 'nonce-${nonce}'${dev}${challenge}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob:",
    `connect-src 'self'${challenge}`, `frame-src 'self'${challenge}`, "worker-src 'self'",
    "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'",
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Cache-Control", "private, no-store");
  if (request.nextUrl.pathname.startsWith("/share/physique/")) {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  } else if (isLegacyHost) {
    response.headers.set("X-Robots-Tag", "noindex");
  }
  return response;
}

export const config = {
  matcher: [
    "/",
    "/connect",
    "/privacy",
    "/terms",
    "/support",
    "/setup",
    "/reset-password",
    "/share/physique/:path*",
    "/api/:path*",
    "/oauth/:path*",
    "/mcp",
  ],
};
