import type { InitialAppData } from "../app/types";

export type StartupCacheUpdate = (current: InitialAppData) => Partial<InitialAppData> | null;
type Field = keyof InitialAppData;
const dayFields = new Set<Field>(["daily", "strain", "recoveryInsights", "pulseInsights"]);

export function createStartupCache() {
  let current: InitialAppData | null = null;
  let revision = 0;
  let fieldRevisions: Partial<Record<Field, number>> = {};
  return {
    get current() { return current; },
    get revision() { return revision; },
    seed(snapshot: InitialAppData | null) {
      current = snapshot;
      fieldRevisions = {};
      revision++;
    },
    update(update: StartupCacheUpdate) {
      if (!current) return null;
      const patch = update(current);
      if (!patch) return null;
      revision++;
      for (const key of Object.keys(patch) as Field[]) fieldRevisions[key] = revision;
      current = { ...current, ...patch };
      return current;
    },
    refresh(snapshot: InitialAppData, startedAt: number) {
      const latest = current;
      if (!latest || latest.userId !== snapshot.userId) {
        current = snapshot;
        fieldRevisions = {};
        return snapshot;
      }
      const sameDate = latest.activeDay === snapshot.activeDay;
      const updates = (Object.keys(fieldRevisions) as Field[])
        .filter((key) => fieldRevisions[key]! > startedAt && (sameDate || !dayFields.has(key)))
        .map((key) => [key, latest[key]]);
      current = { ...snapshot, ...Object.fromEntries(updates) };
      return current;
    },
  };
}
