-- Preserve the snapshot for a write whose response was lost, including across edits/deletes.
ALTER TABLE google_meal_sync ADD COLUMN pending_payloads jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE health_integration ADD COLUMN meal_sync_leased_until timestamptz;
UPDATE google_meal_sync SET pending_payloads = (
  SELECT coalesce(jsonb_object_agg(name, google_meal_sync.payload), '{}'::jsonb)
  FROM jsonb_array_elements_text(pending_names) AS name
) WHERE payload IS NOT NULL;
