ALTER TABLE nutrition_preference ADD COLUMN IF NOT EXISTS source_settings jsonb NOT NULL DEFAULT '{}';
