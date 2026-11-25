-- Additive: keep daily_sleep and all existing production records.
CREATE TABLE IF NOT EXISTS sleep_session (
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 source text NOT NULL, session_key text NOT NULL, day date NOT NULL,
 sleep_start timestamptz, sleep_end timestamptz,
 minutes_asleep integer NOT NULL CHECK (minutes_asleep BETWEEN 0 AND 1440),
 minutes_awake integer, deep_minutes integer, rem_minutes integer, light_minutes integer,
 stages_json jsonb NOT NULL DEFAULT '[]'::jsonb,
 classification_method text NOT NULL DEFAULT 'legacy',
 processed boolean, stage_intervals_json jsonb NOT NULL DEFAULT '[]'::jsonb,
 is_main_sleep boolean NOT NULL DEFAULT false, synced_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,source,session_key)
);
CREATE INDEX IF NOT EXISTS sleep_session_user_day_idx ON sleep_session(user_id,day);
CREATE TABLE IF NOT EXISTS sleep_goal (
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 effective_from date NOT NULL, goal_minutes integer NOT NULL CHECK (goal_minutes BETWEEN 240 AND 720),
 PRIMARY KEY(user_id,effective_from)
);
INSERT INTO sleep_session (user_id,source,session_key,day,sleep_start,sleep_end,minutes_asleep,minutes_awake,deep_minutes,rem_minutes,light_minutes,stages_json,is_main_sleep,synced_at)
SELECT user_id,source,
 CASE WHEN session_id IS NOT NULL THEN 'id:' || session_id
 WHEN sleep_start IS NOT NULL AND sleep_end IS NOT NULL THEN 'interval:' || to_char(sleep_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' || to_char(sleep_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 ELSE 'day:' || day::text END,
 day,sleep_start,sleep_end,minutes_asleep,minutes_awake,deep_minutes,rem_minutes,light_minutes,stages_json,true,synced_at
FROM daily_sleep ON CONFLICT DO NOTHING;
