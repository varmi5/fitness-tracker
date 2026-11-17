ALTER TABLE saved_food DROP CONSTRAINT saved_food_default_unit_check;
ALTER TABLE meal_item DROP CONSTRAINT meal_item_unit_check;
ALTER TABLE saved_food ADD CONSTRAINT saved_food_default_unit_check CHECK (default_unit IN ('g','kg','oz','ml','l','tsp','tbsp','cup','fl_oz','item','slice','piece','scoop','serving','bottle','can','pack'));
ALTER TABLE meal_item ADD CONSTRAINT meal_item_unit_check CHECK (unit IN ('g','kg','oz','ml','l','tsp','tbsp','cup','fl_oz','item','slice','piece','scoop','serving','bottle','can','pack'));
ALTER TABLE saved_food ADD COLUMN is_favourite boolean NOT NULL DEFAULT false;
ALTER TABLE saved_food ADD COLUMN food_type text NOT NULL DEFAULT 'food' CHECK (food_type IN ('food','drink'));
ALTER TABLE saved_food ADD COLUMN portions_json jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE saved_food ADD COLUMN default_portion_id text;
ALTER TABLE saved_food ADD COLUMN source_name text NOT NULL DEFAULT 'Custom';
ALTER TABLE saved_food ADD COLUMN source_id text;
ALTER TABLE saved_food ADD COLUMN source_url text;
CREATE INDEX saved_food_favourites_idx ON saved_food(user_id, is_favourite, name);
ALTER TABLE meal_item ADD COLUMN portion_label text;
ALTER TABLE meal_item ADD COLUMN portion_id text;
ALTER TABLE meal_item ADD COLUMN gram_weight double precision CHECK (gram_weight IS NULL OR gram_weight > 0);
ALTER TABLE meal_item ADD COLUMN millilitre_volume double precision CHECK (millilitre_volume IS NULL OR millilitre_volume > 0);
ALTER TABLE meal_item ADD COLUMN food_snapshot jsonb;
CREATE TABLE food_provider_cache (
  key text PRIMARY KEY,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX food_provider_cache_expiry_idx ON food_provider_cache(expires_at);
CREATE TABLE food_provider_rate (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);

ALTER TABLE meal_item DROP CONSTRAINT meal_item_estimation_method_check;
ALTER TABLE meal_item ADD CONSTRAINT meal_item_estimation_method_check CHECK (estimation_method IN ('weighed','measured','pack_label','recipe','photo_estimate','standard_portion'));
