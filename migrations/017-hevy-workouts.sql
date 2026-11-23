CREATE TABLE IF NOT EXISTS hevy_workout (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  hevy_id text NOT NULL,
  day date NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  duration_seconds integer,
  source text NOT NULL DEFAULT 'hevy_csv',
  matched_google_session_id text,
  avg_hr_bpm double precision,
  hr_sample_count integer NOT NULL DEFAULT 0,
  hr_coverage_pct integer,
  updated_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, hevy_id)
);
CREATE INDEX IF NOT EXISTS hevy_workout_user_day_idx ON hevy_workout (user_id, day, start_time);

CREATE TABLE IF NOT EXISTS hevy_set (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  hevy_id text NOT NULL,
  exercise_index integer NOT NULL,
  exercise_title text NOT NULL,
  exercise_template_id text,
  superset_id integer,
  set_index integer NOT NULL,
  set_type text NOT NULL DEFAULT 'normal',
  weight_kg double precision,
  reps integer,
  distance_meters double precision,
  duration_seconds integer,
  rpe double precision,
  notes text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS hevy_set_workout_idx ON hevy_set (user_id, hevy_id, exercise_index, set_index);

ALTER TABLE health_integration
  DROP CONSTRAINT IF EXISTS health_integration_provider_check;
ALTER TABLE health_integration
  ADD CONSTRAINT health_integration_provider_check CHECK (provider IN ('google', 'apple', 'hevy'));
