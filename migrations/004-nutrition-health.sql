CREATE TABLE nutrition_preference (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'Europe/London',
  preferred_energy_source text NOT NULL DEFAULT 'google' CHECK (preferred_energy_source IN ('google', 'manual', 'apple'))
);

CREATE TABLE calorie_target (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  effective_from date NOT NULL,
  calories integer NOT NULL CHECK (calories > 0 AND calories <= 20000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calorie_target_user_date_unique UNIQUE (user_id, effective_from)
);
CREATE INDEX calorie_target_user_idx ON calorie_target(user_id, effective_from DESC);

CREATE TABLE nutrition_day_status (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  day date NOT NULL,
  complete boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);

CREATE TABLE saved_food (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'food' CHECK (kind IN ('food', 'recipe', 'template')),
  name text NOT NULL,
  brand text NOT NULL DEFAULT '',
  barcode text,
  default_amount double precision NOT NULL DEFAULT 100 CHECK (default_amount > 0),
  default_unit text NOT NULL DEFAULT 'g' CHECK (default_unit IN ('g', 'ml', 'serving')),
  batch_cooked_grams double precision CHECK (batch_cooked_grams IS NULL OR batch_cooked_grams > 0),
  calories double precision CHECK (calories IS NULL OR calories >= 0),
  protein_g double precision CHECK (protein_g IS NULL OR protein_g >= 0),
  carbs_g double precision CHECK (carbs_g IS NULL OR carbs_g >= 0),
  fat_g double precision CHECK (fat_g IS NULL OR fat_g >= 0),
  fibre_g double precision CHECK (fibre_g IS NULL OR fibre_g >= 0),
  ingredients text NOT NULL DEFAULT '',
  cooking_method text NOT NULL DEFAULT '',
  items_json jsonb,
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX saved_food_user_idx ON saved_food(user_id, use_count DESC, name);

CREATE TABLE meal (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  local_day date NOT NULL,
  consumed_at timestamptz NOT NULL,
  name text NOT NULL,
  category text NOT NULL CHECK (category IN ('breakfast', 'lunch', 'dinner', 'snacks', 'drinks')),
  cooking_method text NOT NULL DEFAULT '',
  ingredients text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meal_user_idempotency_unique UNIQUE (user_id, idempotency_key)
);
CREATE INDEX meal_user_day_idx ON meal(user_id, local_day DESC, consumed_at ASC);

CREATE TABLE meal_item (
  id text PRIMARY KEY,
  meal_id text NOT NULL REFERENCES meal(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  name text NOT NULL,
  amount double precision CHECK (amount IS NULL OR amount > 0),
  unit text NOT NULL DEFAULT 'g' CHECK (unit IN ('g', 'ml', 'serving')),
  calories double precision CHECK (calories IS NULL OR calories >= 0),
  protein_g double precision CHECK (protein_g IS NULL OR protein_g >= 0),
  carbs_g double precision CHECK (carbs_g IS NULL OR carbs_g >= 0),
  fat_g double precision CHECK (fat_g IS NULL OR fat_g >= 0),
  fibre_g double precision CHECK (fibre_g IS NULL OR fibre_g >= 0),
  cal_min double precision CHECK (cal_min IS NULL OR cal_min >= 0),
  cal_max double precision CHECK (cal_max IS NULL OR cal_max >= 0),
  estimation_method text NOT NULL DEFAULT 'photo_estimate' CHECK (estimation_method IN ('weighed', 'measured', 'pack_label', 'recipe', 'photo_estimate')),
  saved_food_id text REFERENCES saved_food(id) ON DELETE SET NULL
);
CREATE INDEX meal_item_meal_idx ON meal_item(meal_id, sort_order);
CREATE INDEX meal_item_user_idx ON meal_item(user_id);

CREATE TABLE daily_energy (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  day date NOT NULL,
  source text NOT NULL CHECK (source IN ('google', 'manual', 'apple')),
  total_kcal double precision CHECK (total_kcal IS NULL OR total_kcal >= 0),
  active_kcal double precision CHECK (active_kcal IS NULL OR active_kcal >= 0),
  steps integer CHECK (steps IS NULL OR steps >= 0),
  weight_kg double precision CHECK (weight_kg IS NULL OR (weight_kg > 0 AND weight_kg <= 500)),
  complete boolean NOT NULL DEFAULT false,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source, day)
);
CREATE INDEX daily_energy_user_day_idx ON daily_energy(user_id, day DESC);

CREATE TABLE health_integration (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'apple')),
  credential text NOT NULL,
  status text NOT NULL DEFAULT 'connected',
  last_sync timestamptz,
  last_error text,
  PRIMARY KEY (user_id, provider)
);

CREATE TABLE mcp_audit (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  tool text NOT NULL,
  summary text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mcp_audit_user_created_idx ON mcp_audit(user_id, created_at DESC);

CREATE TABLE idempotency_record (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  key text NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
