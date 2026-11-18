import { createHash, randomUUID } from "node:crypto";
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
  resolveActiveHomeDay,
  resolveLocalDateTime,
  resolveTargetForDay,
  sleepInput,
  summarizeItems,
  targetInput,
  templateInput,
  updateMealInput,
  type EnergySource,
  type EstimationMethod,
  type FoodUnit,
  type MealCategory,
  type NutrientSummary,
  type SleepRecord,
} from "./nutrition-model";
import {
  scoreDayNutrition,
  scoreMealNutrition,
  type DailyNutritionScore,
  type MealQualityScore,
} from "./nutrition-score";
import {
  calorieTarget,
  dailyEnergy,
  dailySleep,
  healthIntegration,
  idempotencyRecord,
  meal,
  mealItem,
  measurement,
  mcpAudit,
  nutritionDayStatus,
  nutritionPreference,
  profile,
  savedFood,
} from "./schema";
import { macroTargetInput, resolveMacroTargets, rebalanceMacros, type MacroPlan } from "./macro-targets";
import { queueGoogleMeal } from "./google-sync-queue";
import { foodMatchScore } from "./search-match";
import { catalogueById, searchCatalogue, catalogueCount } from "./food-catalogue";
import { calculateFoodPortion, type FoodDefinition } from "./food-catalogue-model";
import type { MealItemInput } from "./nutrition-model";
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
  portionLabel: string | null; portionId: string | null; gramWeight: number | null; millilitreVolume: number | null;
  foodSnapshot: FoodDefinition | null;
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
  qualityScore: MealQualityScore;
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
  macroTargets: MacroPlan;
  remaining: number | null;
  diaryComplete: boolean;
  meals: MealRecord[];
  totals: NutrientSummary;
  nutritionScore: DailyNutritionScore;
  preferredEnergySource: EnergySource;
  energy: EnergyRecord | null;
  energySources: Partial<Record<EnergySource, EnergyRecord>>;
  sleep: SleepRecord | null;
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

function mapSleepRow(row: typeof dailySleep.$inferSelect): SleepRecord {
  return {
    day: row.day,
    source: row.source as EnergySource,
    sessionId: row.sessionId,
    sleepStart: row.sleepStart?.toISOString() ?? null,
    sleepEnd: row.sleepEnd?.toISOString() ?? null,
    minutesAsleep: row.minutesAsleep,
    minutesAwake: row.minutesAwake,
    deepMinutes: row.deepMinutes,
    remMinutes: row.remMinutes,
    lightMinutes: row.lightMinutes,
    stages: Array.isArray(row.stagesJson) ? (row.stagesJson as SleepRecord["stages"]) : [],
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
      sleepRolloverEnabled: pref?.sleepRolloverEnabled ?? true,
      targets: targets.map((t) => ({ id: t.id, effectiveFrom: t.effectiveFrom, calories: t.calories, proteinG: t.proteinG, carbsG: t.carbsG, fatG: t.fatG, fibreG: t.fibreG })),
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
        portionLabel: item.portionLabel, portionId: item.portionId, gramWeight: item.gramWeight, millilitreVolume: item.millilitreVolume,
        foodSnapshot: item.foodSnapshot as FoodDefinition | null,
      });
      grouped.set(item.mealId, list);
    }
    return mealRows.map((m) => {
      const items = (grouped.get(m.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
      const totals = summarizeItems(items);
      const base = {
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
        totals,
      };
      return {
        ...base,
        qualityScore: scoreMealNutrition(base),
      };
    });
  }

  function pickSleep(
    bySource: Partial<Record<EnergySource, SleepRecord>>,
    preferred: EnergySource,
  ): SleepRecord | null {
    return bySource[preferred] ?? bySource.google ?? bySource.manual ?? null;
  }

  async function daily(day: string): Promise<DailyNutritionView> {
    const prefs = await getPrefs();
    const [mealRows, statusRows, energyRows, sleepRows] = await Promise.all([
      db.select().from(meal)
        .where(and(eq(meal.userId, userId), eq(meal.localDay, day)))
        .orderBy(asc(meal.consumedAt), asc(meal.createdAt)),
      db.select().from(nutritionDayStatus)
        .where(and(eq(nutritionDayStatus.userId, userId), eq(nutritionDayStatus.day, day))),
      db.select().from(dailyEnergy)
        .where(and(eq(dailyEnergy.userId, userId), eq(dailyEnergy.day, day))),
      db.select().from(dailySleep)
        .where(and(eq(dailySleep.userId, userId), eq(dailySleep.day, day))),
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
    const macroTargets = resolveMacroTargets(prefs.targets, day);
    const remaining = totals.calories == null ? target : round1(target - totals.calories);
    const diaryComplete = statusRows[0]?.complete ?? false;

    const energySources: Partial<Record<EnergySource, EnergyRecord>> = {};
    for (const row of energyRows) {
      energySources[row.source as EnergySource] = mapEnergyRow(row);
    }
    const energy = pickEnergy(energySources, prefs.preferredEnergySource, prefs.hasGoogleConnected);
    const sleepSources: Partial<Record<EnergySource, SleepRecord>> = {};
    for (const row of sleepRows) {
      sleepSources[row.source as EnergySource] = mapSleepRow(row);
    }
    const sleep = pickSleep(sleepSources, prefs.preferredEnergySource);

    const totalBurn = energy?.totalKcal ?? null;
    const deficit = totalBurn != null && totals.calories != null ? round1(totalBurn - totals.calories) : null;
    const provisional = !diaryComplete || totalBurn == null || totals.calories == null;
    const nutritionScore = scoreDayNutrition(meals, totals, target, macroTargets);

    return {
      day,
      timezone: prefs.timezone,
      target,
      macroTargets,
      remaining,
      diaryComplete,
      meals,
      totals,
      nutritionScore,
      preferredEnergySource: prefs.preferredEnergySource,
      energy,
      energySources,
      sleep,
      deficit,
      provisional,
    };
  }

  async function history(from: string, to: string) {
    historyInput.parse({ from, to });
    const prefs = await getPrefs();
    const [mealRows, itemRows, statusRows, energyRows, sleepRows] = await Promise.all([
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
      db.select().from(dailySleep)
        .where(and(eq(dailySleep.userId, userId), gte(dailySleep.day, from), lte(dailySleep.day, to))),
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

    const sleepByDay = new Map<string, Partial<Record<EnergySource, SleepRecord>>>();
    for (const s of sleepRows) {
      const entry = sleepByDay.get(s.day) ?? {};
      entry[s.source as EnergySource] = mapSleepRow(s);
      sleepByDay.set(s.day, entry);
    }

    const calendarDays = dayRange(from, to);
    const days = calendarDays.map((day) => {
      const dayMeals = mealsByDay.get(day) ?? [];
      const totals = summarizeItems(dayMeals.flatMap((m) => m.items));
      const target = resolveTargetForDay(prefs.targets, day);
      const macroTargets = resolveMacroTargets(prefs.targets, day);
      const remaining = totals.calories == null ? target : round1(target - totals.calories);
      const diaryComplete = statusByDay.get(day) ?? false;
      const sources = energyByDay.get(day) ?? {};
      const energy = pickEnergy(sources, prefs.preferredEnergySource, prefs.hasGoogleConnected);
      const sleep = pickSleep(sleepByDay.get(day) ?? {}, prefs.preferredEnergySource);
      const totalBurn = energy?.totalKcal ?? null;
      const deficit = totalBurn != null && totals.calories != null ? round1(totalBurn - totals.calories) : null;
      const provisional = !diaryComplete || totalBurn == null || totals.calories == null;
      const nutritionScore = scoreDayNutrition(dayMeals, totals, target, macroTargets);

      return {
        day,
        mealCount: dayMeals.length,
        totals,
        nutritionScore,
        target,
        macroTargets,
        remaining,
        diaryComplete,
        energy,
        sleep,
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
        nutritionScore: avg(completeNutritionDays.map((d) => d.nutritionScore.score)),
        expenditureKcal: avg(comparable.map((d) => d.energy?.totalKcal ?? null)),
        deficitKcal: avg(comparable.map((d) => d.deficit)),
        steps: avg(days.map((d) => d.energy?.steps ?? null)),
      },
      days,
      rolling,
    };
  }

  function materialize(item: MealItemInput): MealItemInput {
    if (item.foodSnapshot && item.portionId && item.amount != null) {
      return { ...item, ...calculateFoodPortion(item.foodSnapshot, item.portionId, item.amount), savedFoodId: item.savedFoodId };
    }
    return item;
  }
  const portionColumns = (item: MealItemInput) => ({ portionLabel: item.portionLabel ?? null, portionId: item.portionId ?? null,
    gramWeight: item.gramWeight ?? null, millilitreVolume: item.millilitreVolume ?? null, foodSnapshot: item.foodSnapshot ?? null });

  async function log(rawInput: z.input<typeof logMealInput>) {
    const parsed = logMealInput.parse(rawInput);
    const input = logMealInput.parse({ ...parsed, items: parsed.items.map(materialize) });
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
          ...portionColumns(item),
          savedFoodId: item.savedFoodId && ownedFoodIds.has(item.savedFoodId) ? item.savedFoodId : null,
        })),
      );

      if (ownedFoodIds.size) {
        await tx.update(savedFood)
          .set({ useCount: sql`${savedFood.useCount} + 1`, lastUsedAt: new Date() })
          .where(and(eq(savedFood.userId, userId), inArray(savedFood.id, [...ownedFoodIds])));
      }

      const googleSyncQueued = await queueGoogleMeal(tx, userId, id);
      return { id, day: resolvedDay, deduplicated: false, googleSyncQueued };
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
      googleSync: { queued: Boolean(mealId.googleSyncQueued) },
    };
  }

  async function update(rawInput: z.input<typeof updateMealInput>) {
    const parsed = updateMealInput.parse(rawInput);
    const input = updateMealInput.parse({ ...parsed, items: parsed.items?.map(materialize), appendItems: parsed.appendItems?.map(materialize) });
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
            ...portionColumns(item),
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
            ...portionColumns(item),
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

      const googleSyncQueued = await queueGoogleMeal(tx, userId, existing.id);
      return { id: existing.id, day: nextLocalDay, deduplicated: false, googleSyncQueued };
    });

    const dayView = await daily(updated.day);
    return {
      deduplicated: updated.deduplicated,
      meal: dayView.meals.find((m) => m.id === updated.id)!,
      dailyTotals: dayView.totals,
      dailyCalorieTarget: dayView.target,
      remainingCalorieAllowance: dayView.remaining,
      day: dayView,
      googleSync: { queued: Boolean(updated.googleSyncQueued) },
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
        ...portionColumns(item as MealItemInput),
      })),
    });
  }

  async function remove(id: string, confirmed = true) {
    if (!confirmed) throw new NutritionError("Deletion confirmation is required.");
    const deleted = await db.transaction(async (tx) => {
      await queueGoogleMeal(tx, userId, id, "delete");
      const [row] = await tx.delete(meal).where(and(eq(meal.userId, userId), eq(meal.id, id)))
        .returning({ id: meal.id, localDay: meal.localDay, name: meal.name });
      return row;
    });
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
      sleepRolloverEnabled: prefs.sleepRolloverEnabled,
      targetToday: resolveTargetForDay(prefs.targets, today),
      macroTargets: resolveMacroTargets(prefs.targets, today),
      targets: prefs.targets,
      defaultTarget: DEFAULT_CALORIE_TARGET,
    };
  }

  async function setTarget(rawInput: z.input<typeof targetInput>) {
    const input = targetInput.parse(rawInput);
    const prefs = await getPrefs();
    const current = resolveMacroTargets(prefs.targets, input.effectiveFrom);
    return setNutritionTargets({ ...rebalanceMacros({ ...current, calories: input.calories }), effectiveFrom: input.effectiveFrom });
  }

  async function setNutritionTargets(rawInput: z.input<typeof macroTargetInput>) {
    const input = macroTargetInput.parse(rawInput);
    await db.insert(calorieTarget).values({ id: randomUUID(), userId, ...input }).onConflictDoUpdate({
      target: [calorieTarget.userId, calorieTarget.effectiveFrom], set: { calories: input.calories, proteinG: input.proteinG, carbsG: input.carbsG, fatG: input.fatG, fibreG: input.fibreG },
    });
    return settings();
  }

  async function setPreferences(rawInput: z.input<typeof preferencesInput>) {
    const input = preferencesInput.parse(rawInput);
    const existing = await getPrefs();
    const sleepRolloverEnabled = input.sleepRolloverEnabled ?? existing.sleepRolloverEnabled;
    await db.insert(nutritionPreference).values({
      userId,
      timezone: input.timezone,
      preferredEnergySource: input.preferredEnergySource,
      googleTwoWaySync: input.googleTwoWaySync,
      sleepRolloverEnabled,
    }).onConflictDoUpdate({
      target: nutritionPreference.userId,
      set: {
        timezone: input.timezone,
        preferredEnergySource: input.preferredEnergySource,
        googleTwoWaySync: input.googleTwoWaySync,
        sleepRolloverEnabled,
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
    const digest = input.sourceId ? createHash("sha256").update(`${userId}|${input.sourceName}|${input.sourceId}`).digest("hex") : null;
    const stable = digest ? `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}` : null;
    const id = input.id && /^[0-9a-f-]{36}$/i.test(input.id) ? input.id : stable ?? randomUUID();
    if (input.id || stable) {
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
      isFavourite: input.isFavourite ?? false, foodType: input.foodType, portionsJson: input.portionsJson,
      defaultPortionId: input.defaultPortionId ?? null, sourceName: input.sourceName, sourceId: input.sourceId ?? null, sourceUrl: input.sourceUrl ?? null,
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
        isFavourite: input.isFavourite ?? savedFood.isFavourite, foodType: input.foodType, portionsJson: input.portionsJson,
        defaultPortionId: input.defaultPortionId ?? null, sourceName: input.sourceName, sourceId: input.sourceId ?? null, sourceUrl: input.sourceUrl ?? null,
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
      .orderBy(desc(savedFood.isFavourite), desc(savedFood.useCount), desc(savedFood.createdAt))
      .limit(1000);

    const matchingSaved = savedRows
      .filter((row) => Number.isFinite(foodMatchScore(`${row.name} ${row.brand} ${row.ingredients}`, clean)))
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
      portionLabel: string | null; portionId: string | null; gramWeight: number | null; millilitreVolume: number | null;
      foodSnapshot: FoodDefinition | null;
    }>();

    for (const item of recentItems) {
      const key = item.name.trim().toLowerCase();
      if (!Number.isFinite(foodMatchScore(key, clean))) continue;
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
          portionLabel: item.portionLabel, portionId: item.portionId, gramWeight: item.gramWeight, millilitreVolume: item.millilitreVolume,
          foodSnapshot: item.foodSnapshot as FoodDefinition | null,
        });
      }
    }

    const frequent = [...freqMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    const ukStaples = searchUkStaples(query, limit);

    const popular = ["cofid:12-940", "cofid:11-980", "cofid:12-313", "cofid:17-833", "cofid:17-169", "cofid:17-175", "cofid:17-377"];
    const catalogue = clean ? searchCatalogue(query, limit) : popular.map(catalogueById).filter((f): f is FoodDefinition => f != null);
    return { saved: matchingSaved, frequent, ukStaples, catalogue, catalogueCount };
  }

  async function favourite(id: string, isFavourite: boolean) {
    const [row] = await db.update(savedFood).set({ isFavourite }).where(and(eq(savedFood.id, id), eq(savedFood.userId, userId))).returning();
    if (!row) throw new NutritionError("Food not found.", 404);
    return row;
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
    const [energy, sleepRows] = await Promise.all([
      db.select().from(dailyEnergy).where(eq(dailyEnergy.userId, userId)).orderBy(desc(dailyEnergy.day)),
      db.select().from(dailySleep).where(eq(dailySleep.userId, userId)).orderBy(desc(dailySleep.day)),
    ]);
    return {
      preferences: prefs[0] ?? { timezone: DEFAULT_TIMEZONE, preferredEnergySource: "google", googleTwoWaySync: false, sleepRolloverEnabled: true },
      targets,
      dayStatuses: statuses,
      meals: await assembleMeals(meals, items, prefs[0]?.timezone ?? DEFAULT_TIMEZONE),
      savedFoods: saved,
      dailyEnergy: energy.map(mapEnergyRow),
      dailySleep: sleepRows.map(mapSleepRow),
    };
  }

  async function importHealthRecords(payload: {
    energyEntries?: z.input<typeof energyInput>[];
    sleepEntries?: z.input<typeof sleepInput>[];
    heightCm?: number | null;
    meals?: z.input<typeof logMealInput>[];
  }) {
    const prefs = await getPrefs();
    let energyImported = 0;
    let sleepImported = 0;
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

      for (const rawSleep of payload.sleepEntries ?? []) {
        const entry = sleepInput.parse(rawSleep);
        await tx.insert(dailySleep).values({
          userId,
          day: entry.day,
          source: entry.source,
          sessionId: entry.sessionId ?? null,
          sleepStart: entry.sleepStart ? new Date(entry.sleepStart) : null,
          sleepEnd: entry.sleepEnd ? new Date(entry.sleepEnd) : null,
          minutesAsleep: entry.minutesAsleep,
          minutesAwake: entry.minutesAwake ?? null,
          deepMinutes: entry.deepMinutes ?? null,
          remMinutes: entry.remMinutes ?? null,
          lightMinutes: entry.lightMinutes ?? null,
          stagesJson: entry.stagesJson,
          syncedAt: new Date(),
        }).onConflictDoUpdate({
          target: [dailySleep.userId, dailySleep.source, dailySleep.day],
          set: {
            sessionId: entry.sessionId ?? null,
            sleepStart: entry.sleepStart ? new Date(entry.sleepStart) : null,
            sleepEnd: entry.sleepEnd ? new Date(entry.sleepEnd) : null,
            minutesAsleep: entry.minutesAsleep,
            minutesAwake: entry.minutesAwake ?? null,
            deepMinutes: entry.deepMinutes ?? null,
            remMinutes: entry.remMinutes ?? null,
            lightMinutes: entry.lightMinutes ?? null,
            stagesJson: entry.stagesJson,
            syncedAt: new Date(),
          },
        });
        sleepImported += 1;
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
      sleepImported,
      weightsSynced,
      mealsImported,
      heightUpdated,
    };
  }

  async function homeSnapshot(calendarToday: string, options: { canReadSleep?: boolean } = {}) {
    const prefs = await getPrefs();
    const from = addDays(calendarToday, -29);
    const [mealRows, statusRows, energyRows, sleepRows] = await Promise.all([
      db.select().from(meal)
        .where(and(eq(meal.userId, userId), gte(meal.localDay, from), lte(meal.localDay, calendarToday)))
        .orderBy(asc(meal.localDay), asc(meal.consumedAt), asc(meal.createdAt)),
      db.select().from(nutritionDayStatus)
        .where(and(eq(nutritionDayStatus.userId, userId), gte(nutritionDayStatus.day, from), lte(nutritionDayStatus.day, calendarToday))),
      db.select().from(dailyEnergy)
        .where(and(eq(dailyEnergy.userId, userId), gte(dailyEnergy.day, from), lte(dailyEnergy.day, calendarToday))),
      db.select().from(dailySleep)
        .where(and(eq(dailySleep.userId, userId), gte(dailySleep.day, from), lte(dailySleep.day, calendarToday))),
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

    const sleepByDay = new Map<string, Partial<Record<EnergySource, SleepRecord>>>();
    const googleSleepDates = new Set<string>();
    for (const s of sleepRows) {
      const entry = sleepByDay.get(s.day) ?? {};
      entry[s.source as EnergySource] = mapSleepRow(s);
      sleepByDay.set(s.day, entry);
      if (s.source === "google") googleSleepDates.add(s.day);
    }

    const hasFitbitSleep = Boolean(options.canReadSleep) || googleSleepDates.size > 0;
    const { activeDay, waitingForSleep } = resolveActiveHomeDay({
      calendarToday,
      hasFitbitSleep,
      sleepRolloverEnabled: prefs.sleepRolloverEnabled,
      sleepDates: googleSleepDates,
    });
    const showSleep = hasFitbitSleep || sleepRows.length > 0;

    const calendarDays = dayRange(from, calendarToday);
    const days = calendarDays.map((day) => {
      const dayMeals = mealsByDay.get(day) ?? [];
      const totals = summarizeItems(dayMeals.flatMap((m) => m.items));
      const target = resolveTargetForDay(prefs.targets, day);
      const macroTargets = resolveMacroTargets(prefs.targets, day);
      const remaining = totals.calories == null ? target : round1(target - totals.calories);
      const diaryComplete = statusByDay.get(day) ?? false;
      const sources = energyByDay.get(day) ?? {};
      const energy = pickEnergy(sources, prefs.preferredEnergySource, prefs.hasGoogleConnected);
      const sleep = pickSleep(sleepByDay.get(day) ?? {}, prefs.preferredEnergySource);
      const totalBurn = energy?.totalKcal ?? null;
      const deficit = totalBurn != null && totals.calories != null ? round1(totalBurn - totals.calories) : null;
      const provisional = !diaryComplete || totalBurn == null || totals.calories == null;
      const nutritionScore = scoreDayNutrition(dayMeals, totals, target, macroTargets);

      return {
        day,
        mealCount: dayMeals.length,
        totals,
        nutritionScore,
        target,
        macroTargets,
        remaining,
        diaryComplete,
        energy,
        sleep,
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

    const activeSummary = days.find((d) => d.day === activeDay) ?? days[days.length - 1]!;
    const activeEnergySources = energyByDay.get(activeDay) ?? {};
    const dailyActive: DailyNutritionView = {
      day: activeDay,
      timezone: prefs.timezone,
      target: activeSummary.target,
      macroTargets: activeSummary.macroTargets,
      remaining: activeSummary.remaining,
      diaryComplete: activeSummary.diaryComplete,
      meals: mealsByDay.get(activeDay) ?? [],
      totals: activeSummary.totals,
      nutritionScore: activeSummary.nutritionScore,
      preferredEnergySource: prefs.preferredEnergySource,
      energy: activeSummary.energy,
      energySources: activeEnergySources,
      sleep: activeSummary.sleep,
      deficit: activeSummary.deficit,
      provisional: activeSummary.provisional,
    };

    const settingsView = {
      timezone: prefs.timezone,
      preferredEnergySource: prefs.preferredEnergySource,
      googleTwoWaySync: prefs.googleTwoWaySync,
      sleepRolloverEnabled: prefs.sleepRolloverEnabled,
      targetToday: resolveTargetForDay(prefs.targets, calendarToday),
      macroTargets: resolveMacroTargets(prefs.targets, calendarToday),
      targets: prefs.targets,
      defaultTarget: DEFAULT_CALORIE_TARGET,
    };

    return {
      calendarToday,
      activeDay,
      waitingForSleep,
      showSleep,
      settings: settingsView,
      daily: dailyActive,
      history30: {
        from,
        to: calendarToday,
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
          nutritionScore: avg(completeNutritionDays.map((d) => d.nutritionScore.score)),
          expenditureKcal: avg(comparable.map((d) => d.energy?.totalKcal ?? null)),
          deficitKcal: avg(comparable.map((d) => d.deficit)),
          steps: avg(days.map((d) => d.energy?.steps ?? null)),
        },
        days,
        rolling,
      },
    };
  }

  async function homeState(options: { canReadSleep?: boolean; timezone?: string } = {}) {
    const prefs = await getPrefs();
    const tz = options.timezone ?? prefs.timezone;
    const calendarToday = localDay(new Date(), tz);
    const from = addDays(calendarToday, -29);
    const sleepRows = await db
      .select({ day: dailySleep.day, source: dailySleep.source })
      .from(dailySleep)
      .where(and(eq(dailySleep.userId, userId), gte(dailySleep.day, from), lte(dailySleep.day, calendarToday)));
    const googleSleepDates = new Set(sleepRows.filter((s) => s.source === "google").map((s) => s.day));
    const hasFitbitSleep = Boolean(options.canReadSleep) || googleSleepDates.size > 0;
    const { activeDay, waitingForSleep } = resolveActiveHomeDay({
      calendarToday,
      hasFitbitSleep,
      sleepRolloverEnabled: prefs.sleepRolloverEnabled,
      sleepDates: googleSleepDates,
    });
    return {
      calendarToday,
      activeDay,
      waitingForSleep,
      showSleep: hasFitbitSleep || sleepRows.length > 0,
    };
  }

  async function syncToken(): Promise<string> {
    const res = await db.execute(sql`
      SELECT json_build_object(
        'meals', (SELECT json_build_object('n', count(*)::int, 'm', max(updated_at)::text) FROM meal WHERE user_id = ${userId}),
        'items', (SELECT count(*)::int FROM meal_item WHERE user_id = ${userId}),
        'statuses', (SELECT json_build_object('n', count(*)::int, 'c', coalesce(sum(case when complete then 1 else 0 end), 0)::int, 'm', max(updated_at)::text) FROM nutrition_day_status WHERE user_id = ${userId}),
        'targets', (SELECT json_build_object('n', count(*)::int, 'cal', coalesce(sum(calories), 0)::text, 'pro', coalesce(sum(protein_g), 0)::text, 'fib', coalesce(sum(fibre_g), 0)::text, 'm', max(created_at)::text) FROM calorie_target WHERE user_id = ${userId}),
        'prefs', (SELECT json_build_object('tz', timezone, 'src', preferred_energy_source, 'g', google_two_way_sync, 'sr', sleep_rollover_enabled) FROM nutrition_preference WHERE user_id = ${userId} LIMIT 1),
        'energy', (SELECT json_build_object('n', count(*)::int, 'm', max(synced_at)::text) FROM daily_energy WHERE user_id = ${userId}),
        'sleep', (SELECT json_build_object('n', count(*)::int, 'd', max(day)::text, 'm', max(synced_at)::text) FROM daily_sleep WHERE user_id = ${userId}),
        'health', (SELECT json_build_object('s', status, 'a', account_label, 'm', last_sync::text, 'e', last_error) FROM health_integration WHERE user_id = ${userId} AND provider = 'google' LIMIT 1),
        'audit', (SELECT json_build_object('n', count(*)::int, 'm', max(created_at)::text) FROM mcp_audit WHERE user_id = ${userId}),
        'measurements', (SELECT json_build_object('n', count(*)::int, 's', coalesce(sum(value), 0)::text) FROM measurement WHERE user_id = ${userId}),
        'reminders', (SELECT json_build_object('e', enabled, 't', times, 'm', updated_at::text) FROM reminder_preference WHERE user_id = ${userId} LIMIT 1)
      ) AS state
    `);
    const rows = Array.isArray(res) ? res : ((res as { rows?: { state?: unknown }[] }).rows ?? []);
    const state = rows[0]?.state ?? {};
    return createHash("sha256")
      .update(JSON.stringify({ userId, state }))
      .digest("hex")
      .slice(0, 24);
  }

  return {
    homeSnapshot,
    homeState,
    syncToken,
    daily,
    history,
    log,
    update,
    duplicate,
    remove,
    settings,
    setTarget,
    setNutritionTargets,
    setPreferences,
    markDay,
    saveEnergy,
    importHealthRecords,
    saveTemplate,
    removeTemplate,
    favourite,
    library,
    recentAudit,
    export: exportAll,
  };
}
