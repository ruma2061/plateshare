
-- ==========================================
-- PLATESHARE DATABASE
-- ==========================================

-- 1. USERS
CREATE TABLE IF NOT EXISTS users (
    user_id SERIAL PRIMARY KEY,
    username VARCHAR(20) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_private BOOLEAN NOT NULL DEFAULT FALSE
);


-- 2. RECIPES
CREATE TABLE IF NOT EXISTS recipes (
    recipe_id SERIAL PRIMARY KEY,

    -- NULL for official PlateShare recipes
    user_id INT REFERENCES users(user_id),

    title VARCHAR(150) NOT NULL,
    description TEXT,
    directions TEXT NOT NULL,

    cuisine VARCHAR(100),

    prep_time INT CHECK (prep_time >= 0),
    cook_time INT CHECK (cook_time >= 0),
    servings INT CHECK (servings > 0),

    image_url TEXT,

    recipe_type VARCHAR(20) NOT NULL DEFAULT 'user'
        CHECK (recipe_type IN ('user', 'official')),

    is_featured BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CHECK (
        (recipe_type = 'user' AND user_id IS NOT NULL)
        OR
        (recipe_type = 'official' AND user_id IS NULL)
    )
);


-- 3. INGREDIENTS
CREATE TABLE IF NOT EXISTS ingredients (
    ingredient_id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL
);


-- 4. RECIPE INGREDIENTS
CREATE TABLE IF NOT EXISTS recipe_ingredients (
    recipe_id INT NOT NULL
        REFERENCES recipes(recipe_id) ON DELETE CASCADE,

    ingredient_id INT NOT NULL
        REFERENCES ingredients(ingredient_id),

    quantity NUMERIC(10,2),
    unit VARCHAR(30),
    notes TEXT,

    PRIMARY KEY (recipe_id, ingredient_id)
);


-- 5. RATINGS
CREATE TABLE IF NOT EXISTS ratings (
    rating_id SERIAL PRIMARY KEY,

    recipe_id INT NOT NULL
        REFERENCES recipes(recipe_id) ON DELETE CASCADE,

    user_id INT NOT NULL
        REFERENCES users(user_id),

    rating INT NOT NULL
        CHECK (rating BETWEEN 1 AND 5),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Each user can rate a recipe only once
    UNIQUE (recipe_id, user_id)
);

CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL
        REFERENCES users(user_id) ON DELETE CASCADE,
    following_id INTEGER NOT NULL
        REFERENCES users(user_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (follower_id, following_id),
    CHECK (follower_id <> following_id)
);

CREATE TABLE IF NOT EXISTS follow_requests (
    requester_id INTEGER NOT NULL
        REFERENCES users(user_id) ON DELETE CASCADE,
    recipient_id INTEGER NOT NULL
        REFERENCES users(user_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (requester_id, recipient_id),
    CHECK (requester_id <> recipient_id)
);