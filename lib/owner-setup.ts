import { equalCodes } from "./signup-config";
import { eq } from "drizzle-orm";
import { createAuth, type AuthConfig, type AuthDatabase } from "./auth";
import { ownerSetup, user } from "./schema";

export const SETUP_NOT_CONFIGURED = "Setup is not configured.";
export const SIGNUP_CLOSED = "Signup is closed.";
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const setupRow = eq(ownerSetup.id, 1);

function configuredCode(code: string | undefined) {
  if (!code || code.trim() !== code || code.length < 24 || /[^\x20-\x7e]/.test(code)) return undefined;
  const normalized = code.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normalized || /^(?:(?:changeme|placeholder|replaceme|yoursetupcode)(?:here|\d)*)+$/.test(normalized)) {
    return undefined;
  }
  return code;
}

export function hasValidSetupCode(config: AuthConfig) {
  return configuredCode(config.setupCode) !== undefined;
}

function problem(status: number, message: string, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  return Response.json({ message }, { status, headers: responseHeaders });
}

export async function getSetupStatus(db: AuthDatabase, config: AuthConfig) {
  if (config.mode !== "closed") return "closed";
  if (!configuredCode(config.setupCode)) return "unconfigured";

  const [state] = await db.select().from(ownerSetup).where(setupRow);
  if (!state || state.consumed) return "closed";
  const [existingUser] = await db.select({ id: user.id }).from(user).limit(1);
  return existingUser ? "closed" : "available";
}

export async function signUpOwner(request: Request, db: AuthDatabase, config: AuthConfig) {
  if (config.mode !== "closed") return problem(403, SIGNUP_CLOSED);
  const expectedCode = configuredCode(config.setupCode);
  if (!expectedCode) return problem(403, SETUP_NOT_CONFIGURED);
  if (request.headers.get("origin") !== new URL(config.baseURL).origin) {
    return problem(403, "Signup requires a same-origin request.");
  }

  return db.transaction(async (tx) => {
    const [state] = await tx.select().from(ownerSetup).where(setupRow).for("update");
    if (!state || state.consumed) return problem(403, SIGNUP_CLOSED);
    const [existingUser] = await tx.select({ id: user.id }).from(user).limit(1);
    if (existingUser) {
      await tx.update(ownerSetup).set({ consumed: true }).where(setupRow);
      return problem(403, SIGNUP_CLOSED);
    }

    const now = Date.now();
    const remainingMs = state.windowStartedAt.getTime() + WINDOW_MS - now;
    const attempts = remainingMs <= 0 ? 0 : state.attempts;
    if (attempts >= MAX_ATTEMPTS) {
      return problem(429, "Too many setup attempts. Try again later.", {
        "Retry-After": String(Math.ceil(remainingMs / 1000)),
      });
    }

    await tx.update(ownerSetup).set({
      attempts: attempts + 1,
      windowStartedAt: attempts === 0 ? new Date(now) : state.windowStartedAt,
    }).where(setupRow);

    const suppliedCode = request.headers.get("x-setup-code");
    if (!suppliedCode || !equalCodes(expectedCode, suppliedCode)) {
      return problem(403, "Invalid setup code.");
    }

    const headers = new Headers(request.headers);
    headers.delete("x-setup-code");
    // Roll back a partly created account on handler errors while retaining the attempt.
    let rejected: Response | undefined;
    try {
      return await tx.transaction(async (savepoint) => {
        const response = await createAuth(savepoint, config, true).handler(new Request(request.url, { method: "POST", headers, body: await request.arrayBuffer() }));
        if (!response.ok) {
          rejected = response;
          throw new Error("Owner signup rejected.");
        }
        await savepoint.update(ownerSetup).set({ consumed: true }).where(setupRow);
        return response;
      });
    } catch (error) {
      if (rejected) return rejected;
      throw error;
    }
  });
}
