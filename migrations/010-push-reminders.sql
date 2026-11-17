CREATE TABLE reminder_preference (
 user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 times jsonb NOT NULL DEFAULT '["18:30"]'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE push_subscription (
 id text PRIMARY KEY,
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 endpoint_hash text NOT NULL UNIQUE,
 credential text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscription_user_idx ON push_subscription(user_id);
CREATE TABLE reminder_delivery (
 user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
 day date NOT NULL,
 time text NOT NULL,
 subscription_id text NOT NULL REFERENCES push_subscription(id) ON DELETE CASCADE,
 state text NOT NULL DEFAULT 'pending',
 attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 leased_until timestamptz,
 PRIMARY KEY(user_id,day,time,subscription_id)
);
