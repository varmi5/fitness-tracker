CREATE TABLE passkey (
  id text PRIMARY KEY, name text, public_key text NOT NULL,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE, counter integer NOT NULL,
  device_type text NOT NULL, backed_up boolean NOT NULL,
  transports text, created_at timestamp, aaguid text
);
CREATE INDEX passkey_user_idx ON passkey(user_id);
CREATE TABLE profile (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  height_cm double precision CHECK (height_cm > 0 AND height_cm <= 300),
  units text NOT NULL DEFAULT 'metric' CHECK (units IN ('metric', 'imperial')),
  goals text NOT NULL DEFAULT ''
);
CREATE TABLE measurement (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  metric text NOT NULL CHECK (metric IN ('waist','bicep','chest','hips','thigh','neck','weight')),
  side text NOT NULL CHECK ((metric IN ('bicep','thigh') AND side IN ('left','right')) OR
    (metric NOT IN ('bicep','thigh') AND side = 'none')),
  value double precision NOT NULL CHECK (value > 0 AND value <= 1000),
  date date NOT NULL, note text NOT NULL DEFAULT '',
  CONSTRAINT measurement_daily_unique UNIQUE (user_id, metric, side, date)
);
CREATE INDEX measurement_user_date_idx ON measurement(user_id, date DESC);
