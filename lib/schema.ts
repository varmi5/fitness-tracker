import { boolean, date, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";

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
  preferredEnergySource: text("preferred_energy_source").notNull().default("google"),
  googleTwoWaySync: boolean("google_two_way_sync").notNull().default(false),
});

export const calorieTarget = pgTable("calorie_target", {
  id: text().primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  effectiveFrom: date("effective_from").notNull(),
  calories: integer().notNull(),
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
  weightKg: doublePrecision("weight_kg"),
  complete: boolean().notNull().default(false),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.source, t.day] }),
  index("daily_energy_user_day_idx").on(t.userId, t.day),
]);

export const healthIntegration = pgTable("health_integration", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  provider: text().notNull(),
  credential: text().notNull(),
  status: text().notNull().default("connected"),
  lastSync: timestamp("last_sync", { withTimezone: true }),
  lastError: text("last_error"),
}, (t) => [primaryKey({ columns: [t.userId, t.provider] })]);

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
