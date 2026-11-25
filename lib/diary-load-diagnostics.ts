// Endpoint failures go to container logs without health data, account IDs, or SQL.
export function logDiaryLoadFailure(endpoint: "bootstrap" | "nutrition" | "strain" | "pulse", error: unknown) {
  const cause = error instanceof Error ? error.cause ?? error : error;
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
  console.warn("[diary] Data request failed", {
    endpoint,
    kind: cause instanceof TypeError ? "type" : cause instanceof RangeError ? "range" : "unexpected",
    ...(typeof code === "string" && /^(?:[0-9A-Z]{5}|ECONNRESET|ECONNREFUSED|ETIMEDOUT)$/.test(code) ? { code } : {}),
  });
}
