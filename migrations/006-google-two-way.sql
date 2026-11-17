ALTER TABLE nutrition_preference
  ADD COLUMN IF NOT EXISTS google_two_way_sync boolean NOT NULL DEFAULT false;

ALTER TABLE meal
  ADD COLUMN IF NOT EXISTS google_datapoint_name text;
