ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS birth_date date;

ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS biological_sex text
  CHECK (biological_sex IS NULL OR biological_sex IN ('male', 'female'));
