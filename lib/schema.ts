import type { PhysiqueProtection, PhysiqueShareProtection, PhysiqueVault } from "./physique-protection";
import type { SourceSettings } from "./data-source-settings";
import { sql } from "drizzle-orm";
import { boolean, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const user = pgTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  role: text().notNull().default("member"),
});

export const session = pgTable("session", {
  id: text().primaryKey(),
  token: text().notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text().primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text(),
  password: text(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const ownerSetup = pgTable("owner_setup", {
  id: integer().primaryKey(),
  consumed: boolean().notNull().default(false),
  attempts: integer().notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
});

export const passkey = pgTable("passkey", {
  id: text().primaryKey(), name: text(), publicKey: text("public_key").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  credentialID: text("credential_id").notNull().unique(), counter: integer().notNull(),
  deviceType: text("device_type").notNull(), backedUp: boolean("backed_up").notNull(),
  transports: text(), createdAt: timestamp("created_at"), aaguid: text(),
});

export const profile = pgTable("profile", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  heightCm: doublePrecision("height_cm"),
  units: text().notNull().default("metric"),
  goals: text().notNull().default(""),
  birthDate: date("birth_date"),
  biologicalSex: text("biological_sex"),
});

export const measurement = pgTable("measurement", {
  id: text().primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  metric: text().notNull(), side: text().notNull(), value: doublePrecision().notNull(),
  date: date().notNull(), note: text().notNull().default(""),
}, (table) => [
  unique("measurement_daily_unique").on(table.userId, table.metric, table.side, table.date),
]);

export const nutritionPreference = pgTable("nutrition_preference", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  timezone: text().notNull().default("Europe/London"),
  trackingMode: text("tracking_mode").notNull().default("manual"),
  preferredEnergySource: text("preferred_energy_source").notNull().default("google"),
  googleTwoWaySync: boolean("google_two_way_sync").notNull().default(false),
  sleepRolloverEnabled: boolean("sleep_rollover_enabled").notNull().default(true),
  bulkMode: boolean("bulk_mode").notNull().default(false),
  onboardingCompletedAt: timestamp("onboarding_completed_at", { withTimezone: true }),
  primaryRecoverySource: text("primary_recovery_source").notNull().default("auto"),
  sourceSettings: jsonb("source_settings").$type<SourceSettings>().notNull().default({}),
  primaryWorkoutSource: text("primary_workout_source").notNull().default("auto"),
  autoSyncEnabled: boolean("auto_sync_enabled").notNull().default(true),
});

export const calorieTarget = pgTable("calorie_target", {
  id: text().primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  effectiveFrom: date("effective_from").notNull(),
  calories: integer().notNull(),
  proteinG: doublePrecision("protein_g"), carbsG: doublePrecision("carbs_g"), fatG: doublePrecision("fat_g"), fibreG: doublePrecision("fibre_g"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("calorie_target_user_date_unique").on(t.userId, t.effectiveFrom),
  index("calorie_target_user_idx").on(t.userId, t.effectiveFrom),
]);

export const nutritionDayStatus = pgTable("nutrition_day_status", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  day: date().notNull(),
  complete: boolean().notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.day] })]);

export const savedFood = pgTable("saved_food", {
  id: text().primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text().notNull().default("food"),
  name: text().notNull(),
  brand: text().notNull().default(""),
  barcode: text(),
  defaultAmount: doublePrecision("default_amount").notNull().default(100),
  defaultUnit: text("default_unit").notNull().default("g"),
  batchCookedGrams: doublePrecision("batch_cooked_grams"),
  calories: doublePrecision(),
  proteinG: doublePrecision("protein_g"),
  carbsG: doublePrecision("carbs_g"),
  fatG: doublePrecision("fat_g"),
  fibreG: doublePrecision("fibre_g"),
  ingredients: text().notNull().default(""),
  cookingMethod: text("cooking_method").notNull().default(""),
  itemsJson: jsonb("items_json"),
  isFavourite: boolean("is_favourite").notNull().default(false),
  foodType: text("food_type").notNull().default("food"),
  portionsJson: jsonb("portions_json").notNull().default([]), defaultPortionId: text("default_portion_id"),
  sourceName: text("source_name").notNull().default("Custom"), sourceId: text("source_id"), sourceUrl: text("source_url"),
  useCount: integer("use_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("saved_food_user_idx").on(t.userId, t.useCount, t.name)]);

export const meal = pgTable("meal", {
  id: text().primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  localDay: date("local_day").notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }).notNull(),
  name: text().notNull(),
  category: text().notNull(),
  cookingMethod: text("cooking_method").notNull().default(""),
  ingredients: text().notNull().default(""),
  notes: text().notNull().default(""),
  idempotencyKey: text("idempotency_key"),
  googleDatapointName: text("google_datapoint_name"),
  origin: text().notNull().default("local"),
  sourceRecordName: text("source_record_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("meal_user_idempotency_unique").on(t.userId, t.idempotencyKey),
  index("meal_user_day_idx").on(t.userId, t.localDay, t.consumedAt),
]);

export const mealItem = pgTable("meal_item", {
  id: text().primaryKey(),
  mealId: text("meal_id").notNull().references(() => meal.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  name: text().notNull(),
  amount: doublePrecision(),
  unit: text().notNull().default("g"),
  calories: doublePrecision(),
  proteinG: doublePrecision("protein_g"),
  carbsG: doublePrecision("carbs_g"),
  fatG: doublePrecision("fat_g"),
  fibreG: doublePrecision("fibre_g"),
  calMin: doublePrecision("cal_min"),
  calMax: doublePrecision("cal_max"),
  estimationMethod: text("estimation_method").notNull().default("photo_estimate"),
  savedFoodId: text("saved_food_id").references(() => savedFood.id, { onDelete: "set null" }),
  portionLabel: text("portion_label"), portionId: text("portion_id"),
  gramWeight: doublePrecision("gram_weight"), millilitreVolume: doublePrecision("millilitre_volume"),
  foodSnapshot: jsonb("food_snapshot"),
}, (t) => [
  index("meal_item_meal_idx").on(t.mealId, t.sortOrder),
  index("meal_item_user_idx").on(t.userId),
]);

export const dailyEnergy = pgTable("daily_energy", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  day: date().notNull(),
  source: text().notNull(),
  totalKcal: doublePrecision("total_kcal"),
  activeKcal: doublePrecision("active_kcal"),
  steps: integer(),
  activeZoneMinutes: integer("active_zone_minutes"),
  distanceMeters: doublePrecision("distance_meters"),
  floors: integer(),
  weightKg: doublePrecision("weight_kg"),
  complete: boolean().notNull().default(false),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.source, t.day] }),
  index("daily_energy_user_day_idx").on(t.userId, t.day),
]);

export const dailySleep = pgTable("daily_sleep", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  day: date().notNull(),
  source: text().notNull(),
  sessionId: text("session_id"),
  sleepStart: timestamp("sleep_start", { withTimezone: true }),
  sleepEnd: timestamp("sleep_end", { withTimezone: true }),
  minutesAsleep: integer("minutes_asleep").notNull(),
  minutesAwake: integer("minutes_awake"),
  deepMinutes: integer("deep_minutes"),
  remMinutes: integer("rem_minutes"),
  lightMinutes: integer("light_minutes"),
  stagesJson: jsonb("stages_json").notNull().default([]),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.source, t.day] }),
  index("daily_sleep_user_day_idx").on(t.userId, t.day),
]);

// Raw sleep sessions preserve naps and split sleep; dailySleep remains the legacy main-night view.
export const sleepSession = pgTable("sleep_session", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  source: text().notNull(), sessionKey: text("session_key").notNull(), day: date().notNull(),
  sleepStart: timestamp("sleep_start", { withTimezone: true }),
  sleepEnd: timestamp("sleep_end", { withTimezone: true }),
  minutesAsleep: integer("minutes_asleep").notNull(), minutesAwake: integer("minutes_awake"),
  deepMinutes: integer("deep_minutes"), remMinutes: integer("rem_minutes"), lightMinutes: integer("light_minutes"),
  stagesJson: jsonb("stages_json").notNull().default([]),
  isMainSleep: boolean("is_main_sleep").notNull().default(false),
  processed: boolean(),
  classificationMethod: text("classification_method").notNull().default("legacy"),
  stageIntervalsJson: jsonb("stage_intervals_json").notNull().default([]),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.source, t.sessionKey] }), index("sleep_session_user_day_idx").on(t.userId, t.day)]);

export const sleepGoal = pgTable("sleep_goal", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  effectiveFrom: date("effective_from").notNull(), goalMinutes: integer("goal_minutes").notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.effectiveFrom] })]);

export const dailyRecovery = pgTable("daily_recovery", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  day: date().notNull(),
  source: text().notNull(),
  restingHrBpm: doublePrecision("resting_hr_bpm"),
  hrvRmssdMs: doublePrecision("hrv_rmssd_ms"),
  spo2Pct: doublePrecision("spo2_pct"),
  respiratoryRate: doublePrecision("respiratory_rate"),
  skinTempDeltaC: doublePrecision("skin_temp_delta_c"),
  vo2Max: doublePrecision("vo2_max"),
  bodyFatPct: doublePrecision("body_fat_pct"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.source, t.day] }),
  index("daily_recovery_user_day_idx").on(t.userId, t.day),
]);

export const dailyWorkout = pgTable("daily_workout", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  source: text().notNull(),
  sessionId: text("session_id").notNull(),
  day: date().notNull(),
  title: text().notNull(),
  exerciseType: text("exercise_type").notNull().default(""),
  startTime: timestamp("start_time", { withTimezone: true }),
  endTime: timestamp("end_time", { withTimezone: true }),
  durationSeconds: integer("duration_seconds"),
  caloriesKcal: doublePrecision("calories_kcal"),
  distanceMeters: doublePrecision("distance_meters"),
  avgHrBpm: doublePrecision("avg_hr_bpm"),
  activeZoneMinutes: integer("active_zone_minutes"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.source, t.sessionId] }),
  index("daily_workout_user_day_idx").on(t.userId, t.day),
]);

export const heartRateSample = pgTable("heart_rate_sample", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  source: text().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  bpm: doublePrecision().notNull(),
  day: date().notNull(),
  dataSource: text("data_source").notNull().default(""),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.source, t.recordedAt] }),
  index("heart_rate_sample_user_day_idx").on(t.userId, t.day, t.recordedAt),
]);

export const stepInterval = pgTable("step_interval", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  source: text().notNull(),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  steps: integer().notNull(),
  day: date().notNull(),
  dataSource: text("data_source").notNull().default(""),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.source, t.startTime, t.endTime] }),
  index("step_interval_user_day_idx").on(t.userId, t.day, t.startTime),
]);

export const hevyWorkout = pgTable("hevy_workout", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  hevyId: text("hevy_id").notNull(),
  day: date().notNull(),
  title: text().notNull(),
  description: text().notNull().default(""),
  startTime: timestamp("start_time", { withTimezone: true }).notNull(),
  endTime: timestamp("end_time", { withTimezone: true }).notNull(),
  durationSeconds: integer("duration_seconds"),
  source: text().notNull().default("hevy_csv"),
  matchedGoogleSessionId: text("matched_google_session_id"),
  avgHrBpm: doublePrecision("avg_hr_bpm"),
  hrSampleCount: integer("hr_sample_count").notNull().default(0),
  hrCoveragePct: integer("hr_coverage_pct"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.hevyId] }),
  index("hevy_workout_user_day_idx").on(t.userId, t.day, t.startTime),
]);

export const hevySet = pgTable("hevy_set", {
  id: text().primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  hevyId: text("hevy_id").notNull(),
  exerciseIndex: integer("exercise_index").notNull(),
  exerciseTitle: text("exercise_title").notNull(),
  exerciseTemplateId: text("exercise_template_id"),
  supersetId: integer("superset_id"),
  setIndex: integer("set_index").notNull(),
  setType: text("set_type").notNull().default("normal"),
  weightKg: doublePrecision("weight_kg"),
  reps: integer(),
  distanceMeters: doublePrecision("distance_meters"),
  durationSeconds: integer("duration_seconds"),
  rpe: doublePrecision(),
  notes: text().notNull().default(""),
}, (t) => [
  index("hevy_set_workout_idx").on(t.userId, t.hevyId, t.exerciseIndex, t.setIndex),
]);

export const trainingPreference = pgTable("training_preference", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  maxHrBpm: integer("max_hr_bpm").notNull().default(190),
  age: integer(),
  maxHrIsEstimated: boolean("max_hr_is_estimated").notNull().default(true),
  walkingEnabled: boolean("walking_enabled").notNull().default(true),
  walkingStepThreshold: integer("walking_step_threshold").notNull().default(10500),
  walkingSensitivity: text("walking_sensitivity").notNull().default("normal"),
  walkingMaxPoints: doublePrecision("walking_max_points").notNull().default(5),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const dailyStrain = pgTable("daily_strain", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  day: date().notNull(),
  algorithmVersion: text("algorithm_version").notNull(),
  overallStrain: doublePrecision("overall_strain"),
  cardioStrain: doublePrecision("cardio_strain"),
  muscularStrain: doublePrecision("muscular_strain"),
  cRaw: doublePrecision("c_raw").notNull().default(0),
  mRaw: doublePrecision("m_raw").notNull().default(0),
  walkingPoints: doublePrecision("walking_points").notNull().default(0),
  totalSteps: integer("total_steps"),
  excludedWorkoutSteps: integer("excluded_workout_steps"),
  eligibleSteps: integer("eligible_steps"),
  excessSteps: integer("excess_steps"),
  confidence: text().notNull().default("incomplete"),
  muscleLoadsJson: jsonb("muscle_loads_json").notNull().default({}),
  activitiesJson: jsonb("activities_json").notNull().default([]),
  settingsSnapshotJson: jsonb("settings_snapshot_json").notNull().default({}),
  computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.day] }),
  index("daily_strain_user_day_idx").on(t.userId, t.day),
]);

export const healthIntegration = pgTable("health_integration", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  provider: text().notNull(),
  connectionId: text("connection_id").notNull().default(sql`gen_random_uuid()::text`),
  credential: text().notNull(),
  accountLabel: text("account_label"),
  externalUserId: text("external_user_id"),
  mealSyncLeasedUntil: timestamp("meal_sync_leased_until", { withTimezone: true }),
  status: text().notNull().default("connected"),
  lastSync: timestamp("last_sync", { withTimezone: true }),
  lastError: text("last_error"),
  diagnosticsJson: jsonb("diagnostics_json").notNull().default({}),
}, (t) => [
  primaryKey({ columns: [t.userId, t.provider] }),
  index("health_integration_provider_ext_user_idx").on(t.provider, t.externalUserId),
]);

export const mcpAudit = pgTable("mcp_audit", {
  id: text().primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  tool: text().notNull(),
  summary: text().notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("mcp_audit_user_created_idx").on(t.userId, t.createdAt)]);

export const idempotencyRecord = pgTable("idempotency_record", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  key: text().notNull(),
  responseJson: jsonb("response_json").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.key] })]);

export * from "./mcp-schema";

export const foodProviderCache = pgTable("food_provider_cache", {
  key: text().primaryKey(), payload: jsonb().notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
export const foodProviderRate = pgTable("food_provider_rate", {
  key: text().primaryKey(), windowStart: timestamp("window_start", { withTimezone: true }).notNull(), attempts: integer().notNull().default(0),
});
export const googleMealSync = pgTable("google_meal_sync", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }), mealId: text("meal_id").notNull(),
  connectionId: text("connection_id").notNull(), manual: boolean().notNull().default(false), action: text().notNull(), payload: jsonb(), version: text().notNull(),
  targetName: text("target_name"), remoteName: text("remote_name"), cleanupNames: jsonb("cleanup_names").notNull().default([]), pendingNames: jsonb("pending_names").notNull().default([]),
  state: text().notNull().default("pending"), attempts: integer().notNull().default(0), nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  leasedUntil: timestamp("leased_until", { withTimezone: true }), lastError: text("last_error"), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  pendingPayloads: jsonb("pending_payloads").notNull().default({}),
}, (t) => [primaryKey({ columns: [t.userId, t.mealId] })]);
export const reminderPreference = pgTable("reminder_preference", {
 userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }), enabled: boolean().notNull().default(false),
 times: jsonb().notNull().default(["18:30"]), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const pushSubscription = pgTable("push_subscription", {
 id: text().primaryKey(), userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }), endpointHash: text("endpoint_hash").notNull().unique(),
 credential: text().notNull(), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
export const reminderDelivery = pgTable("reminder_delivery", {
 userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }), day: date().notNull(), time: text().notNull(),
 subscriptionId: text("subscription_id").notNull().references(() => pushSubscription.id, { onDelete: "cascade" }),
 state: text().notNull().default("pending"), attempts: integer().notNull().default(0), nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
 leasedUntil: timestamp("leased_until", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.userId, t.day, t.time, t.subscriptionId] })]);

export const physiqueVault = pgTable("physique_vault", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  vault: jsonb().$type<PhysiqueVault>().notNull(),
});

export const physiqueCheckin = pgTable("physique_checkin", {
  id: text().primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  day: date().notNull(),
  pose: text().notNull().default("front"),
  cadence: text().notNull().default("weekly"),
  photoData: text("photo_data").notNull(),
  protection: jsonb().$type<PhysiqueProtection>(),
  weightKg: doublePrecision("weight_kg"),
  bodyFatPct: doublePrecision("body_fat_pct"),
  note: text().notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("physique_checkin_user_day_idx").on(t.userId, t.day, t.createdAt),
]);

export const physiqueShare = pgTable("physique_share", {
  userId: text("user_id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
  token: text().notNull().unique(),
  checkinIds: text("checkin_ids").array().notNull(),
  protection: jsonb().$type<PhysiqueShareProtection>(),
});

export const feedbackReport = pgTable("feedback_report", {
  id: uuid().primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  kind: text({ enum: ["bug", "feature"] }).notNull(),
  title: text().notNull(),
  description: text().notNull(),
  area: text(),
  context: text(),
  status: text({ enum: ["new", "reviewing", "resolved"] }).notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  cannyLink: text("canny_link"),
  githubLink: text("github_link"),
}, (t) => [
  index("feedback_report_user_created_idx").on(t.userId, t.createdAt),
  index("feedback_report_created_idx").on(t.createdAt, t.id),
]);
