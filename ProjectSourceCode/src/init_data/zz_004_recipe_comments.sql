-- Recipe comments (#17). Safe to apply to an existing database.
BEGIN;
CREATE TABLE IF NOT EXISTS recipe_comments (
    comment_id SERIAL PRIMARY KEY,
    recipe_id INTEGER NOT NULL REFERENCES recipes(recipe_id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000 AND body ~ '[^[:space:]]'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS recipe_comments_recipe_date_idx
    ON recipe_comments (recipe_id, created_at DESC, comment_id DESC);
COMMIT;
