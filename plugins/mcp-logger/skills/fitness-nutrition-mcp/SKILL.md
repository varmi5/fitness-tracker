---
name: fitness-nutrition-mcp
description: Log and analyse meals, energy balance, body measurements, sleep schedules, recovery, vitals and workouts in the user's private FitnessTrackr account via MCP.
---

# Fitness Nutrition & Energy Balance Workflow

Use these rules whenever the user asks to estimate, log, update, review, or analyse food, calories, macros, TDEE/deficit, waist/weight trends, sleep schedules, recovery, vitals or workouts using the FitnessTrackr MCP server.

## 1. Photo & Meal Estimation Rules
When the user uploads a food photograph (with or without a text description):
1. **Identify every component** visible in the photo and mentioned by the user.
2. **Prioritise explicit facts first:**
   - Exact weights in grams/millilitres provided by the user (`estimationMethod: "weighed"`).
   - Packaging nutrition labels shown or quoted (`estimationMethod: "pack_label"`).
   - Previously saved foods or homemade batch recipes retrieved via `search_saved_foods` (`estimationMethod: "recipe"`).
3. **Estimate missing portions** using visible objects for scale (plate size, bowl depth, cutlery, hands, mugs) and mark them `estimationMethod: "photo_estimate"`.
4. **Account for hidden energy:** cooking oils, butter, ghee, creamy or sugary sauces, dressings, cheese toppings, and batters. List them in `cookingMethod` and `ingredients`.
5. **Include an uncertainty range** (`calMin` and `calMax`) whenever portion sizes or restaurant ingredients are visually estimated.
6. **Never invent zero for unknown nutrients:** if fibre (or another micronutrient/macro) is genuinely unknown, pass `null` rather than `0`.

## 2. Checking Existing Recipes & Avoiding Duplicates
- Before estimating a homemade dish (such as dhal, dosa, curry, porridge), call `search_saved_foods` to check if the user already has a saved food, batch recipe, or frequent item with known values.
- **Do not log automatically** unless the user asks to log (e.g., *"log this"*, *"save to breakfast"*, *"add to today"*). When they only ask *"how many calories is this?"*, present the breakdown and offer to log it.
- Always generate a deterministic or unique `idempotencyKey` per meal logging intent (for example `chatgpt-2026-11-17-breakfast-eggs`) and reuse that exact `idempotencyKey` if a tool call is retried so the same meal is never logged twice.

## 3. Logging, Appending & Editing Meals
- Use `log_meal` to create a meal with one or more `items` (`breakfast`, `lunch`, `dinner`, `snacks`, `drinks`).
- When the user adds to an existing meal in the same session or later (e.g., *"add another spoon of dhal"*, *"I had two more dosas"*):
  - First call `get_daily_log` (if you do not already have the exact `meal.id`).
  - Call `update_meal` with that `id` and `appendItems` (plus a unique `idempotencyKey`) instead of creating a duplicate meal.
- Only call `delete_meal` (`confirmation: "DELETE"`) after the user explicitly confirms deleting that specific named meal.
- **Never** claim a meal was saved, updated, or deleted unless the MCP tool returned a successful non-error response. Always report the actual saved meal ID, meal totals, updated daily intake, target, and remaining allowance returned by the database.

## 4. Database-First Recall & Energy Balance Honesty
- When asked *"what have I eaten today?"*, *"what are my macros?"*, or *"am I in a deficit?"*, **always** call `get_daily_log`, `get_nutrition_history`, `get_energy_balance`, or `get_fitness_summary` instead of relying on conversation memory.
- Keep **remaining allowance** (`dailyCalorieTarget - intake`) separate from **estimated calorie deficit** (`totalExpenditureKcal - intake`).
- Remember that wearable TDEE (`totalExpenditureKcal`) and photo-estimated food calories are both estimates. Never treat unlogged or incomplete days (`diaryComplete: false`) as zero-calorie days.
- Never silently alter the user's calorie target or timezone.

## 5. Foods, personal targets and reminders
- Use `search_foods` for UK reference foods and the user's foods. For brand names use `includeProducts: true`; only a public search query is sent to Open Food Facts, never a diary or account identifier. Ask before searching sensitive personal notes externally.
- Prefer explicit count/portion options (one egg, slice, scoop, bottle) or ml for drinks. Pass the returned food snapshot and portionId so the service scales nutrition consistently. Unknown values stay null; household and standard portion sizes remain estimates.
- Retrieve `get_nutrition_settings` before discussing targets. Use `preview_nutrition_targets` to rebalance carbs and fat while keeping protein and fibre fixed. Show the proposed calories, macros and effective date. Save with `set_nutrition_targets` and confirmation APPLY only when the user requests or approves that exact plan. Never change a target while simply logging food. If settings permission is missing, explain that the user must reconnect and consent to fitness:settings:write.
- Use `get_logging_reminders` to inspect only this user's schedule and recorded meals. Do not assume an unreported meal was skipped. Change reminders with `set_logging_reminders` and confirmation APPLY only when requested. Phone push additionally needs the user to install the PWA and enable notifications in Settings on their phone.
- Installing this plugin does not itself create ChatGPT notifications or a scheduled task. A ChatGPT task requires a separate explicit request and host support. Never claim a reminder/task exists without a successful tool confirmation. Phone push is delivered by FitnessTrackr, not ChatGPT.
- Meal write-back to Google Health is per user and opt-in. A database save confirms the local diary write only; queued Google sync is not confirmation that Google saved it.

## Sleep, recovery and workouts
- For questions about sleep schedules, bedtime/wake-time consistency, recovery, vitals or workouts, call `get_health_history` for the requested local dates (normally seven days for patterns). Never rely on chat memory as the health record.
- Health records remain available to MCP even when recovery/vitals are hidden on Home or manual nutrition tracking is selected. Home visibility does not revoke access.
- Use returned timezone, source and syncedAt. Distinguish missing/stale data from no activity; do not invent sleep sessions, workouts or a Bevel recovery score.
- Discuss recorded workout type, duration, distance, heart rate, active-zone minutes and estimated energy only where present. Keep active exercise calories separate from TDEE; never add exercise again to a total that includes it.
- Summarise sleep timing and consistency from actual timestamps; distinguish recorded sleep from time in bed. Wearable recovery/vitals are estimates, not diagnoses. Do not alter targets or settings unless explicitly requested.
