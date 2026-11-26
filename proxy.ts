import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
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
  return response;
}

export const config = { matcher: ["/", "/support", "/setup", "/reset-password", "/api/:path*", "/oauth/:path*", "/mcp"] };
