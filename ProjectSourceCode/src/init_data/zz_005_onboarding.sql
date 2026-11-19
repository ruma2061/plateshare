-- Existing PlateShare accounts bypass onboarding; new registrations start incomplete.
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(60);
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio VARCHAR(280);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT TRUE;
COMMIT;
