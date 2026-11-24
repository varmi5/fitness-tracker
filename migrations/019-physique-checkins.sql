CREATE TABLE IF NOT EXISTS physique_checkin (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  day date NOT NULL,
  pose text NOT NULL DEFAULT 'front',
  cadence text NOT NULL DEFAULT 'weekly',
  photo_data text NOT NULL,
  weight_kg double precision,
  body_fat_pct double precision,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS physique_checkin_user_day_idx
  ON physique_checkin (user_id, day DESC, created_at DESC);
