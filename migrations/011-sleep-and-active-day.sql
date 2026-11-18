CREATE TABLE IF NOT EXISTS daily_sleep (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  day date NOT NULL,
  source text NOT NULL,
  session_id text,
  sleep_start timestamptz,
  sleep_end timestamptz,
  minutes_asleep integer NOT NULL,
  minutes_awake integer,
  deep_minutes integer,
  rem_minutes integer,
  light_minutes integer,
  stages_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, source, day)
);
CREATE INDEX IF NOT EXISTS daily_sleep_user_day_idx ON daily_sleep(user_id, day);

ALTER TABLE nutrition_preference
  ADD COLUMN IF NOT EXISTS sleep_rollover_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE health_integration
  ADD COLUMN IF NOT EXISTS account_label text;
