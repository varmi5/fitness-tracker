import { handleOpenWearablesWebhookEvent, verifySvixSignature } from "../../../../../lib/open-wearables";
import { authConfigured, getDatabase } from "../../../../../lib/runtime";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });

export async function POST(request: Request) {
  if (!process.env.OPEN_WEARABLES_WEBHOOK_SECRET) {
    return json({ message: "Open Wearables webhook secret is not configured." }, 503);
  }
  if (!authConfigured()) {
    return json({ message: "Database is not configured." }, 503);
  }

  const rawBody = await request.text();
  const check = verifySvixSignature(rawBody, {
    svixId: request.headers.get("svix-id"),
    svixTimestamp: request.headers.get("svix-timestamp"),
    svixSignature: request.headers.get("svix-signature"),
  });
  if (!check.ok) {
    return json({ ok: false, reason: check.reason ?? "invalid_signature" }, 400);
  }

  let payload: unknown = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return json({ ok: false, reason: "invalid_json" }, 400);
  }

  const result = await handleOpenWearablesWebhookEvent(getDatabase(), payload);
  return json({ ok: true, ...result }, 200);
}
