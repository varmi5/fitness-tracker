import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { z } from "zod";
import type { AuthDatabase } from "./auth";
import {
  addDays,
  dayRange,
  DEFAULT_CALORIE_TARGET,
  DEFAULT_TIMEZONE,
  energyInput,
  historyInput,
  localDay,
  localTime,
  logMealInput,
  preferencesInput,
  resolveLocalDateTime,
  resolveTargetForDay,
  summarizeItems,
  targetInput,
  templateInput,
  updateMealInput,
  type EnergySource,
  type EstimationMethod,
  type FoodUnit,
  type MealCategory,
  type NutrientSummary,
} from "./nutrition-model";
import {
  calorieTarget,
  dailyEnergy,
  healthIntegration,
  idempotencyRecord,
  mcpAudit,
  meal,
  mealItem,
  measurement,
  nutritionDayStatus,
  nutritionPreference,
  profile,
  savedFood,
} from "./schema";
import { searchUkStaples } from "./uk-foods";

export { preferencesInput, targetInput };

export class NutritionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface MealItemRecord {
  id: string;
  mealId: string;
  sortOrder: number;
  name: string;
  amount: number | null;
  unit: FoodUnit;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fibreG: number | null;
  calMin: number | null;
  calMax: number | null;
  estimationMethod: EstimationMethod;
  savedFoodId: string | null;
}

export interface MealRecord {
  id: string;
  localDay: string;
  consumedAt: string;
  localTime: string;
  name: string;
  category: MealCategory;
  cookingMethod: string;
  ingredients: string;
  notes: string;
  items: MealItemRecord[];
  totals: NutrientSummary;
}

export interface EnergyRecord {
  day: string;
  source: EnergySource;
  totalKcal: number | null;
  activeKcal: number | null;
  steps: number | null;
  weightKg: number | null;
  complete: boolean;
  syncedAt: string;
}

export interface DailyNutritionView {
  day: string;
  timezone: string;
  target: number;
  remaining: number | null;
  diaryComplete: boolean;
  meals: MealRecord[];
  totals: NutrientSummary;
  preferredEnergySource: EnergySource;
  energy: EnergyRecord | null;
  energySources: Partial<Record<EnergySource, EnergyRecord>>;
  deficit: number | null;
  provisional: boolean;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function mapEnergyRow(row: typeof dailyEnergy.$inferSelect): EnergyRecord {
  return {
    day: row.day,
    source: row.source as EnergySource,
    totalKcal: row.totalKcal,
    activeKcal: row.activeKcal,
    steps: row.steps,
    weightKg: row.weightKg,
    complete: row.complete,
    syncedAt: row.syncedAt.toISOString(),
  };
}

export async function upsertSyncedWeight(
  tx: Parameters<Parameters<AuthDatabase["transaction"]>[0]>[0] | AuthDatabase,
  userId: string,
  date: string,
  weightKg: number,
  note: string,
) {
  const existing = await tx
    .select({ id: measurement.id, note: measurement.note })
    .from(measurement)
    .where(
      and(
        eq(measurement.userId, userId),
        eq(measurement.metric, "weight"),
        eq(measurement.side, "none"),
        eq(measurement.date, date),
      ),
    );
  const current = existing[0];
  if (!current) {
    await tx.insert(measurement).values({
      id: randomUUID(),
      userId,
      metric: "weight",
      side: "none",
      date,
      value: weightKg,
      note,
    });
    return;
  }
  if (!current.note || current.note.startsWith("Synced") || current.note.startsWith("Imported")) {
    await tx
      .update(measurement)
      .set({ value: weightKg, note })
      .where(eq(measurement.id, current.id));
  }
}

export function nutritionData(db: AuthDatabase, userId: string) {
  if (!userId) throw new Error("A session user ID is required.");

  async function getPrefs() {
    const [prefRows, targets, integrations] = await Promise.all([
      db.select().from(nutritionPreference).where(eq(nutritionPreference.userId, userId)),
      db.select().from(calorieTarget).where(eq(calorieTarget.userId, userId)).orderBy(desc(calorieTarget.effectiveFrom)),
      db.select({ provider: healthIntegration.provider, status: healthIntegration.status })
        .from(healthIntegration).where(eq(healthIntegration.userId, userId)),
    ]);
    const pref = prefRows[0];
    return {
      timezone: pref?.timezone ?? DEFAULT_TIMEZONE,
      preferredEnergySource: (pref?.preferredEnergySource ?? "google") as EnergySource,
      googleTwoWaySync: pref?.googleTwoWaySync ?? false,
      targets: targets.map((t) => ({ id: t.id, effectiveFrom: t.effectiveFrom, calories: t.calories })),
      hasGoogleConnected: integrations.some((i) => i.provider === "google"),
    };
  }

  function pickEnergy(
    bySource: Partial<Record<EnergySource, EnergyRecord>>,
    preferred: EnergySource,
    hasGoogleConnected: boolean,
  ): EnergyRecord | null {
    if (bySource[preferred]) return bySource[preferred]!;
    // If Google isn't connected yet and the user entered manual data, allow manual fallback cleanly.
    if (preferred === "google" && !hasGoogleConnected && bySource.manual) {
      return bySource.manual;
    }
    return null;
  }

  async function assembleMeals(
    mealRows: (typeof meal.$inferSelect)[],
    itemRows: (typeof mealItem.$inferSelect)[],
    timezone: string,
  ): Promise<MealRecord[]> {
    const grouped = new Map<string, MealItemRecord[]>();
    for (const item of itemRows) {
      const list = grouped.get(item.mealId) ?? [];
      list.push({
        id: item.id,
        mealId: item.mealId,
        sortOrder: item.sortOrder,
        name: item.name,
        amount: item.amount,
        unit: item.unit as FoodUnit,
        calories: item.calories,
        proteinG: item.proteinG,
        carbsG: item.carbsG,
        fatG: item.fatG,
        fibreG: item.fibreG,
        calMin: item.calMin,
        calMax: item.calMax,
        estimationMethod: item.estimationMethod as EstimationMethod,
        savedFoodId: item.savedFoodId,
      });
      grouped.set(item.mealId, list);
    }
    return mealRows.map((m) => {
      const items = (grouped.get(m.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
      return {
        id: m.id,
        localDay: m.localDay,
        consumedAt: m.consumedAt.toISOString(),
        localTime: localTime(m.consumedAt, timezone),
        name: m.name,
        category: m.category as MealCategory,
        cookingMethod: m.cookingMethod,
        ingredients: m.ingredients,
        notes: m.notes,
        items,
        totals: summarizeItems(items),
      };
    });
  }

  async function daily(day: string): Promise<DailyNutritionView> {
    const prefs = await getPrefs();
    const [mealRows, statusRows, energyRows] = await Promise.all([
      db.select().from(meal)
        .where(and(eq(meal.userId, userId), eq(meal.localDay, day)))
        .orderBy(asc(meal.consumedAt), asc(meal.createdAt)),
      db.select().from(nutritionDayStatus)
        .where(and(eq(nutritionDayStatus.userId, userId), eq(nutritionDayStatus.day, day))),
      db.select().from(dailyEnergy)
        .where(and(eq(dailyEnergy.userId, userId), eq(dailyEnergy.day, day))),
    ]);

    const itemRows = mealRows.length
      ? await db.select().from(mealItem)
          .where(and(eq(mealItem.userId, userId), inArray(mealItem.mealId, mealRows.map((m) => m.id))))
          .orderBy(asc(mealItem.sortOrder))
      : [];

    const meals = await assembleMeals(mealRows, itemRows, prefs.timezone);
    const allItems = meals.flatMap((m) => m.items);
    const totals = summarizeItems(allItems);
    const target = resolveTargetForDay(prefs.targets, day);
    const remaining = totals.calories == null ? target : round1(target - totals.calories);
    const diaryComplete = statusRows[0]?.complete ?? false;

    const energySources: Partial<Record<EnergySource, EnergyRecord>> = {};
    for (const row of energyRows) {
      energySources[row.source as EnergySource] = mapEnergyRow(row);
    }
    const energy = pickEnergy(energySources, prefs.preferredEnergySource, prefs.hasGoogleConnected);
    const totalBurn = energy?.totalKcal ?? null;
    const deficit = totalBurn != null && totals.calories != null ? round1(totalBurn - totals.calories) : null;
    const provisional = !diaryComplete || totalBurn == null || totals.calories == null;

    return {
      day,
      timezone: prefs.timezone,
      target,
      remaining,
      diaryComplete,
      meals,
      totals,
      preferredEnergySource: prefs.preferredEnergySource,
      energy,
      energySources,
      deficit,
      provisional,
    };
  }

  async function history(from: string, to: string) {
    historyInput.parse({ from, to });
    const prefs = await getPrefs();
    const [mealRows, itemRows, statusRows, energyRows] = await Promise.all([
      db.select().from(meal)
        .where(and(eq(meal.userId, userId), gte(meal.localDay, from), lte(meal.localDay, to)))
        .orderBy(asc(meal.localDay), asc(meal.consumedAt), asc(meal.createdAt)),
      db.select({ item: mealItem })
        .from(mealItem)
        .innerJoin(meal, eq(meal.id, mealItem.mealId))
        .where(and(eq(meal.userId, userId), gte(meal.localDay, from), lte(meal.localDay, to)))
        .orderBy(asc(mealItem.sortOrder)),
      db.select().from(nutritionDayStatus)
        .where(and(eq(nutritionDayStatus.userId, userId), gte(nutritionDayStatus.day, from), lte(nutritionDayStatus.day, to))),
      db.select().from(dailyEnergy)
        .where(and(eq(dailyEnergy.userId, userId), gte(dailyEnergy.day, from), lte(dailyEnergy.day, to))),
    ]);

    const meals = await assembleMeals(mealRows, itemRows.map((r) => r.item), prefs.timezone);
    const mealsByDay = new Map<string, MealRecord[]>();
    for (const m of meals) {
      const list = mealsByDay.get(m.localDay) ?? [];
      list.push(m);
      mealsByDay.set(m.localDay, list);
    }

    const statusByDay = new Map<string, boolean>();
    for (const s of statusRows) statusByDay.set(s.day, s.complete);

    const energyByDay = new Map<string, Partial<Record<EnergySource, EnergyRecord>>>();
    for (const e of energyRows) {
      const entry = energyByDay.get(e.day) ?? {};
      entry[e.source as EnergySource] = mapEnergyRow(e);
      energyByDay.set(e.day, entry);
    }

    const calendarDays = dayRange(from, to);
    const days = calendarDays.map((day) => {
      const dayMeals = mealsByDay.get(day) ?? [];
      const totals = summarizeItems(dayMeals.flatMap((m) => m.items));
      const target = resolveTargetForDay(prefs.targets, day);
      const remaining = totals.calories == null ? target : round1(target - totals.calories);
      const diaryComplete = statusByDay.get(day) ?? false;
      const sources = energyByDay.get(day) ?? {};
      const energy = pickEnergy(sources, prefs.preferredEnergySource, prefs.hasGoogleConnected);
      const totalBurn = energy?.totalKcal ?? null;
      const deficit = totalBurn != null && totals.calories != null ? round1(totalBurn - totals.calories) : null;
      const provisional = !diaryComplete || totalBurn == null || totals.calories == null;

      return {
        day,
        mealCount: dayMeals.length,
        totals,
        target,
        remaining,
        diaryComplete,
        energy,
        deficit,
        provisional,
      };
    });

    // Never count unlogged or incomplete days as 0-calorie days in averages or cumulative deficits.
    const completeNutritionDays = days.filter((d) => d.diaryComplete && d.totals.calories != null);
    const comparable = days.filter((d) => !d.provisional && d.deficit != null);

    const avg = (nums: (number | null)[]) => {
      const valid = nums.filter((n): n is number => n != null);
      return valid.length ? round1(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
    };

    const cumulativeDeficit = comparable.length
      ? round1(comparable.reduce((sum, d) => sum + (d.deficit ?? 0), 0))
      : null;

    // 7-day rolling series across the period (using only complete nutrition days for intake/protein,
    // and only comparable days for rolling deficit).
    const rolling = days.map((entry, idx) => {
      const startDay = addDays(entry.day, -6);
      const window = days.slice(Math.max(0, idx - 6), idx + 1).filter((w) => w.day >= startDay);
      const compWin = window.filter((w) => !w.provisional && w.deficit != null);
      const nutWin = window.filter((w) => w.diaryComplete && w.totals.calories != null);
      const burnWin = window.filter((w) => w.energy?.totalKcal != null);
      return {
        day: entry.day,
        rollingIntake7d: avg(nutWin.map((w) => w.totals.calories)),
        rollingProtein7d: avg(nutWin.map((w) => w.totals.proteinG)),
        rollingExpenditure7d: avg(burnWin.map((w) => w.energy?.totalKcal ?? null)),
        rollingDeficit7d: avg(compWin.map((w) => w.deficit)),
      };
    });

    return {
      from,
      to,
      timezone: prefs.timezone,
      preferredEnergySource: prefs.preferredEnergySource,
      totalDays: days.length,
      completeNutritionDays: completeNutritionDays.length,
      comparableDays: comparable.length,
      missingDataDays: days.length - comparable.length,
      cumulativeDeficit,
      averages: {
        calories: avg(completeNutritionDays.map((d) => d.totals.calories)),
        proteinG: avg(completeNutritionDays.map((d) => d.totals.proteinG)),
        carbsG: avg(completeNutritionDays.map((d) => d.totals.carbsG)),
        fatG: avg(completeNutritionDays.map((d) => d.totals.fatG)),
        fibreG: avg(completeNutritionDays.map((d) => d.totals.fibreG)),
        expenditureKcal: avg(comparable.map((d) => d.energy?.totalKcal ?? null)),
        deficitKcal: avg(comparable.map((d) => d.deficit)),
        steps: avg(days.map((d) => d.energy?.steps ?? null)),
      },
      days,
      rolling,
    };
  }

  async function log(rawInput: z.input<typeof logMealInput>) {
    const input = logMealInput.parse(rawInput);
    const prefs = await getPrefs();

    const mealId = await db.transaction(async (tx) => {
      if (input.idempotencyKey) {
        const [existing] = await tx.select({ id: meal.id, localDay: meal.localDay })
          .from(meal)
          .where(and(eq(meal.userId, userId), eq(meal.idempotencyKey, input.idempotencyKey)));
        if (existing) return { id: existing.id, day: existing.localDay, deduplicated: true };
      }

      const consumedAt = input.consumedAt
        ? new Date(input.consumedAt)
        : resolveLocalDateTime(
            input.day ?? localDay(new Date(), prefs.timezone),
            input.time ?? localTime(new Date(), prefs.timezone),
            prefs.timezone,
          );
      const resolvedDay = localDay(consumedAt, prefs.timezone);
      const id = randomUUID();

      await tx.insert(meal).values({
        id,
        userId,
        localDay: resolvedDay,
        consumedAt,
        name: input.name,
        category: input.category,
        cookingMethod: input.cookingMethod,
        ingredients: input.ingredients,
        notes: input.notes,
        idempotencyKey: input.idempotencyKey ?? null,
      });

      const validFoodIds = [...new Set(input.items.map((i) => i.savedFoodId).filter((v): v is string => Boolean(v)))];
      const ownedFoodIds = new Set<string>();
      if (validFoodIds.length) {
        const owned = await tx.select({ id: savedFood.id }).from(savedFood)
          .where(and(eq(savedFood.userId, userId), inArray(savedFood.id, validFoodIds)));
        for (const row of owned) ownedFoodIds.add(row.id);
      }

      await tx.insert(mealItem).values(
        input.items.map((item, idx) => ({
          id: randomUUID(),
          mealId: id,
          userId,
          sortOrder: idx,
          name: item.name,
          amount: item.amount ?? null,
          unit: item.unit,
          calories: item.calories ?? null,
          proteinG: item.proteinG ?? null,
          carbsG: item.carbsG ?? null,
          fatG: item.fatG ?? null,
          fibreG: item.fibreG ?? null,
          calMin: item.calMin ?? null,
          calMax: item.calMax ?? null,
          estimationMethod: item.estimationMethod,
          savedFoodId: item.savedFoodId && ownedFoodIds.has(item.savedFoodId) ? item.savedFoodId : null,
        })),
      );

      if (ownedFoodIds.size) {
        await tx.update(savedFood)
          .set({ useCount: sql`${savedFood.useCount} + 1`, lastUsedAt: new Date() })
          .where(and(eq(savedFood.userId, userId), inArray(savedFood.id, [...ownedFoodIds])));
      }

      return { id, day: resolvedDay, deduplicated: false };
    });

    const dayView = await daily(mealId.day);
    const savedMeal = dayView.meals.find((m) => m.id === mealId.id)!;
    return {
      deduplicated: mealId.deduplicated,
      meal: savedMeal,
      dailyTotals: dayView.totals,
      dailyCalorieTarget: dayView.target,
      remainingCalorieAllowance: dayView.remaining,
      day: dayView,
    };
  }

  async function update(rawInput: z.input<typeof updateMealInput>) {
    const input = updateMealInput.parse(rawInput);
    const prefs = await getPrefs();

    const updated = await db.transaction(async (tx) => {
      if (input.idempotencyKey) {
        const [prior] = await tx.select().from(idempotencyRecord)
          .where(and(eq(idempotencyRecord.userId, userId), eq(idempotencyRecord.key, `upd:${input.idempotencyKey}`)));
        if (prior) return { id: input.id, day: (prior.responseJson as { day: string }).day, deduplicated: true };
      }

      const [existing] = await tx.select().from(meal)
        .where(and(eq(meal.userId, userId), eq(meal.id, input.id)));
      if (!existing) throw new NutritionError("Meal not found.", 404);

      let nextConsumedAt = existing.consumedAt;
      let nextLocalDay = existing.localDay;
      if (input.consumedAt) {
        nextConsumedAt = new Date(input.consumedAt);
        nextLocalDay = localDay(nextConsumedAt, prefs.timezone);
      } else if (input.day || input.time) {
        const targetDay = input.day ?? existing.localDay;
        const targetTime = input.time ?? localTime(existing.consumedAt, prefs.timezone);
        nextConsumedAt = resolveLocalDateTime(targetDay, targetTime, prefs.timezone);
        nextLocalDay = localDay(nextConsumedAt, prefs.timezone);
      }

      await tx.update(meal).set({
        consumedAt: nextConsumedAt,
        localDay: nextLocalDay,
        name: input.name ?? existing.name,
        category: input.category ?? existing.category,
        cookingMethod: input.cookingMethod ?? existing.cookingMethod,
        ingredients: input.ingredients ?? existing.ingredients,
        notes: input.notes ?? existing.notes,
        updatedAt: new Date(),
      }).where(and(eq(meal.userId, userId), eq(meal.id, existing.id)));

      if (input.items) {
        await tx.delete(mealItem).where(and(eq(mealItem.userId, userId), eq(mealItem.mealId, existing.id)));
        await tx.insert(mealItem).values(
          input.items.map((item, idx) => ({
            id: randomUUID(),
            mealId: existing.id,
            userId,
            sortOrder: idx,
            name: item.name,
            amount: item.amount ?? null,
            unit: item.unit,
            calories: item.calories ?? null,
            proteinG: item.proteinG ?? null,
            carbsG: item.carbsG ?? null,
            fatG: item.fatG ?? null,
            fibreG: item.fibreG ?? null,
            calMin: item.calMin ?? null,
            calMax: item.calMax ?? null,
            estimationMethod: item.estimationMethod,
            savedFoodId: null,
          })),
        );
      } else if (input.appendItems?.length) {
        const currentItems = await tx.select({ sortOrder: mealItem.sortOrder })
          .from(mealItem)
          .where(and(eq(mealItem.userId, userId), eq(mealItem.mealId, existing.id)))
          .orderBy(desc(mealItem.sortOrder));
        const baseOrder = (currentItems[0]?.sortOrder ?? -1) + 1;
        await tx.insert(mealItem).values(
          input.appendItems.map((item, idx) => ({
            id: randomUUID(),
            mealId: existing.id,
            userId,
            sortOrder: baseOrder + idx,
            name: item.name,
            amount: item.amount ?? null,
            unit: item.unit,
            calories: item.calories ?? null,
            proteinG: item.proteinG ?? null,
            carbsG: item.carbsG ?? null,
            fatG: item.fatG ?? null,
            fibreG: item.fibreG ?? null,
            calMin: item.calMin ?? null,
            calMax: item.calMax ?? null,
            estimationMethod: item.estimationMethod,
            savedFoodId: null,
          })),
        );
      }

      if (input.idempotencyKey) {
        await tx.insert(idempotencyRecord).values({
          userId,
          key: `upd:${input.idempotencyKey}`,
          responseJson: { id: existing.id, day: nextLocalDay },
        }).onConflictDoNothing();
      }

      return { id: existing.id, day: nextLocalDay, deduplicated: false };
    });

    const dayView = await daily(updated.day);
    return {
      deduplicated: updated.deduplicated,
      meal: dayView.meals.find((m) => m.id === updated.id)!,
      dailyTotals: dayView.totals,
      dailyCalorieTarget: dayView.target,
      remainingCalorieAllowance: dayView.remaining,
      day: dayView,
    };
  }

  async function duplicate(id: string, targetDay?: string) {
    const prefs = await getPrefs();
    const [existing] = await db.select().from(meal).where(and(eq(meal.userId, userId), eq(meal.id, id)));
    if (!existing) throw new NutritionError("Meal not found.", 404);
    const items = await db.select().from(mealItem)
      .where(and(eq(mealItem.userId, userId), eq(mealItem.mealId, id)))
      .orderBy(asc(mealItem.sortOrder));

    const destDay = targetDay ?? existing.localDay;
    const destTime = localTime(existing.consumedAt, prefs.timezone);
    return log({
      day: destDay,
      time: destTime,
      name: existing.name,
      category: existing.category as MealCategory,
      cookingMethod: existing.cookingMethod,
      ingredients: existing.ingredients,
      notes: existing.notes,
      items: items.map((item) => ({
        name: item.name,
        amount: item.amount,
        unit: item.unit as FoodUnit,
        calories: item.calories,
        proteinG: item.proteinG,
        carbsG: item.carbsG,
        fatG: item.fatG,
        fibreG: item.fibreG,
        calMin: item.calMin,
        calMax: item.calMax,
        estimationMethod: item.estimationMethod as EstimationMethod,
        savedFoodId: item.savedFoodId,
      })),
    });
  }

  async function remove(id: string, confirmed = true) {
    if (!confirmed) throw new NutritionError("Deletion confirmation is required.");
    const [deleted] = await db.delete(meal)
      .where(and(eq(meal.userId, userId), eq(meal.id, id)))
      .returning({ id: meal.id, localDay: meal.localDay, name: meal.name });
    if (!deleted) throw new NutritionError("Meal not found.", 404);
    return { deleted, day: await daily(deleted.localDay) };
  }

  async function settings() {
    const prefs = await getPrefs();
    const today = localDay(new Date(), prefs.timezone);
    return {
      timezone: prefs.timezone,
      preferredEnergySource: prefs.preferredEnergySource,
      googleTwoWaySync: prefs.googleTwoWaySync,
      targetToday: resolveTargetForDay(prefs.targets, today),
      targets: prefs.targets,
      defaultTarget: DEFAULT_CALORIE_TARGET,
    };
  }

  async function setTarget(rawInput: z.input<typeof targetInput>) {
    const input = targetInput.parse(rawInput);
    await db.insert(calorieTarget).values({
      id: randomUUID(),
      userId,
      effectiveFrom: input.effectiveFrom,
      calories: input.calories,
    }).onConflictDoUpdate({
      target: [calorieTarget.userId, calorieTarget.effectiveFrom],
      set: { calories: input.calories },
    });
    return settings();
  }

  async function setPreferences(rawInput: z.input<typeof preferencesInput>) {
    const input = preferencesInput.parse(rawInput);
    await db.insert(nutritionPreference).values({
      userId,
      timezone: input.timezone,
      preferredEnergySource: input.preferredEnergySource,
      googleTwoWaySync: input.googleTwoWaySync,
    }).onConflictDoUpdate({
      target: nutritionPreference.userId,
      set: {
        timezone: input.timezone,
        preferredEnergySource: input.preferredEnergySource,
        googleTwoWaySync: input.googleTwoWaySync,
      },
    });
    return settings();
  }

  async function markDay(day: string, complete: boolean) {
    await db.insert(nutritionDayStatus).values({
      userId,
      day,
      complete,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [nutritionDayStatus.userId, nutritionDayStatus.day],
      set: { complete, updatedAt: new Date() },
    });
    return daily(day);
  }

  async function saveEnergy(rawInput: z.input<typeof energyInput>) {
    const input = energyInput.parse(rawInput);
    // Never silently add activeKcal to totalKcal if totalKcal is provided or omitted.
    await db.transaction(async (tx) => {
      await tx.insert(dailyEnergy).values({
        userId,
        day: input.day,
        source: input.source,
        totalKcal: input.totalKcal ?? null,
        activeKcal: input.activeKcal ?? null,
        steps: input.steps ?? null,
        weightKg: input.weightKg ?? null,
        complete: input.complete,
        syncedAt: new Date(),
      }).onConflictDoUpdate({
        target: [dailyEnergy.userId, dailyEnergy.source, dailyEnergy.day],
        set: {
          totalKcal: input.totalKcal ?? null,
          activeKcal: input.activeKcal ?? null,
          steps: input.steps ?? null,
          weightKg: input.weightKg ?? null,
          complete: input.complete,
          syncedAt: new Date(),
        },
      });
      if (input.weightKg != null) {
        await upsertSyncedWeight(tx, userId, input.day, input.weightKg, `Synced from ${input.source} energy`);
      }
    });
    return daily(input.day);
  }

  async function saveTemplate(rawInput: z.input<typeof templateInput>) {
    const input = templateInput.parse(rawInput);
    const id = input.id && /^[0-9a-f-]{36}$/i.test(input.id) ? input.id : randomUUID();
    if (input.id) {
      const [existing] = await db.select({ userId: savedFood.userId }).from(savedFood).where(eq(savedFood.id, id));
      if (existing && existing.userId !== userId) throw new NutritionError("Saved food not found.", 404);
    }
    const [row] = await db.insert(savedFood).values({
      id,
      userId,
      kind: input.kind,
      name: input.name,
      brand: input.brand,
      barcode: input.barcode ?? null,
      defaultAmount: input.defaultAmount,
      defaultUnit: input.defaultUnit,
      batchCookedGrams: input.batchCookedGrams ?? null,
      calories: input.calories ?? null,
      proteinG: input.proteinG ?? null,
      carbsG: input.carbsG ?? null,
      fatG: input.fatG ?? null,
      fibreG: input.fibreG ?? null,
      ingredients: input.ingredients,
      cookingMethod: input.cookingMethod,
      itemsJson: input.itemsJson ?? null,
    }).onConflictDoUpdate({
      target: savedFood.id,
      set: {
        kind: input.kind,
        name: input.name,
        brand: input.brand,
        barcode: input.barcode ?? null,
        defaultAmount: input.defaultAmount,
        defaultUnit: input.defaultUnit,
        batchCookedGrams: input.batchCookedGrams ?? null,
        calories: input.calories ?? null,
        proteinG: input.proteinG ?? null,
        carbsG: input.carbsG ?? null,
        fatG: input.fatG ?? null,
        fibreG: input.fibreG ?? null,
        ingredients: input.ingredients,
        cookingMethod: input.cookingMethod,
        itemsJson: input.itemsJson ?? null,
      },
    }).returning();
    return row;
  }

  async function removeTemplate(id: string) {
    const rows = await db.delete(savedFood)
      .where(and(eq(savedFood.userId, userId), eq(savedFood.id, id)))
      .returning({ id: savedFood.id });
    if (!rows.length) throw new NutritionError("Saved item not found.", 404);
    return { removed: true };
  }

  async function library(query = "", limit = 12) {
    const clean = query.trim().toLowerCase();
    const savedRows = await db.select().from(savedFood)
      .where(eq(savedFood.userId, userId))
      .orderBy(desc(savedFood.useCount), desc(savedFood.createdAt))
      .limit(100);

    const matchingSaved = savedRows
      .filter((row) => !clean || `${row.name} ${row.brand} ${row.ingredients}`.toLowerCase().includes(clean))
      .slice(0, limit);

    const recentRows = await db.select({ item: mealItem })
      .from(mealItem)
      .innerJoin(meal, eq(meal.id, mealItem.mealId))
      .where(eq(mealItem.userId, userId))
      .orderBy(desc(meal.consumedAt))
      .limit(200);
    const recentItems = recentRows.map((r) => r.item);

    const freqMap = new Map<string, {
      name: string;
      count: number;
      amount: number | null;
      unit: FoodUnit;
      calories: number | null;
      proteinG: number | null;
      carbsG: number | null;
      fatG: number | null;
      fibreG: number | null;
      estimationMethod: EstimationMethod;
    }>();

    for (const item of recentItems) {
      const key = item.name.trim().toLowerCase();
      if (clean && !key.includes(clean)) continue;
      const prev = freqMap.get(key);
      if (prev) {
        prev.count += 1;
      } else {
        freqMap.set(key, {
          name: item.name,
          count: 1,
          amount: item.amount,
          unit: item.unit as FoodUnit,
          calories: item.calories,
          proteinG: item.proteinG,
          carbsG: item.carbsG,
          fatG: item.fatG,
          fibreG: item.fibreG,
          estimationMethod: item.estimationMethod as EstimationMethod,
        });
      }
    }

    const frequent = [...freqMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    const ukStaples = searchUkStaples(query, limit);

    return { saved: matchingSaved, frequent, ukStaples };
  }

  async function recentAudit(limit = 20) {
    const rows = await db.select().from(mcpAudit)
      .where(eq(mcpAudit.userId, userId))
      .orderBy(desc(mcpAudit.createdAt))
      .limit(limit);
    return rows.map((r) => ({ id: r.id, tool: r.tool, summary: r.summary, createdAt: r.createdAt.toISOString() }));
  }

  async function exportAll() {
    const [prefs, targets, statuses] = await Promise.all([
      db.select().from(nutritionPreference).where(eq(nutritionPreference.userId, userId)),
      db.select().from(calorieTarget).where(eq(calorieTarget.userId, userId)).orderBy(desc(calorieTarget.effectiveFrom)),
      db.select().from(nutritionDayStatus).where(eq(nutritionDayStatus.userId, userId)).orderBy(desc(nutritionDayStatus.day)),
    ]);
    const [meals, items, saved] = await Promise.all([
      db.select().from(meal).where(eq(meal.userId, userId)).orderBy(desc(meal.consumedAt)),
      db.select().from(mealItem).where(eq(mealItem.userId, userId)).orderBy(asc(mealItem.sortOrder)),
      db.select().from(savedFood).where(eq(savedFood.userId, userId)),
    ]);
    const energy = await db.select().from(dailyEnergy).where(eq(dailyEnergy.userId, userId)).orderBy(desc(dailyEnergy.day));
    return {
      preferences: prefs[0] ?? { timezone: DEFAULT_TIMEZONE, preferredEnergySource: "google", googleTwoWaySync: false },
      targets,
      dayStatuses: statuses,
      meals: await assembleMeals(meals, items, prefs[0]?.timezone ?? DEFAULT_TIMEZONE),
      savedFoods: saved,
      dailyEnergy: energy.map(mapEnergyRow),
    };
  }

  async function importHealthRecords(payload: {
    energyEntries?: z.input<typeof energyInput>[];
    heightCm?: number | null;
    meals?: z.input<typeof logMealInput>[];
  }) {
    const prefs = await getPrefs();
    let energyImported = 0;
    let weightsSynced = 0;
    let mealsImported = 0;
    let heightUpdated = false;

    await db.transaction(async (tx) => {
      if (payload.heightCm != null && Number.isFinite(payload.heightCm) && payload.heightCm > 30 && payload.heightCm < 300) {
        const [prof] = await tx.select({ heightCm: profile.heightCm }).from(profile).where(eq(profile.userId, userId));
        if (!prof) {
          await tx.insert(profile).values({ userId, heightCm: Math.round(payload.heightCm * 10) / 10, units: "metric", goals: "" });
          heightUpdated = true;
        } else if (prof.heightCm == null) {
          await tx.update(profile).set({ heightCm: Math.round(payload.heightCm * 10) / 10 }).where(eq(profile.userId, userId));
          heightUpdated = true;
        }
      }

      for (const raw of payload.energyEntries ?? []) {
        const entry = energyInput.parse(raw);
        await tx.insert(dailyEnergy).values({
          userId,
          day: entry.day,
          source: entry.source,
          totalKcal: entry.totalKcal ?? null,
          activeKcal: entry.activeKcal ?? null,
          steps: entry.steps ?? null,
          weightKg: entry.weightKg ?? null,
          complete: entry.complete,
          syncedAt: new Date(),
        }).onConflictDoUpdate({
          target: [dailyEnergy.userId, dailyEnergy.source, dailyEnergy.day],
          set: {
            totalKcal: entry.totalKcal ?? null,
            activeKcal: entry.activeKcal ?? null,
            steps: entry.steps ?? null,
            weightKg: entry.weightKg ?? null,
            complete: entry.complete,
            syncedAt: new Date(),
          },
        });
        energyImported += 1;
        if (entry.weightKg != null) {
          await upsertSyncedWeight(tx, userId, entry.day, entry.weightKg, "Imported from Google Health / Fitbit");
          weightsSynced += 1;
        }
      }
    });

    for (const rawMeal of payload.meals ?? []) {
      const res = await log({
        ...rawMeal,
        idempotencyKey: rawMeal.idempotencyKey ?? `import:${rawMeal.day ?? ""}:${rawMeal.time ?? ""}:${rawMeal.name}`.slice(0, 120),
      });
      if (!res.deduplicated) mealsImported += 1;
    }

    return {
      timezone: prefs.timezone,
      energyImported,
      weightsSynced,
      mealsImported,
      heightUpdated,
    };
  }

  async function homeSnapshot(today: string) {
    const prefs = await getPrefs();
    const from = addDays(today, -29);
    const [mealRows, statusRows, energyRows] = await Promise.all([
      db.select().from(meal)
        .where(and(eq(meal.userId, userId), gte(meal.localDay, from), lte(meal.localDay, today)))
        .orderBy(asc(meal.localDay), asc(meal.consumedAt), asc(meal.createdAt)),
      db.select().from(nutritionDayStatus)
        .where(and(eq(nutritionDayStatus.userId, userId), gte(nutritionDayStatus.day, from), lte(nutritionDayStatus.day, today))),
      db.select().from(dailyEnergy)
        .where(and(eq(dailyEnergy.userId, userId), gte(dailyEnergy.day, from), lte(dailyEnergy.day, today))),
    ]);

    const itemRows = mealRows.length
      ? await db.select().from(mealItem)
          .where(and(eq(mealItem.userId, userId), inArray(mealItem.mealId, mealRows.map((m) => m.id))))
          .orderBy(asc(mealItem.sortOrder))
      : [];

    const meals = await assembleMeals(mealRows, itemRows, prefs.timezone);
    const mealsByDay = new Map<string, MealRecord[]>();
    for (const m of meals) {
      const list = mealsByDay.get(m.localDay) ?? [];
      list.push(m);
      mealsByDay.set(m.localDay, list);
    }

    const statusByDay = new Map<string, boolean>();
    for (const s of statusRows) statusByDay.set(s.day, s.complete);

    const energyByDay = new Map<string, Partial<Record<EnergySource, EnergyRecord>>>();
    for (const e of energyRows) {
      const entry = energyByDay.get(e.day) ?? {};
      entry[e.source as EnergySource] = mapEnergyRow(e);
      energyByDay.set(e.day, entry);
    }

    const calendarDays = dayRange(from, today);
    const days = calendarDays.map((day) => {
      const dayMeals = mealsByDay.get(day) ?? [];
      const totals = summarizeItems(dayMeals.flatMap((m) => m.items));
      const target = resolveTargetForDay(prefs.targets, day);
      const remaining = totals.calories == null ? target : round1(target - totals.calories);
      const diaryComplete = statusByDay.get(day) ?? false;
      const sources = energyByDay.get(day) ?? {};
      const energy = pickEnergy(sources, prefs.preferredEnergySource, prefs.hasGoogleConnected);
      const totalBurn = energy?.totalKcal ?? null;
      const deficit = totalBurn != null && totals.calories != null ? round1(totalBurn - totals.calories) : null;
      const provisional = !diaryComplete || totalBurn == null || totals.calories == null;

      return {
        day,
        mealCount: dayMeals.length,
        totals,
        target,
        remaining,
        diaryComplete,
        energy,
        deficit,
        provisional,
      };
    });

    const completeNutritionDays = days.filter((d) => d.diaryComplete && d.totals.calories != null);
    const comparable = days.filter((d) => !d.provisional && d.deficit != null);
    const avg = (nums: (number | null)[]) => {
      const valid = nums.filter((n): n is number => n != null);
      return valid.length ? round1(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
    };
    const cumulativeDeficit = comparable.length
      ? round1(comparable.reduce((sum, d) => sum + (d.deficit ?? 0), 0))
      : null;

    const rolling = days.map((entry, idx) => {
      const startDay = addDays(entry.day, -6);
      const window = days.slice(Math.max(0, idx - 6), idx + 1).filter((w) => w.day >= startDay);
      const compWin = window.filter((w) => !w.provisional && w.deficit != null);
      const nutWin = window.filter((w) => w.diaryComplete && w.totals.calories != null);
      const burnWin = window.filter((w) => w.energy?.totalKcal != null);
      return {
        day: entry.day,
        rollingIntake7d: avg(nutWin.map((w) => w.totals.calories)),
        rollingProtein7d: avg(nutWin.map((w) => w.totals.proteinG)),
        rollingExpenditure7d: avg(burnWin.map((w) => w.energy?.totalKcal ?? null)),
        rollingDeficit7d: avg(compWin.map((w) => w.deficit)),
      };
    });

    const todaySummary = days[days.length - 1]!;
    const todayEnergySources = energyByDay.get(today) ?? {};
    const dailyToday: DailyNutritionView = {
      day: today,
      timezone: prefs.timezone,
      target: todaySummary.target,
      remaining: todaySummary.remaining,
      diaryComplete: todaySummary.diaryComplete,
      meals: mealsByDay.get(today) ?? [],
      totals: todaySummary.totals,
      preferredEnergySource: prefs.preferredEnergySource,
      energy: todaySummary.energy,
      energySources: todayEnergySources,
      deficit: todaySummary.deficit,
      provisional: todaySummary.provisional,
    };

    const settingsView = {
      timezone: prefs.timezone,
      preferredEnergySource: prefs.preferredEnergySource,
      googleTwoWaySync: prefs.googleTwoWaySync,
      targetToday: todaySummary.target,
      targets: prefs.targets,
      defaultTarget: DEFAULT_CALORIE_TARGET,
    };

    return {
      settings: settingsView,
      daily: dailyToday,
      history30: {
        from,
        to: today,
        timezone: prefs.timezone,
        preferredEnergySource: prefs.preferredEnergySource,
        totalDays: days.length,
        completeNutritionDays: completeNutritionDays.length,
        comparableDays: comparable.length,
        missingDataDays: days.length - comparable.length,
        cumulativeDeficit,
        averages: {
          calories: avg(completeNutritionDays.map((d) => d.totals.calories)),
          proteinG: avg(completeNutritionDays.map((d) => d.totals.proteinG)),
          carbsG: avg(completeNutritionDays.map((d) => d.totals.carbsG)),
          fatG: avg(completeNutritionDays.map((d) => d.totals.fatG)),
          fibreG: avg(completeNutritionDays.map((d) => d.totals.fibreG)),
          expenditureKcal: avg(comparable.map((d) => d.energy?.totalKcal ?? null)),
          deficitKcal: avg(comparable.map((d) => d.deficit)),
          steps: avg(days.map((d) => d.energy?.steps ?? null)),
        },
        days,
        rolling,
      },
    };
  }

  return {
    homeSnapshot,
    daily,
    history,
    log,
    update,
    duplicate,
    remove,
    settings,
    setTarget,
    setPreferences,
    markDay,
    saveEnergy,
    importHealthRecords,
    saveTemplate,
    removeTemplate,
    library,
    recentAudit,
    export: exportAll,
  };
}
