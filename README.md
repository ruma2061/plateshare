# PlateShare

PlateShare is a web app where users log the meals they cook or eat out, save and share recipes, and follow friends to see what they're making in a social feed.

## What you can do
- make an account and log in
- post a dish with a photo, ingredients, steps, and a rating
- like, comment on, and save other people's posts
- follow friends and see their posts in your feed
- search recipes by ingredient, cuisine, or dietary tag

(still a work in progress: login/register, recipe browsing, saved collections,
rating history and per-serving nutrition are available; posting, rating entry,
friends and the social feed are separate features in progress)

## Running it locally

You need Docker Desktop installed and running.

1. cd into `ProjectSourceCode`
2. Copy `.env.example` to `.env`, then choose a database password and a long,
   random `SESSION_SECRET` (for example, generate it with
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
3. run `docker compose up`
4. open http://localhost:3000

The .env is gitignored so don't try to commit it.

Docker only runs `src/init_data/*.sql` automatically for a **new database**.
To add nutrition and saved recipes to an **existing database**, run this from
`ProjectSourceCode` after starting Docker:

```sh
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < src/init_data/zz_001_nutrition_and_saved_recipes.sql
```

This migration is safe to rerun and preserves accounts, recipes and ratings.
Do not reset the Docker volume to apply it. Future schema changes need their own
migrations; changing `create.sql` alone will not update an existing database.

## Recipe nutrition and saved collections (#5 and #11)

- **Recipes** (`/recipes`): browse database recipes; search by title or cuisine;
  sort by date, name or your rating. Results are paginated, 12 at a time.
- **Recipe detail** (`/recipes/:recipeId`): ingredients, directions, your existing
  rating, save/remove buttons and nutrition. Recipe authors can edit nutrition.
- **My Recipes** (`/my-recipes`): a private Saved tab and Rated tab with separate
  counts, search and sorting. Removing a bookmark does not remove a rating.

`recipes.calories` (kcal), `protein_g`, `carbs_g` and `fat_g` (grams) always refer
to **one serving**, not the whole recipe. Values are optional, nonnegative and
have at most two decimal places. `NULL` means unknown; zero is displayed as zero.
The app does not estimate nutrition or call a third-party nutrition API. Recipe
importers should populate these fields with per-serving data when available.

Existing ratings use the database's 1–5 scale. Rating creation/comparison (#10),
recipe posting (#6), food API integration (#9), and Discover/feed work (#15/#16)
remain independent features. The collection immediately reflects rows they add
to the existing `recipes` and `ratings` tables. Discover is still the original
starter events page; use Recipes for these features. A fresh database has no
recipes, so it will show an empty state until recipes are posted or imported.

All new routes require login. The POST routes `/recipes/:recipeId/save`,
`/recipes/:recipeId/unsave` and `/recipes/:recipeId/nutrition` use a session-bound
`_csrf` form token. Bookmark ownership always comes from the session; nutrition
updates require the recipe author. An importer can populate official recipes'
nutrition directly in PostgreSQL.

### Testing

With Node 20 or newer:

```sh
cd ProjectSourceCode
npm ci
npm test
```

Tests run the real Express router, sessions, Handlebars templates and SQL against
an in-memory PostgreSQL engine (PGlite), so they do not need Docker or modify your
database. They cover migrations, validation, account isolation, CSRF, save/remove,
nutrition ownership, rating history, pagination, escaping and error states.
Docker with PostgreSQL 17 remains the application runtime.

To check the pages manually, log in, open an existing recipe, save it, and verify
it appears under My Recipes. Remove it and verify its rating is still in Rated.
For a recipe you own, edit nutrition, reload, and check the per-serving values.
Use a second account to confirm that saved collections are private and nutrition
editing is restricted to the author.

## Where stuff is
- `ProjectSourceCode/src/index.js` - server and routes
- `ProjectSourceCode/src/recipes` - recipe browsing, saving and nutrition
- `ProjectSourceCode/src/views` - the pages (handlebars)
- `ProjectSourceCode/src/init_data` - database tables
- `MilestoneSubmissions` - project docs
- `TeamMeetingLogs` - meeting notes

## Contributing
Make your own branch, don't push to main. Open a PR and get someone to review it before merging.
