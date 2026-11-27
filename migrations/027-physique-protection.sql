CREATE TABLE IF NOT EXISTS physique_vault (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  vault jsonb NOT NULL
);
ALTER TABLE physique_checkin ADD COLUMN IF NOT EXISTS protection jsonb;
ALTER TABLE physique_share ADD COLUMN IF NOT EXISTS protection jsonb;
