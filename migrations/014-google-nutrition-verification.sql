ALTER TABLE meal ADD COLUMN origin text NOT NULL DEFAULT 'local';
ALTER TABLE meal ADD COLUMN source_record_name text;
-- Older file imports used this reserved prefix. Preserve them, but never echo them back.
UPDATE meal SET origin = 'health_import' WHERE idempotency_key LIKE 'import:%';
CREATE UNIQUE INDEX meal_user_source_record_idx ON meal(user_id, source_record_name) WHERE source_record_name IS NOT NULL;
ALTER TABLE google_meal_sync ADD COLUMN verified_at timestamptz;
UPDATE google_meal_sync SET state = 'paused', leased_until = NULL
WHERE action = 'upsert' AND EXISTS (
  SELECT 1 FROM meal WHERE meal.id = google_meal_sync.meal_id
  AND meal.user_id = google_meal_sync.user_id AND meal.origin = 'health_import'
);
