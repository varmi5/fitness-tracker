---
name: fitness-nutrition-mcp
description: Log and review meals, personal nutrition targets, energy balance, body measurements, sleep sessions, vitals and synced workouts in the user's private FitnessTrackr account through MCP.
---

# FitnessTrackr

Use the authenticated user's database records for food, nutrition, energy, waist/weight,
sleep and workout questions. Keep the account, timezone, history and permissions separate
for every user. Never use another person's records or chat memory as the health record.

## Recall, dates and recent foods

- Retrieve `get_nutrition_settings` for the user's timezone and dated calorie/macro targets.
  Do not assume every user has the same calorie, protein or fibre target.
- Use `get_daily_log` for a date's meals and `get_nutrition_history` for inclusive local-date
  summaries. Historical targets apply on their effective dates. Missing values are unknown,
  not zero; an unreported meal does not establish that the user skipped it.
- Use `search_saved_foods` to find saved recipes, favourite/saved foods and frequently logged
  items before estimating a usual meal. The `frequent` results are not restricted to a week.
  For an explicitly requested recent week, inspect dated diary records as needed rather
  than claiming the saved-food search establishes when a food was eaten.
- Resolve “yesterday”, “before midnight” or “last night's dinner” in the user's timezone.
  Pass the explicit `day`/`time` or `consumedAt` when specified. Omitted timestamps mean now;
  do not move yesterday's food to today's diary because the conversation continued overnight.
- “The usual” can reuse a known nutrition basis. Confirm today's amount separately if it is
  unspecified; a repeat food does not automatically mean a repeat serving size.

## Food estimates and portions

1. Identify visible foods and the user's description. Prioritise supplied weights, package
   labels and known saved recipes over visual estimates.
2. Use `search_foods` for reference foods and portion choices. For a brand/product search,
   set `includeProducts: true`. This sends only a public food query to Open Food Facts;
   never include private health records, account identifiers or sensitive notes in that query.
3. Prefer returned portion options: an egg, slice, scoop, serving, bottle, can, grams or ml
   for drinks. Pass the returned food snapshot and `portionId` so the service scales it.
   Household and standard portions are estimates. Do not assume every food weighs 100g
   or that all liquids have a density of 1g/ml.
4. Account for oil, butter/ghee, sauces, dressings and cooking method. Explain assumptions
   and provide `calMin`/`calMax` when estimating portions or ingredients visually.
5. Use supported estimation methods: `weighed`, `measured`, `pack_label`, `recipe`,
   `photo_estimate` or `standard_portion`. Unknown nutrients remain null, not zero.
6. Ask one concise clarification when necessary. Prefer selectable portion choices if the
   chat host provides them; do not claim this server supplies a checkbox widget. Do not
   interrogate the user every time they repeat a familiar breakfast.

## Write only the intended meal

- An estimate or uploaded photo alone is not a request to save. Log when explicitly asked.
- Use `log_meal` with one or more items and a supported category: `breakfast`, `lunch`,
  `dinner`, `snacks` or `drinks`.
- Generate an intent-specific `idempotencyKey` and reuse it for retries of the same write.
  A genuinely additional meal/serving gets a new intent key; do not reuse a date-only key.
- For “add another spoon of dhal” or “two more dosas”, find the exact meal ID and use
  `update_meal` with `appendItems` and its own retry key. Do not create another meal
  merely to add items to an existing one.
- If a plausible duplicate exists and intent is unclear, ask whether this is an additional
  serving or a correction. The same dish on a different day is not automatically a duplicate.
- Use `delete_meal` only after confirmation of the exact meal, passing `confirmation: DELETE`.
- Report success only after the tool confirms a successful database write. Use the returned
  meal ID, saved items, totals, allowance and target. If the response is lost or ambiguous,
  inspect the diary or retry with the same key before creating anything new.
- A successful diary save is not proof of Google upload. `googleSync: {queued: true}` means
  pending work. Do not claim it reached Google, Apple Health or Bevel without confirmation.
  Imported records must not be manually re-logged as new local meals to force synchronisation.

## Targets, energy and reminders

- Keep remaining allowance (`target - intake`) separate from estimated energy deficit
  (`total expenditure - intake`). Active exercise calories are not TDEE. Do not add exercise
  or basal calories again to a provider total that already includes them.
- Use `get_energy_balance`, `get_body_measurements` or `get_fitness_summary` for recorded
  trends. Missing/incomplete days do not become zero-calorie days or confirmed rest days.
  Wearable expenditure, food-photo estimates and nutrition-quality scores are estimates.
- Use `preview_nutrition_targets` to propose a calorie/macro rebalance while retaining protein
  and fibre. Show the exact proposed plan and effective date. Save only after approval using
  `set_nutrition_targets` with `confirmation: APPLY`. Logging food never changes targets.
- Use `get_logging_reminders` to inspect this user's schedule, and `set_logging_reminders`
  with `confirmation: APPLY` only after their request. Settings writes need `fitness:read`
  and `fitness:settings:write`; request the missing permission only when that operation needs it.
- Phone reminders are opt-in FitnessTrackr PWA notifications: install the site on the phone
  and grant its notification permission. This plugin does not itself create a ChatGPT task
  or ChatGPT app notification. Never claim a reminder exists without tool confirmation.

## Sleep, vitals and workouts

- Call `get_health_history` for the requested local dates, normally seven days to start.
  This reads stored synced/imported records; it does not perform a live Google refresh.
  If data is stale or absent, explain that and direct the user to Google Health sync in Settings.
- Use `sleepSessions` for main sleep, naps and split sleep; preserve source, processing state,
  timestamps and classification provenance. Unknown stages, awake time and gaps are not zero.
- For detailed stage timing, request `includeStageIntervals: true` for at most 31 days.
  Stage summaries alone cannot establish sleep latency, continuity or an epoch-based SRI.
- Do not total overlapping provider sessions twice. Exclude future/ongoing or unprocessed
  sessions from completed-sleep analyses. A nap without an observed main sleep does not prove
  zero overnight sleep. Historical `sleepGoals` are user preferences, not measured sleep need.
- Treat deep/REM/light/awake stages as provider estimates, not clinical measurements. Do not
  invent ideal stage ratios, a Bevel score, illness probability, biological age or muscle-repair
  percentage. Explain any calculations and their coverage instead of inventing a missing score.
- Discuss workout type, times, duration, distance, HR and estimated energy where returned.
  Do not claim access to Hevy set-by-set details or workout editing unless a tool exposes them.
- The app's Body/Physique pages and onboarding do not imply MCP access to private check-in
  photos or profile editing. Available tools and permissions define access, not screen visibility.
- Health reads use existing `fitness:read` even in manual nutrition mode or when a card is hidden.
  Do not ask for a broader permission merely to read sleep/workout history.

## Connection and boundaries

The stable server is `https://fitness.hadamardsecurities.com/mcp`, using OAuth with automatic
client registration. Keep renewable meal logging on `fitness:read fitness:write offline_access`.
Never ask the user to paste passwords, integration keys or access tokens into chat. If an actual
missing scope prevents an approved action, explain that specific access request. Ordinary backend
updates do not justify reconnecting for every call. Each user authorises their own FitnessTrackr account.

Only advertise available tools. Do not imply that website-only features are MCP actions. Preserve
user privacy and export/deletion controls; provide fitness tracking context, not diagnosis or treatment.
