import { and, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { authConfigured, getAuth, getDatabase } from "./runtime";
import { feedbackReport, user } from "./schema";

export const feedbackAreas = ["Home", "Nutrition", "Training", "Measurements", "Settings", "Sync & connections", "Sign-in", "Other"] as const;
export const feedbackStates = ["new", "reviewing", "resolved"] as const;
export type FeedbackStatus = typeof feedbackStates[number];

export const submitFeedback = z.object({
  action: z.literal("submit"),
  id: z.uuid(),
  kind: z.enum(["bug", "feature"]),
  title: z.string().trim().min(3, "Add a short title.").max(100),
  description: z.string().trim().min(10, "Add a little more detail.").max(3000),
  area: z.enum(feedbackAreas).optional(),
  includeContext: z.boolean(),
});

export const feedbackInput = z.discriminatedUnion("action", [
  submitFeedback,
  z.object({ action: z.literal("status"), id: z.uuid(), status: z.enum(feedbackStates) }),
  z.object({
    action: z.enum(["canny", "github"]),
    id: z.uuid(),
    title: z.string().trim().min(3, "Add a summary title.").max(100),
    summary: z.string().trim().min(10, "Describe the expected behaviour and how to reproduce the issue.").max(3000),
  }),
]);

export class FeedbackError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function feedbackUser(headers: Headers) {
  if (authConfigured()) return (await getAuth().api.getSession({ headers }))?.user;
}

function deviceContext(headers: Headers) {
  const ua = headers.get("user-agent") ?? "";
  const platform = /iPhone|iPad|iPod/.test(ua) ? "iOS / iPadOS"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows"
    : /Macintosh/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux" : "Unknown platform";
  const browser = /Edg(?:A|iOS)?\//.test(ua) ? "Edge"
    : /Firefox\/|FxiOS\//.test(ua) ? "Firefox"
    : /Chrome\/|CriOS\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari" : "Unknown browser";
  return `${platform} · ${browser}`;
}

export async function recordFeedback(userId: string, input: z.infer<typeof submitFeedback>, headers: Headers) {
  return getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"fitness-feedback:" + userId}))`);
    const [existing] = await tx.select({ id: feedbackReport.id, userId: feedbackReport.userId })
      .from(feedbackReport).where(eq(feedbackReport.id, input.id));
    if (existing?.userId === userId) return { id: existing.id };
    if (existing) throw new FeedbackError("Please start a new report.", 409);
    const [{ total }] = await tx.select({ total: count() }).from(feedbackReport)
      .where(and(eq(feedbackReport.userId, userId), gt(feedbackReport.createdAt, sql`now() - interval '1 hour'`)));
    if (total >= 8) throw new FeedbackError("You’ve sent several reports. Try again in an hour.", 429);
    await tx.insert(feedbackReport).values({
      id: input.id, userId, kind: input.kind, title: input.title, description: input.description,
      area: input.kind === "bug" ? input.area : null,
      context: input.kind === "bug" && input.includeContext ? deviceContext(headers) : null,
    });
    return { id: input.id };
  });
}

export async function recentFeedback(userId: string) {
  return getDatabase().select({
    id: feedbackReport.id, kind: feedbackReport.kind, title: feedbackReport.title,
    status: feedbackReport.status, createdAt: feedbackReport.createdAt,
  }).from(feedbackReport).where(eq(feedbackReport.userId, userId))
    .orderBy(desc(feedbackReport.createdAt), desc(feedbackReport.id)).limit(10);
}

export async function feedbackInbox(kind: "bug" | "feature", status: FeedbackStatus | "all", page: number) {
  return getDatabase().select({ report: feedbackReport, reporter: user.email })
    .from(feedbackReport).innerJoin(user, eq(feedbackReport.userId, user.id))
    .where(and(eq(feedbackReport.kind, kind), status === "all" ? undefined : eq(feedbackReport.status, status)))
    .orderBy(desc(feedbackReport.createdAt), desc(feedbackReport.id)).limit(21).offset((page - 1) * 20);
}

export async function updateFeedbackStatus(id: string, status: FeedbackStatus) {
  const [updated] = await getDatabase().update(feedbackReport).set({ status })
    .where(eq(feedbackReport.id, id)).returning({ id: feedbackReport.id });
  if (!updated) throw new FeedbackError("This report is no longer available.", 404);
}

export type FeedbackDestination = "canny" | "github";
export const pendingFeedbackLink = "pending";

export async function sendFeedback(
  id: string, destination: FeedbackDestination, send: () => Promise<{ link: string; assigned?: boolean }>,
) {
  const db = getDatabase();
  const key = destination === "canny" ? "cannyLink" : "githubLink";
  const [row] = await db.select().from(feedbackReport).where(eq(feedbackReport.id, id));
  if (!row) throw new FeedbackError("This report is no longer available.", 404);
  if (destination === "github" && row.kind !== "bug") throw new FeedbackError("AI fixes are available for bug reports.", 400);
  if (row[key] === pendingFeedbackLink) throw new FeedbackError("A send is pending. Check the destination before retrying.", 409);
  if (row[key]) return { link: row[key] };

  const [claimed] = await db.update(feedbackReport).set({ [key]: pendingFeedbackLink })
    .where(and(eq(feedbackReport.id, id), isNull(feedbackReport[key])))
    .returning({ id: feedbackReport.id });
  if (!claimed) throw new FeedbackError("This report is already being sent. Reload the inbox.", 409);

  let result;
  try {
    result = await send();
  } catch (error) {
    // A confirmed rejection is safe to retry. An ambiguous delivery stays pending.
    if (error instanceof FeedbackError) {
      await db.update(feedbackReport).set({ [key]: null }).where(eq(feedbackReport.id, id));
      throw error;
    }
    throw new FeedbackError("Delivery could not be confirmed. Check the destination using the report reference.", 502);
  }
  await db.update(feedbackReport).set({ [key]: result.link }).where(eq(feedbackReport.id, id));
  return result;
}
