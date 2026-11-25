ALTER TABLE nutrition_preference
  ADD COLUMN IF NOT EXISTS primary_recovery_source text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS primary_workout_source text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS auto_sync_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE nutrition_preference
  DROP CONSTRAINT IF EXISTS nutrition_preference_preferred_energy_source_check,
  ADD CONSTRAINT nutrition_preference_preferred_energy_source_check
    CHECK (preferred_energy_source IN ('google', 'apple', 'health_connect', 'samsung', 'garmin', 'whoop', 'oura', 'polar', 'suunto', 'strava', 'withings', 'manual'));

ALTER TABLE daily_energy
  DROP CONSTRAINT IF EXISTS daily_energy_source_check,
  ADD CONSTRAINT daily_energy_source_check
    CHECK (source IN ('google', 'apple', 'health_connect', 'samsung', 'garmin', 'whoop', 'oura', 'polar', 'suunto', 'strava', 'withings', 'manual'));

ALTER TABLE daily_recovery
  DROP CONSTRAINT IF EXISTS daily_recovery_source_check,
  ADD CONSTRAINT daily_recovery_source_check
    CHECK (source IN ('google', 'apple', 'health_connect', 'samsung', 'garmin', 'whoop', 'oura', 'polar', 'suunto', 'strava', 'withings', 'manual'));

ALTER TABLE daily_workout
  DROP CONSTRAINT IF EXISTS daily_workout_source_check,
  ADD CONSTRAINT daily_workout_source_check
    CHECK (source IN ('google', 'apple', 'health_connect', 'samsung', 'garmin', 'whoop', 'oura', 'polar', 'suunto', 'strava', 'withings', 'manual'));

ALTER TABLE health_integration
  ADD COLUMN IF NOT EXISTS external_user_id text,
  DROP CONSTRAINT IF EXISTS health_integration_provider_check,
  ADD CONSTRAINT health_integration_provider_check
    CHECK (provider IN ('google', 'apple', 'hevy', 'open_wearables'));

CREATE INDEX IF NOT EXISTS health_integration_provider_ext_user_idx
  ON health_integration (provider, external_user_id);
