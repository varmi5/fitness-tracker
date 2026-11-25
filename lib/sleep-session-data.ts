import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { AuthDatabase } from "./auth";
import { sleepInput } from "./nutrition-model";
import { dailySleep, sleepSession } from "./schema";

type SleepInput = z.input<typeof sleepInput>;
type SleepDb = Pick<AuthDatabase, "select" | "insert" | "delete">;

export function sleepSessionKey(entry: Pick<SleepInput, "sessionId" | "sleepStart" | "sleepEnd" | "day">): string {
  if (entry.sessionId) return `id:${entry.sessionId}`;
  if (entry.sleepStart && entry.sleepEnd) return `interval:${new Date(entry.sleepStart).toISOString()}|${new Date(entry.sleepEnd).toISOString()}`;
  return `day:${entry.day}`;
}

// Retain raw observations, then project the longest completed main session for legacy consumers.
// Call within the caller's transaction. Every lookup and conflict key is user-scoped.
export async function saveSleepSession(db: SleepDb, userId: string, raw: SleepInput, now = new Date()) {
  const entry = sleepInput.parse(raw);
  const sessionKey = sleepSessionKey(entry);
  const values = {
    userId, source: entry.source, sessionKey, day: entry.day,
    sleepStart: entry.sleepStart ? new Date(entry.sleepStart) : null,
    sleepEnd: entry.sleepEnd ? new Date(entry.sleepEnd) : null,
    minutesAsleep: entry.minutesAsleep, minutesAwake: entry.minutesAwake ?? null,
    deepMinutes: entry.deepMinutes ?? null, remMinutes: entry.remMinutes ?? null,
    lightMinutes: entry.lightMinutes ?? null, stagesJson: entry.stagesJson,
    isMainSleep: entry.isMainSleep ?? entry.minutesAsleep >= 90, processed: entry.processed ?? null, classificationMethod: entry.classificationMethod ?? "legacy",
    stageIntervalsJson: entry.stageIntervalsJson, syncedAt: now,
  };
  if (values.sleepStart && values.sleepEnd && values.sleepEnd <= values.sleepStart) throw new Error("Sleep end must follow start.");
  const [existing] = await db.select().from(sleepSession).where(and(eq(sleepSession.userId, userId), eq(sleepSession.source, entry.source), eq(sleepSession.sessionKey, sessionKey)));
  await db.insert(sleepSession).values(values).onConflictDoUpdate({
    target: [sleepSession.userId, sleepSession.source, sleepSession.sessionKey], set: values,
  });
  for (const day of new Set([entry.day, ...(existing ? [existing.day] : [])])) {
    const rows = await db.select().from(sleepSession).where(and(eq(sleepSession.userId, userId), eq(sleepSession.source, entry.source), eq(sleepSession.day, day))).orderBy(desc(sleepSession.minutesAsleep));
    const completed = rows.filter(r => r.processed !== false && (!r.sleepEnd || r.sleepEnd <= now) && r.minutesAsleep > 0);
    // Short explicitly-labelled naps should never create a main night for readiness.
    const main = completed.find(r => r.isMainSleep);
    await db.delete(dailySleep).where(and(eq(dailySleep.userId, userId), eq(dailySleep.source, entry.source), eq(dailySleep.day, day)));
    if (!main) continue;
    await db.insert(dailySleep).values({
      userId, source: main.source, day: main.day, sessionId: main.sessionKey.startsWith("id:") ? main.sessionKey.slice(3) : null,
      sleepStart: main.sleepStart, sleepEnd: main.sleepEnd, minutesAsleep: main.minutesAsleep,
      minutesAwake: main.minutesAwake, deepMinutes: main.deepMinutes, remMinutes: main.remMinutes,
      lightMinutes: main.lightMinutes, stagesJson: main.stagesJson, syncedAt: now,
    }).onConflictDoUpdate({target: [dailySleep.userId, dailySleep.source, dailySleep.day], set: {
      sessionId: main.sessionKey.startsWith("id:") ? main.sessionKey.slice(3) : null,
      sleepStart: main.sleepStart, sleepEnd: main.sleepEnd, minutesAsleep: main.minutesAsleep,
      minutesAwake: main.minutesAwake, deepMinutes: main.deepMinutes, remMinutes: main.remMinutes,
      lightMinutes: main.lightMinutes, stagesJson: main.stagesJson, syncedAt: now,
    }});
  }
}
