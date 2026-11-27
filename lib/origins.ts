export function parseOrigin(raw?: string | null): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function getPrimaryOrigin(env: Record<string, string | undefined> = process.env): string {
  return parseOrigin(env.BETTER_AUTH_URL) ?? "http://localhost:3000";
}

export function getAllowedOrigins(env: Record<string, string | undefined> = process.env): string[] {
  const primary = getPrimaryOrigin(env);
  const extras = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => parseOrigin(entry))
    .filter((entry): entry is string => Boolean(entry));
  return [...new Set([primary, ...extras])];
}

export function getMcpPublicOrigin(env: Record<string, string | undefined> = process.env): string {
  return parseOrigin(env.MCP_PUBLIC_URL) ?? getPrimaryOrigin(env);
}

export function isAllowedOrigin(
  origin: string | null | undefined,
  allowedOrigins: readonly string[],
): origin is string {
  return typeof origin === "string" && allowedOrigins.includes(origin);
}

export function isSameAllowedOrigin(
  request: Request,
  config: { baseURL: string; allowedOrigins?: readonly string[] },
): boolean {
  const allowed = config.allowedOrigins?.length
    ? config.allowedOrigins
    : [new URL(config.baseURL).origin];
  return isAllowedOrigin(request.headers.get("origin"), allowed);
}

export function getValidatedRequestOrigin(
  request: Request,
  config: { baseURL: string; allowedOrigins?: readonly string[] },
): string {
  const fallback = new URL(config.baseURL).origin;
  const allowed = config.allowedOrigins?.length ? config.allowedOrigins : [fallback];
  return resolveRequestOrigin(request, allowed, fallback);
}

export function resolveRequestOrigin(
  request: Request,
  allowedOrigins: readonly string[],
  fallbackOrigin: string,
): string {
  const headerOrigin = parseOrigin(request.headers.get("origin"));
  if (headerOrigin && allowedOrigins.includes(headerOrigin)) return headerOrigin;

  const rawHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const host = rawHost?.split(",")[0]?.trim();
  if (host) {
    const rawProto = request.headers.get("x-forwarded-proto");
    let proto = rawProto?.split(",")[0]?.trim().toLowerCase();
    if (proto !== "http" && proto !== "https") {
      try {
        const reqProto = new URL(request.url).protocol.replace(":", "").toLowerCase();
        proto = reqProto === "http" || reqProto === "https" ? reqProto : "https";
      } catch {
        proto = "https";
      }
    }
    const hostOrigin = parseOrigin(`${proto}://${host}`);
    if (hostOrigin && allowedOrigins.includes(hostOrigin)) return hostOrigin;
  }

  const urlOrigin = parseOrigin(request.url);
  if (urlOrigin && allowedOrigins.includes(urlOrigin)) return urlOrigin;

  return fallbackOrigin;
}

export function isLegacyBrowserRedirectPath(pathname: string): boolean {
  if (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/mcp" ||
    pathname.startsWith("/mcp/") ||
    pathname === "/oauth" ||
    pathname.startsWith("/oauth/") ||
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/sw.js" ||
    pathname === "/manifest.webmanifest"
  ) {
    return false;
  }
  return true;
}
