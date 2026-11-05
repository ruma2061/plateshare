-- Rating comparisons (#10): thumbs up/side/down, then rank against
-- recipes the user already rated with the same thumb.
-- Runs after create.sql on a fresh Docker database. Existing databases can run
-- this file directly; it is safe to reapply and does not delete existing data.
BEGIN;

ALTER TABLE ratings
    -- The first click: 'like' = thumbs up, 'ok' = thumbs side, 'dislike' = thumbs down
    ADD COLUMN IF NOT EXISTS sentiment VARCHAR(10)
        CHECK (sentiment IN ('like', 'ok', 'dislike')),

    -- Position inside that user's sentiment group. 1 = best.
    ADD COLUMN IF NOT EXISTS rank_position INT
        CHECK (rank_position >= 1),

    -- 0.0 to 10.0, computed from sentiment + rank_position.
    --   dislike 0.0-4.0 | ok 4.0-7.0 | like 7.0-10.0
    -- The existing 1-5 `rating` column is filled from this (score / 2, rounded).
    ADD COLUMN IF NOT EXISTS score NUMERIC(3,1)
        CHECK (score BETWEEN 0 AND 10);

-- Fast lookup of "my ranked list for this thumb" during comparisons
CREATE INDEX IF NOT EXISTS ratings_user_sentiment_rank_idx
    ON ratings (user_id, sentiment, rank_position);

COMMIT;
