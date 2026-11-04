-- Upgrade databases initialized before the team's follow/privacy feature.
-- CREATE TABLE IF NOT EXISTS alone does not add columns to existing users.
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    following_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id <> following_id)
);
CREATE TABLE IF NOT EXISTS follow_requests (
    requester_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    recipient_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (requester_id, recipient_id),
    CHECK (requester_id <> recipient_id)
);

CREATE INDEX IF NOT EXISTS follows_following_idx ON follows (following_id);
CREATE INDEX IF NOT EXISTS follow_requests_recipient_idx ON follow_requests (recipient_id);
CREATE INDEX IF NOT EXISTS recipes_user_date_idx ON recipes (user_id, created_at DESC);
COMMIT;
