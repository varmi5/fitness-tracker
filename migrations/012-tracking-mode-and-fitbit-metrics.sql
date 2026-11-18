DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'nutrition_preference'
      AND column_name = 'tracking_mode'
  ) THEN
    ALTER TABLE nutrition_preference
      ADD COLUMN tracking_mode text NOT NULL DEFAULT 'manual'
      CHECK (tracking_mode IN ('manual', 'fitbit'));

    INSERT INTO nutrition_preference (user_id, tracking_mode, preferred_energy_source)
    SELECT DISTINCT hi.user_id, 'fitbit', 'google'
    FROM health_integration hi
    WHERE hi.provider = 'google'
    ON CONFLICT (user_id) DO UPDATE SET
      tracking_mode = CASE
        WHEN nutrition_preference.preferred_energy_source = 'google' THEN 'fitbit'
        ELSE 'manual'
      END;

    UPDATE nutrition_preference np
    SET tracking_mode = 'fitbit'
    WHERE np.tracking_mode <> 'fitbit'
      AND np.preferred_energy_source = 'google'
      AND (
        EXISTS (SELECT 1 FROM daily_energy de WHERE de.user_id = np.user_id AND de.source = 'google')
        OR EXISTS (SELECT 1 FROM daily_sleep ds WHERE ds.user_id = np.user_id AND ds.source = 'google')
      );

    UPDATE nutrition_preference np
    SET preferred_energy_source = 'manual'
    WHERE np.tracking_mode = 'manual'
      AND np.preferred_energy_source = 'google';
  END IF;
END $$;

ALTER TABLE daily_energy
  ADD COLUMN IF NOT EXISTS active_zone_minutes integer CHECK (active_zone_minutes IS NULL OR active_zone_minutes >= 0);

ALTER TABLE daily_energy
  ADD COLUMN IF NOT EXISTS distance_meters double precision CHECK (distance_meters IS NULL OR distance_meters >= 0);

ALTER TABLE daily_energy
  ADD COLUMN IF NOT EXISTS floors integer CHECK (floors IS NULL OR floors >= 0);

CREATE TABLE IF NOT EXISTS daily_recovery (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  day date NOT NULL,
  source text NOT NULL CHECK (source IN ('google', 'manual', 'apple')),
  resting_hr_bpm double precision CHECK (resting_hr_bpm IS NULL OR (resting_hr_bpm > 0 AND resting_hr_bpm <= 300)),
  hrv_rmssd_ms double precision CHECK (hrv_rmssd_ms IS NULL OR hrv_rmssd_ms >= 0),
  spo2_pct double precision CHECK (spo2_pct IS NULL OR (spo2_pct >= 0 AND spo2_pct <= 100)),
  respiratory_rate double precision CHECK (respiratory_rate IS NULL OR respiratory_rate > 0),
  skin_temp_delta_c double precision,
  vo2_max double precision CHECK (vo2_max IS NULL OR vo2_max > 0),
  body_fat_pct double precision CHECK (body_fat_pct IS NULL OR (body_fat_pct > 0 AND body_fat_pct <= 100)),
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source, day)
);
CREATE INDEX IF NOT EXISTS daily_recovery_user_day_idx ON daily_recovery(user_id, day);

CREATE TABLE IF NOT EXISTS daily_workout (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('google', 'manual', 'apple')),
  session_id text NOT NULL,
  day date NOT NULL,
  title text NOT NULL,
  exercise_type text NOT NULL DEFAULT '',
  start_time timestamptz,
  end_time timestamptz,
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  calories_kcal double precision CHECK (calories_kcal IS NULL OR calories_kcal >= 0),
  distance_meters double precision CHECK (distance_meters IS NULL OR distance_meters >= 0),
  avg_hr_bpm double precision CHECK (avg_hr_bpm IS NULL OR (avg_hr_bpm > 0 AND avg_hr_bpm <= 300)),
  active_zone_minutes integer CHECK (active_zone_minutes IS NULL OR active_zone_minutes >= 0),
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source, session_id)
);
CREATE INDEX IF NOT EXISTS daily_workout_user_day_idx ON daily_workout(user_id, day);
