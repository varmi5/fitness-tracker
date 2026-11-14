-- Preserve access for owners created through the retired setup code before
-- email verification was required. Member accounts still verify by email.
UPDATE "user"
SET email_verified = true
WHERE role = 'owner'
  AND NOT email_verified
  AND EXISTS (SELECT 1 FROM owner_setup WHERE id = 1 AND consumed);
