ALTER TABLE nutrition_preference
  ADD COLUMN IF NOT EXISTS bulk_mode boolean NOT NULL DEFAULT false;
