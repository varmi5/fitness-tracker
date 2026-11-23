import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { syncHevyOAuth } from "../../../../../lib/hevy";
import { localDay } from "../../../../../lib/nutrition-model";
import { authConfigured, getDatabase } from "../../../../../lib/runtime";
import { healthIntegration } from "../../../../../lib/schema";
import { strainData } from "../../../../../lib/strain-data";

export const dynamic = "force-dynamic";

function verifyWebhookSecret(request: Request): boolean {
  const configured = process.env.HEVY_WEBHOOK_SECRET;
  if (!configured) return true;
  const authHeader =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-hevy-signature") ??
    "";
  if (!authHeader || authHeader.length !== configured.length) return false;
  return timingSafeEqual(Buffer.from(authHeader), Buffer.from(configured));
}

export async function POST(request: Request) {
  if (!authConfigured()) {
    return Response.json({ message: "Not configured." }, { status: 503 });
  }
  if (!verifyWebhookSecret(request)) {
    return Response.json({ message: "Unauthorized webhook." }, { status: 401 });
  }

  try {
    await request.json().catch(() => ({}));
    const db = getDatabase();
    const linkedAccounts = await db
      .select({ userId: healthIntegration.userId })
      .from(healthIntegration)
      .where(eq(healthIntegration.provider, "hevy"));

    let syncedUsers = 0;
    for (const row of linkedAccounts) {
      try {
        await syncHevyOAuth(db, row.userId, 2);
        const today = localDay(new Date(), "Europe/London");
        await strainData(db, row.userId).computeDay(today);
        syncedUsers += 1;
      } catch {
        // continue other accounts
      }
    }

    return Response.json({ received: true, syncedUsers }, { status: 200 });
  } catch {
    return Response.json({ message: "Webhook processing failed." }, { status: 500 });
  }
}
