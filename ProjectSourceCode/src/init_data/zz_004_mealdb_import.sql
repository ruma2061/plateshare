-- TheMealDB import (#9). Runs after create.sql on a fresh Docker database.
-- Existing databases can run this file directly; safe to reapply.
BEGIN;

ALTER TABLE recipes
    -- TheMealDB's idMeal; UNIQUE so the same meal can't be imported twice
    ADD COLUMN IF NOT EXISTS mealdb_id INT UNIQUE,
    -- Original recipe page (strSource), when TheMealDB has one
    ADD COLUMN IF NOT EXISTS source_url TEXT;

COMMIT;
