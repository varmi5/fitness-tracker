import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AuthDatabase } from "./auth";
import { auditTool } from "./mcp-auth";
import { readScope, writeScope } from "./mcp-config";
import { NutritionError, nutritionData } from "./nutrition-data";
import { historyInput, logMealInput, updateMealInput } from "./nutrition-model";
import { getDatabase } from "./runtime";
import { trackerData } from "./tracker-data";

export function fitnessMcp(userId: string, permissions: string[], db: AuthDatabase = getDatabase()) {
  const server = new McpServer({ name: "fitness-tracker", version: "1.0.0" });
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
    options: { write?: boolean; destructive?: boolean; summarize?: (input: z.output<T>) => string } = {},
  ) {
    const required = options.write ? writeScope : readScope;
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
          securitySchemes: [{ type: "oauth2", scopes: options.write ? [readScope, writeScope] : [readScope] }],
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
                    : "Fitness could not complete that request.",
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
    return {
      from: result.from,
      to: result.to,
      timezone: result.timezone,
      preferredEnergySource: result.preferredEnergySource,
      totalDays: result.totalDays,
      completeNutritionDays: result.completeNutritionDays,
      comparableDays: result.comparableDays,
      missingDataDays: result.missingDataDays,
      cumulativeDeficit: result.cumulativeDeficit,
      averages: result.averages,
      days: result.days.map(({ day, mealCount, totals, target, remaining, diaryComplete, energy, deficit, provisional }) => ({
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
        energySource: energy?.source ?? null,
        deficit,
        provisional,
      })),
    };
  };

  register(
    "log_meal",
    "Save a meal with one or more food items and return the saved meal ID, items, meal totals, and updated daily totals/allowance. Reuse the same idempotencyKey on retries.",
    logMealInput,
    (input) => data.log(input),
    { write: true, summarize: (input) => `${input.category}: ${input.name}` },
  );

  register(
    "get_daily_log",
    "Retrieve all meals, items, nutritional totals, target, remaining allowance, and energy balance for a local calendar date (YYYY-MM-DD).",
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
    "Retrieve current and historical calorie targets, user timezone (default Europe/London), and preferred energy expenditure source.",
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
    "get_fitness_summary",
    "Return a consolidated summary of nutrition, energy expenditure, calorie deficit, weight, and waist trends for an inclusive date range.",
    historyInput,
    async (input) => ({ ...(await balance(input)), measurements: await measurements(input) }),
    { summarize: ({ from, to }) => `${from}..${to}` },
  );

  return server;
}
