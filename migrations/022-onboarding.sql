ALTER TABLE nutrition_preference
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

UPDATE nutrition_preference
  SET onboarding_completed_at = COALESCE(onboarding_completed_at, now())
  WHERE onboarding_completed_at IS NULL;
