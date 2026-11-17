ALTER TABLE health_integration ADD COLUMN connection_id text NOT NULL DEFAULT gen_random_uuid()::text;
CREATE TABLE google_meal_sync (
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 meal_id text NOT NULL,
 connection_id text NOT NULL,
 manual boolean NOT NULL DEFAULT false,
 action text NOT NULL CHECK (action IN ('upsert','delete')),
 payload jsonb,
 version text NOT NULL,
 target_name text,
 remote_name text,
 cleanup_names jsonb NOT NULL DEFAULT '[]'::jsonb,
 pending_names jsonb NOT NULL DEFAULT '[]'::jsonb,
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','synced','error','paused')),
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 leased_until timestamptz,
 last_error text,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id, meal_id)
);
CREATE INDEX google_meal_sync_due_idx ON google_meal_sync(state, next_attempt_at);
