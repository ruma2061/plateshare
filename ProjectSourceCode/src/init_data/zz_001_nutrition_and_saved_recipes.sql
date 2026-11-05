-- Runs after create.sql on a fresh Docker database. Existing databases can run
-- this file directly; it is safe to reapply and does not delete existing data.
BEGIN;

-- All measurements are PER SERVING. NULL means unknown, not zero.
ALTER TABLE recipes
    ADD COLUMN IF NOT EXISTS calories NUMERIC(10,2)
        CHECK (calories BETWEEN 0 AND 99999999.99),
    ADD COLUMN IF NOT EXISTS protein_g NUMERIC(10,2)
        CHECK (protein_g BETWEEN 0 AND 99999999.99),
    ADD COLUMN IF NOT EXISTS carbs_g NUMERIC(10,2)
        CHECK (carbs_g BETWEEN 0 AND 99999999.99),
    ADD COLUMN IF NOT EXISTS fat_g NUMERIC(10,2)
        CHECK (fat_g BETWEEN 0 AND 99999999.99);

CREATE TABLE IF NOT EXISTS saved_recipes (
    user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    recipe_id INT NOT NULL REFERENCES recipes(recipe_id) ON DELETE CASCADE,
    saved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, recipe_id)
);

CREATE INDEX IF NOT EXISTS saved_recipes_user_date_idx
    ON saved_recipes (user_id, saved_at DESC);
CREATE INDEX IF NOT EXISTS ratings_user_date_idx
    ON ratings (user_id, created_at DESC);

COMMIT;
