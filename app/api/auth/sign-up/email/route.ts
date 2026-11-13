import { SETUP_NOT_CONFIGURED, hasValidSetupCode, signUpOwner } from "../../../../../lib/owner-setup";
import { authConfigured, getAuthConfig, getDatabase } from "../../../../../lib/runtime";
import { eq } from "drizzle-orm";
import { ownerSetup } from "../../../../../lib/schema";
import { createAuth } from "../../../../../lib/auth";
import { equalCodes, verifyTurnstile } from "../../../../../lib/signup-config";

export const runtime = "nodejs";

function forbidden(message: string) {
  return Response.json({ message }, { status: 403, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const config = getAuthConfig();
  if (!authConfigured() || (config.mode === "closed" && !hasValidSetupCode(config))) {
    return forbidden(SETUP_NOT_CONFIGURED);
  }
  if (config.mode === "closed") return signUpOwner(request, getDatabase(), config);
  if (request.headers.get("origin") !== new URL(config.baseURL).origin) return forbidden("Signup requires a same-origin request.");
  if (config.mode === "invite" && !equalCodes(process.env.INVITE_CODE!, request.headers.get("x-invite-code") ?? "")) {
    return forbidden("Invalid invite code.");
  }
  const db = getDatabase();
  const [setup] = await db.select().from(ownerSetup).where(eq(ownerSetup.id, 1));
  if (!setup?.consumed) return forbidden("Create the owner in closed mode before opening signup.");
  const verified = await verifyTurnstile(request.headers.get("x-turnstile-response") ?? "", config.baseURL).catch(() => false);
  if (!verified) return forbidden("Please complete the verification challenge again.");
  const headers = new Headers(request.headers);
  headers.delete("x-invite-code");
  headers.delete("x-turnstile-response");
  return createAuth(db, config, false, true).handler(new Request(request.url, { method: "POST", headers, body: await request.arrayBuffer() }));
}
