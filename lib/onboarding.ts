export interface ActivityLevelOption {
  id: string;
  label: string;
  multiplier: number;
  detail: string;
}

export const ACTIVITY_LEVELS: readonly ActivityLevelOption[] = [
  { id: "sedentary", label: "Sedentary", multiplier: 1.2, detail: "Desk job, under ~5k steps/day" },
  { id: "light", label: "Lightly active", multiplier: 1.375, detail: "1–3 workouts/wk or ~6–8k steps" },
  { id: "moderate", label: "Moderately active", multiplier: 1.55, detail: "3–5 workouts/wk or ~8–11k steps" },
  { id: "very", label: "Very active", multiplier: 1.725, detail: "6–7 hard sessions/wk or active job" },
  { id: "athlete", label: "Athlete", multiplier: 1.9, detail: "Two-a-day training or heavy physical work" },
];

export const CHATGPT_MCP_INSTRUCTIONS = `When I upload a food photo:
1. Search my saved recipes/foods first via search_saved_foods.
2. Prioritise weights (g/ml) and packet labels I give; estimate missing portions using objects for scale and account for oils, sauces, and cooking methods with a calMin/calMax uncertainty range.
3. Leave unknown micronutrients (such as fibre) as null rather than 0.
4. Only log when I ask, using log_meal with a unique idempotencyKey, and report the saved ID and database totals.
5. For "add another spoon/item", call update_meal with appendItems instead of creating a duplicate meal.`;

export function estimateMifflinTdee(input: {
  weightKg: number;
  heightCm: number;
  ageYears: number;
  sex: "male" | "female" | "other";
  activityMultiplier: number;
}): { bmr: number; tdee: number } | null {
  const { weightKg, heightCm, ageYears, sex, activityMultiplier } = input;
  if (
    !Number.isFinite(weightKg) ||
    !Number.isFinite(heightCm) ||
    !Number.isFinite(ageYears) ||
    !Number.isFinite(activityMultiplier)
  ) {
    return null;
  }
  if (weightKg < 25 || weightKg > 350 || heightCm < 100 || heightCm > 250 || ageYears < 13 || ageYears > 100) {
    return null;
  }
  if (activityMultiplier < 1 || activityMultiplier > 2.5) {
    return null;
  }
  const offset = sex === "male" ? 5 : sex === "female" ? -161 : -78;
  const rawBmr = 10 * weightKg + 6.25 * heightCm - 5 * ageYears + offset;
  const bmr = Math.round(rawBmr);
  const tdee = Math.round(rawBmr * activityMultiplier);
  return { bmr, tdee };
}

export function buildChatGptTdeePrompt(input: {
  weightKg?: string;
  heightCm?: string;
  ageYears?: string;
  sex?: string;
  activityLabel?: string;
  goal?: "cut" | "maintain" | "bulk";
  wearableNote?: string;
}): string {
  const stats: string[] = [];
  if (input.ageYears?.trim()) stats.push(`Age: ${input.ageYears.trim()}`);
  if (input.sex?.trim()) stats.push(`Sex: ${input.sex.trim()}`);
  if (input.heightCm?.trim()) stats.push(`Height: ${input.heightCm.trim()} cm`);
  if (input.weightKg?.trim()) stats.push(`Weight: ${input.weightKg.trim()} kg`);
  if (input.activityLabel?.trim()) stats.push(`Activity: ${input.activityLabel.trim()}`);
  const statsLine = stats.length > 0 ? stats.join(", ") : "Age: [your age], Sex: [M/F], Height: [cm], Weight: [kg]";
  const goalText =
    input.goal === "bulk"
      ? "a lean bulk (+200 to +300 kcal surplus)"
      : input.goal === "maintain"
        ? "body weight maintenance"
        : "steady fat loss (-300 to -500 kcal deficit)";
  const wearableLine = input.wearableNote?.trim()
    ? `Wearable data: ${input.wearableNote.trim()}.`
    : "If I share Apple Health (Resting Energy + Active Energy from the last 14 days), Garmin, or my average daily steps and gym sessions, factor that in carefully.";

  return [
    "Help me set up my daily calories and macros for FitnessTrackr.",
    `My stats: ${statsLine}.`,
    `Goal: ${goalText}.`,
    wearableLine,
    "Please give me:",
    "1. My estimated maintenance TDEE (kcal/day) as a single realistic number to enter as Manual TDEE.",
    "2. My recommended daily calorie target and grams of Protein, Carbs, Fat, and Fibre.",
    "3. Keep the summary concise so I can copy the numbers straight into FitnessTrackr.",
  ].join("\n");
}
