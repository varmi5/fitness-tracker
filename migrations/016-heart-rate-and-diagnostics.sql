CREATE TABLE IF NOT EXISTS heart_rate_sample (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  source text NOT NULL,
  recorded_at timestamptz NOT NULL,
  bpm double precision NOT NULL,
  day date NOT NULL,
  data_source text NOT NULL DEFAULT '',
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source, recorded_at)
);
CREATE INDEX IF NOT EXISTS heart_rate_sample_user_day_idx ON heart_rate_sample (user_id, day, recorded_at);

CREATE TABLE IF NOT EXISTS step_interval (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  source text NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  steps integer NOT NULL,
  day date NOT NULL,
  data_source text NOT NULL DEFAULT '',
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source, start_time, end_time)
);
CREATE INDEX IF NOT EXISTS step_interval_user_day_idx ON step_interval (user_id, day, start_time);

ALTER TABLE health_integration
  ADD COLUMN IF NOT EXISTS diagnostics_json jsonb NOT NULL DEFAULT '{}'::jsonb;
