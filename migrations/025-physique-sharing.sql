CREATE TABLE IF NOT EXISTS physique_share (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  checkin_ids text[] NOT NULL CHECK (cardinality(checkin_ids) BETWEEN 1 AND 300)
);
