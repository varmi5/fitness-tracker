CREATE TABLE IF NOT EXISTS training_preference (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  max_hr_bpm integer NOT NULL DEFAULT 190,
  age integer,
  max_hr_is_estimated boolean NOT NULL DEFAULT true,
  walking_enabled boolean NOT NULL DEFAULT true,
  walking_step_threshold integer NOT NULL DEFAULT 10500,
  walking_sensitivity text NOT NULL DEFAULT 'normal',
  walking_max_points double precision NOT NULL DEFAULT 5,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_strain (
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  day date NOT NULL,
  algorithm_version text NOT NULL,
  overall_strain double precision,
  cardio_strain double precision,
  muscular_strain double precision,
  c_raw double precision NOT NULL DEFAULT 0,
  m_raw double precision NOT NULL DEFAULT 0,
  walking_points double precision NOT NULL DEFAULT 0,
  total_steps integer,
  excluded_workout_steps integer,
  eligible_steps integer,
  excess_steps integer,
  confidence text NOT NULL DEFAULT 'incomplete',
  muscle_loads_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  activities_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  settings_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS daily_strain_user_day_idx ON daily_strain (user_id, day DESC);
