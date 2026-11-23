import { createHmac, timingSafeEqual } from "node:crypto";
import { findUsersForHevyWebhook, syncHevyOAuth } from "../../../../../lib/hevy";
import { localDay } from "../../../../../lib/nutrition-model";
import { authConfigured, getDatabase } from "../../../../../lib/runtime";
import { strainData } from "../../../../../lib/strain-data";

export const dynamic = "force-dynamic";

function verifyHevySignature(request: Request, rawBody: string): boolean {
  const secret = process.env.HEVY_CLIENT_SECRET ?? process.env.HEVY_WEBHOOK_SECRET;
  if (!secret) return false;

  const received = request.headers.get("hevy-signature") ?? "";
  if (received.startsWith("sha256=")) {
    const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
    if (received.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  }

  // Fallback for custom Bearer token if HEVY_WEBHOOK_SECRET is configured separately
  const webhookSecret = process.env.HEVY_WEBHOOK_SECRET;
  if (webhookSecret) {
    const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (bearer && bearer.length === webhookSecret.length) {
      return timingSafeEqual(Buffer.from(bearer), Buffer.from(webhookSecret));
    }
  }
  return false;
}

export async function POST(request: Request) {
  if (!authConfigured()) {
    return Response.json({ message: "Not configured." }, { status: 503 });
  }

  const rawBody = await request.text();
  if (!verifyHevySignature(request, rawBody)) {
    return Response.json({ message: "Invalid Hevy-Signature." }, { status: 401 });
  }

  try {
    const payload = (rawBody ? JSON.parse(rawBody) : {}) as {
      type?: string;
      workoutId?: string;
      userId?: string;
    };
    const db = getDatabase();
    const userIds = await findUsersForHevyWebhook(db, payload.userId);

    let syncedUsers = 0;
    for (const userId of userIds) {
      try {
        const res = await syncHevyOAuth(db, userId, 2, payload.workoutId);
        const today = localDay(new Date(), "Europe/London");
        const strain = strainData(db, userId);
        const days = new Set<string>([today, ...(res.affectedDays ?? [])]);
        for (const d of days) {
          await strain.computeDay(d).catch(() => null);
        }
        syncedUsers += 1;
      } catch {
        // continue other users
      }
    }

    return Response.json({ received: true, syncedUsers }, { status: 200 });
  } catch {
    return Response.json({ message: "Webhook processing failed." }, { status: 500 });
  }
}
