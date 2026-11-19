import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuthDatabase } from "./auth";
import { auditTool } from "./mcp-auth";
import { readScope, writeScope, settingsScope } from "./mcp-config";
import { NutritionError, nutritionData } from "./nutrition-data";
import { macroPlanInput, macroTargetInput, rebalanceMacros, macroEnergy } from "./macro-targets";
import { reminderInput, reminderSettings, saveReminderSettings } from "./reminders";
import { searchBrandedFoods } from "./branded-foods";
import { historyInput, logMealInput, updateMealInput } from "./nutrition-model";
import { getDatabase } from "./runtime";
import { trackerData } from "./tracker-data";

export function fitnessMcp(userId: string, permissions: string[], db: AuthDatabase = getDatabase()) {
  const server = new McpServer({ name: "mcp-logger", version: "1.1.3" }, { instructions: "For sleep schedules, recovery, vitals or workouts, call get_health_history for the user's requested local dates. These records remain accessible with fitness:read even when hidden on Home or manual tracking mode is selected. Use returned timezone, sources and syncedAt; missing data is unknown, not inactivity. Discuss trends as wearable estimates, not diagnoses. Do not assume a Bevel recovery score is supplied. Never change targets or health settings without explicit consent." });
  const data = nutritionData(db, userId);

  const format = (payload: unknown, isError = false) => ({
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    isError,
  });

  function register<T extends z.ZodType>(
    name: string,
    description: string,
    inputSchema: T,
    run: (input: z.output<T>) => Promise<unknown>,
    options: { write?: boolean; permission?: string; destructive?: boolean; summarize?: (input: z.output<T>) => string } = {},
  ) {
    const required = options.permission ?? (options.write ? writeScope : readScope);
    // Write responses include diary totals, so writes require both fitness:read and fitness:write.
    if (!permissions.includes(required) || (options.write && !permissions.includes(readScope))) return;

    server.registerTool(
      name,
      {
        description,
        inputSchema,
        annotations: {
          readOnlyHint: !options.write,
          destructiveHint: Boolean(options.destructive),
          idempotentHint: !options.destructive,
          openWorldHint: false,
        },
        _meta: {
          securitySchemes: [{ type: "oauth2", scopes: options.write ? [readScope, required] : [readScope] }],
        },
      },
      (async (raw: unknown) => {
        try {
          const parsed = inputSchema.parse(raw);
          const summary = options.summarize ? options.summarize(parsed) : "";
          if (!(await auditTool(userId, name, summary, db))) {
            return format({ error: "Rate limit reached. Try again in a minute." }, true);
          }
          return format(await run(parsed));
        } catch (error) {
          return format(
            {
              error:
                error instanceof NutritionError
                  ? error.message
                  : error instanceof z.ZodError
                    ? error.issues[0]?.message ?? "Invalid meal or date input."
                    : "FitnessTrackr could not complete that request.",
            },
            true,
          );
        }
      }) as never,
    );
  }

  const measurements = async ({ from, to }: z.output<typeof historyInput>) => {
    historyInput.parse({ from, to });
    const { readings, settings } = await trackerData(db, userId).snapshot();
    return {
      units: settings.units,
      heightCm: settings.heightCm,
      readings: readings.filter((row) => row.date >= from && row.date <= to && ["waist", "weight"].includes(row.metric)),
    };
  };

  const balance = async ({ from, to }: z.output<typeof historyInput>) => {
    const result = await data.history(from, to);
    const fitbit = result.trackingMode === "fitbit";
    return {
      from: result.from,
      to: result.to,
      timezone: result.timezone,
      trackingMode: result.trackingMode,
      preferredEnergySource: result.preferredEnergySource,
      totalDays: result.totalDays,
      completeNutritionDays: result.completeNutritionDays,
      comparableDays: result.comparableDays,
      missingDataDays: result.missingDataDays,
      cumulativeDeficit: result.cumulativeDeficit,
      averages: result.averages,
      days: result.days.map(({ day, mealCount, totals, target, remaining, diaryComplete, energy, sleep, recovery, workouts, deficit, provisional }) => ({
        day,
        mealCount,
        diaryComplete,
        intake: totals.calories,
        proteinG: totals.proteinG,
        target,
        remaining,
        totalExpenditureKcal: energy?.totalKcal ?? null,
        activeExpenditureKcal: energy?.activeKcal ?? null,
        steps: energy?.steps ?? null,
        activeZoneMinutes: fitbit ? (energy?.activeZoneMinutes ?? null) : null,
        distanceMeters: fitbit ? (energy?.distanceMeters ?? null) : null,
        floors: fitbit ? (energy?.floors ?? null) : null,
        energySource: energy?.source ?? null,
        sleep: fitbit ? sleep : null,
        recovery: fitbit ? recovery : null,
        workouts: fitbit ? workouts : [],
        deficit,
        provisional,
      })),
    };
  };

  register(
    "log_meal",
    "Save a meal with one or more food items and return the saved meal ID, items, meal totals, and updated daily totals/allowance. When day, time, and consumedAt are omitted, this logs at the exact current local date and time; pass explicit day/time/consumedAt whenever the user specifies a different time (e.g. yesterday or before sleep). Reuse the same idempotencyKey on retries.",
    logMealInput,
    (input) => data.log(input),
    { write: true, summarize: (input) => `${input.category}: ${input.name}` },
  );

  register(
    "get_daily_log",
    "Retrieve all meals, items, nutritional totals (including fibre), Nutrition Quality Score, target, remaining allowance, sleep/recovery/workouts (when Fitbit tracking mode is active), and energy balance for a local calendar date (YYYY-MM-DD).",
    z.object({ day: z.iso.date() }),
    ({ day }) => data.daily(day),
    { summarize: ({ day }) => day },
  );

  register(
    "get_nutrition_history",
    "Retrieve daily nutrition totals, period averages, and missing-data/completeness indicators for an inclusive date range.",
    historyInput,
    async ({ from, to }) => {
      const result = await data.history(from, to);
      return {
        from: result.from,
        to: result.to,
        timezone: result.timezone,
        trackingMode: result.trackingMode,
        totalDays: result.totalDays,
        completeNutritionDays: result.completeNutritionDays,
        missingDataDays: result.missingDataDays,
        averages: result.averages,
        days: result.days.map(({ day, mealCount, totals, target, remaining, diaryComplete }) => ({
          day,
          mealCount,
          diaryComplete,
          totals,
          target,
          remaining,
        })),
      };
    },
    { summarize: ({ from, to }) => `${from}..${to}` },
  );

  register(
    "update_meal",
    "Update an existing meal by ID, move its date/time, replace items, or append additional food items via appendItems without creating duplicate meals. Pass idempotencyKey on retries.",
    updateMealInput,
    (input) => data.update(input),
    { write: true, summarize: (input) => input.id },
  );

  register(
    "delete_meal",
    "Permanently delete a meal by ID. Only invoke after explicit user confirmation of the exact meal, passing confirmation='DELETE'.",
    z.object({ id: z.uuid(), confirmation: z.literal("DELETE") }),
    ({ id }) => data.remove(id, true),
    { write: true, destructive: true, summarize: ({ id }) => id },
  );

  register(
    "get_nutrition_settings",
    "Retrieve current and historical calorie targets, user timezone (default Europe/London), tracking mode (manual or fitbit), and preferred energy expenditure source.",
    z.object({}),
    () => data.settings(),
  );

  register(
    "search_saved_foods",
    "Search saved foods, homemade batch recipes, reusable meal templates, frequently logged foods, and UK CoFID staples.",
    z.object({ query: z.string().max(150).default(""), limit: z.number().int().min(1).max(30).default(10) }),
    ({ query, limit }) => data.library(query, limit),
    { summarize: ({ query }) => query || "all" },
  );

  register(
    "get_energy_balance",
    "Retrieve daily and historical calorie intake, total energy expenditure (TDEE), steps, and estimated calorie deficit (excluding incomplete days from cumulative totals).",
    historyInput,
    balance,
    { summarize: ({ from, to }) => `${from}..${to}` },
  );

  register(
    "get_body_measurements",
    "Retrieve waist (cm) and weight (kg) measurements for an inclusive date range.",
    historyInput,
    measurements,
    { summarize: ({ from, to }) => `${from}..${to}` },
  );

  register(
    "get_health_history",
    "Read this user's stored Google Health/imported sleep schedules and stages, recovery/vitals (resting HR, HRV, SpO2, respiration, temperature, VO2/body fat where available), and workouts (type, start/end, duration, calories, distance, heart rate, active-zone minutes where available) for inclusive local dates. Works independently of Home visibility or manual tracking mode. Returns sources, sync timestamps and missing-data indicators; no new Google permission or live refresh is performed.",
    historyInput,
    ({ from, to }) => data.healthHistory(from, to),
    { summarize: ({ from, to }) => `${from}..${to}` },
  );

  register(
    "get_fitness_summary",
    "Return a consolidated summary of nutrition, energy expenditure, calorie deficit, weight, and waist trends for an inclusive date range.",
    historyInput,
    async (input) => ({ ...(await balance(input)), measurements: await measurements(input) }),
    { summarize: ({ from, to }) => `${from}..${to}` },
  );

  register("search_foods", "Search your private foods and 2,887 UK reference foods. Set includeProducts=true to search public branded products by food or brand name. Portion options include eggs, slices, ml and label servings.",
    z.object({ query: z.string().min(1).max(100), includeProducts: z.boolean().default(false) }),
    async ({ query, includeProducts }) => ({ ...await data.library(query, 20), products: includeProducts ? await searchBrandedFoods(db, userId, query) : [] }));
  register("preview_nutrition_targets", "Preview rebalancing a nutrition target. Keeps protein and fibre fixed, adjusts carbs and fat to fit calories. This does not save anything.",
    macroPlanInput, async (input) => { const plan = rebalanceMacros(input); return { ...plan, macroEnergyKcal: macroEnergy(plan), saved: false }; });
  register("set_nutrition_targets", "Save the user's calorie, protein, carbohydrate, fat and fibre targets from an effective date. Only after the user explicitly requests or approves this exact plan. Confirm with confirmation='APPLY'. Never change targets while just logging a meal.",
    z.object({ targets: macroTargetInput, confirmation: z.literal("APPLY") }), ({ targets }) => data.setNutritionTargets(targets),
    { write: true, permission: settingsScope, summarize: ({ targets }) => `nutrition targets from ${targets.effectiveFrom}` });
  register("get_logging_reminders", "Retrieve this user's opt-in reminder schedule and today's diary status. Reports only recorded meals, not assumptions about meals eaten. Does not create a ChatGPT scheduled task.",
    z.object({}), async () => { const settings = await data.settings(); const day = new Intl.DateTimeFormat("en-CA", { timeZone: settings.timezone }).format(new Date()); const log = await data.daily(day); return { reminders: await reminderSettings(db, userId), day, diaryComplete: log.diaryComplete,
      loggedMeals: log.meals.map((meal) => ({ id: meal.id, name: meal.name, category: meal.category })), suggestions: log.diaryComplete ? [] : ["Log any meals or drinks you have not recorded."] }; });
  register("set_logging_reminders", "Change only this user's opt-in reminder schedule after their explicit request, with confirmation='APPLY'. Phone notification permission must be granted separately in the installed FitnessTrackr app.",
    z.object({ settings: reminderInput, confirmation: z.literal("APPLY") }), ({ settings }) => saveReminderSettings(db, userId, settings),
    { write: true, permission: settingsScope, summarize: () => "reminder schedule" });

  return server;
}
