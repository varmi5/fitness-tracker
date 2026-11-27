import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, like, lt } from "drizzle-orm";
import { z } from "zod";
import type { AuthDatabase } from "./auth";
import { seal, unseal } from "./google-health";
import { verification } from "./schema";

export type OAuthProvider = "hevy" | "google";
export type OAuthReturnTo = "onboarding-1" | "onboarding-3";

export const OAUTH_STATE_TTL_SECONDS = 1200;

const sealedStateSchema = z.object({
  state: z.string(),
  userId: z.string(),
  returnTo: z.enum(["onboarding-1", "onboarding-3"]).optional(),
  verifier: z.string().optional(),
});

export type SealedOAuthState = z.infer<typeof sealedStateSchema>;

export function parseOAuthReturnTo(raw: string | null): OAuthReturnTo | null {
  return raw === "onboarding-1" || raw === "onboarding-3" ? raw : null;
}

function stateIdentifier(provider: OAuthProvider, state: string): string {
  return `oauth_state:${provider}:${state}`;
}

export async function createOAuthState(
  db: AuthDatabase,
  provider: OAuthProvider,
  userId: string,
  opts?: { returnTo?: OAuthReturnTo | null; verifier?: string },
) {
  const state = randomBytes(24).toString("base64url");
  const payload: SealedOAuthState = {
    state,
    userId,
    ...(opts?.returnTo ? { returnTo: opts.returnTo } : {}),
    ...(opts?.verifier ? { verifier: opts.verifier } : {}),
  };
  const sealed = seal(payload, userId);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OAUTH_STATE_TTL_SECONDS * 1000);

  await db.insert(verification).values({
    id: randomUUID(),
    identifier: stateIdentifier(provider, state),
    value: sealed,
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });

  await db
    .delete(verification)
    .where(and(like(verification.identifier, "oauth_state:%"), lt(verification.expiresAt, now)))
    .catch(() => null);

  return { state, sealed, maxAge: OAUTH_STATE_TTL_SECONDS };
}

function tryUnsealState(raw: string, userId: string): SealedOAuthState | null {
  try {
    return sealedStateSchema.parse(unseal(raw, userId));
  } catch {
    return null;
  }
}

export type ConsumeOAuthStateResult =
  | { ok: true; data: SealedOAuthState; reason?: undefined }
  | { ok: false; data?: undefined; reason: "expired" | "state-mismatch" };

export async function consumeOAuthState(
  db: AuthDatabase,
  provider: OAuthProvider,
  userId: string,
  state: string,
  cookieValue?: string | null,
): Promise<ConsumeOAuthStateResult> {
  const [dbRow] = await db
    .delete(verification)
    .where(eq(verification.identifier, stateIdentifier(provider, state)))
    .returning();

  if (dbRow && dbRow.expiresAt > new Date()) {
    const parsed = tryUnsealState(dbRow.value, userId);
    if (parsed && parsed.state === state && parsed.userId === userId) {
      return { ok: true, data: parsed };
    }
  }

  if (cookieValue) {
    const parsed = tryUnsealState(cookieValue, userId);
    if (parsed) {
      if (parsed.state === state && parsed.userId === userId) {
        return { ok: true, data: parsed };
      }
      return { ok: false, reason: "state-mismatch" };
    }
  }

  return { ok: false, reason: "expired" };
}
