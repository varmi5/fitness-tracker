import {
  handleGoogleWebhookNotifications,
  verifyGoogleWebhookAuthorization,
  verifyGoogleWebhookSignature,
} from "../../../../../lib/google-health";
import { authConfigured, getDatabase } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(request: Request) {
  const rawBody = await request.text();
  let parsed: unknown = null;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return json({ ok: false, error: "Invalid JSON payload." }, 400);
  }

  // Mandatory 2-step endpoint verification handshake (https://developers.google.com/health/webhooks):
  // Responds 200 with configured Authorization header, and 401 when credentials are missing or invalid.
  if (parsed && !Array.isArray(parsed) && typeof parsed === "object" && (parsed as { type?: unknown }).type === "verification") {
    if (!verifyGoogleWebhookAuthorization(request.headers.get("authorization"))) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }
    return json({ ok: true, type: "verification" }, 200);
  }

  if (!verifyGoogleWebhookAuthorization(request.headers.get("authorization"))) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  if (!authConfigured()) {
    return json({ ok: false, error: "Database is not configured." }, 503);
  }

  const sigHeader = request.headers.get("google-health-api-signature");
  if (sigHeader && process.env.GOOGLE_HEALTH_WEBHOOK_VERIFY_SIGNATURE !== "false") {
    const validSig = await verifyGoogleWebhookSignature(rawBody, sigHeader);
    if (!validSig) {
      return json({ ok: false, error: "Invalid webhook signature." }, 401);
    }
  }

  if (!Array.isArray(parsed)) {
    return json({ ok: false, error: "Expected notification array." }, 400);
  }

  await handleGoogleWebhookNotifications(getDatabase(), parsed);
  return new Response(null, { status: 204 });
}
