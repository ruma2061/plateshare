# PlateShare

PlateShare is a web app where users log the meals they cook or eat out, save and share recipes, and follow friends to see what they're making in a social feed.

## What you can do
- make an account and log in
- post a dish with a photo, ingredients, steps, and a rating
- like, comment on, and save other people's posts
- follow friends and see their posts in your feed
- search recipes by ingredient, cuisine, or dietary tag

(still a work in progress: login/register, recipe browsing, saved collections,
rating history, per-serving nutrition, profiles, following and account privacy
are available; recipe posting, rating entry and the social feed remain separate
features in progress)

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
To upgrade an **existing database**, run this from
`ProjectSourceCode` after starting Docker:

```sh
for migration in src/init_data/zz_*.sql; do
  docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$migration" || break
done
```

Both migrations are safe to rerun and preserve accounts, recipes and ratings.
The second adds account privacy and follow tables to older installations.
Do not reset the Docker volume to apply it. Future schema changes need their own
migrations; changing `create.sql` alone will not update an existing database.

## Recipe nutrition, collections and profiles (#5, #11 and #12)

- **Recipes** (`/recipes`): browse database recipes; search by title or cuisine;
  sort by date, name or your rating. Results are paginated, 12 at a time.
- **Recipe detail** (`/recipes/:recipeId`): ingredients, directions, your existing
  rating, save/remove buttons and nutrition. Recipe authors can edit nutrition.
- **My Recipes** (`/my-recipes`): a private Saved tab and Rated tab with separate
  counts, search and sorting, plus cuisines tried and a ranked rating list.
  Removing a bookmark does not remove a rating.
- **Profile** (`/profile` or `/profile/:username`): membership date, followers,
  following, posted recipes and rating history, with search and pagination.
  Your own profile links to your private saved collection, settings and follow
  requests. Other profiles retain follow/unfollow/request controls.
- **Find cooks** (`/discover`): the team's username search for finding profiles.

These pages use the repository wireframes' green/cream palette, recipe imagery,
rounded statistics and tabs, with bottom navigation on mobile. List positions
reflect the selected sort. Rating badges explicitly use the existing 1–5 scale.
Bootstrap is served locally from the pinned npm package, so page layouts do not
depend on a third-party CDN being reachable.

`recipes.calories` (kcal), `protein_g`, `carbs_g` and `fat_g` (grams) always refer
to **one serving**, not the whole recipe. Values are optional, nonnegative and
have at most two decimal places. `NULL` means unknown; zero is displayed as zero.
The app does not estimate nutrition or call a third-party nutrition API. Recipe
importers should populate these fields with per-serving data when available.

Existing ratings use the database's 1–5 scale. Rating creation/comparison (#10),
recipe posting (#6), food API integration (#9), and Discover/feed work (#15/#16)
remain independent features. The collection and profile immediately reflect
rows they add to the existing `recipes` and `ratings` tables. The recipe catalog
is `/recipes`; the existing `/discover` route remains the team's user search.
A fresh database has no
recipes, so it will show an empty state until recipes are posted or imported.

All new routes require login. The POST routes `/recipes/:recipeId/save`,
`/recipes/:recipeId/unsave` and `/recipes/:recipeId/nutrition` use a session-bound
`_csrf` form token. Bookmark ownership always comes from the session; nutrition
updates require the recipe author. An importer can populate official recipes'
nutrition directly in PostgreSQL.
Profile privacy, follow/request/follower changes and logout use the same
session-bound form protection.

Private accounts' recipes and activity are visible only to their owners and
established followers, including direct recipe links and collection counts.
Pending requests do not grant access. Saved collections are always account-only,
even for public profiles. A saved record is retained if its author becomes
private; it reappears when access is restored. The unsave endpoint can remove
the viewer's own bookmark even while its recipe is hidden.
The Saved tab also offers **Manage unavailable bookmarks**, which removes only
the current user's inaccessible bookmarks without exposing hidden recipe data.

### Testing

With Node 20 or newer:

```sh
cd ProjectSourceCode
npm ci
npm test
```

Tests run the production Express app, sessions, Handlebars templates and SQL against
an in-memory PostgreSQL engine (PGlite), so they do not need Docker or modify your
database. They cover migrations, validation, account isolation, CSRF, save/remove,
nutrition ownership, rating history, profiles, follow/privacy transitions,
registration/login, pagination, escaping and error states.
Docker with PostgreSQL 17 remains the application runtime.

To check the pages manually, log in, open an existing recipe, save it, and verify
it appears under My Recipes. Remove it and verify its rating is still in Rated.
For a recipe you own, edit nutrition, reload, and check the per-serving values.
Use a second account to confirm that saved collections are private and nutrition
editing is restricted to the author.

See [the implementation map](docs/assigned-features.md) for feature boundaries,
the wireframe mapping and manual checks.

## Where stuff is
- `ProjectSourceCode/src/index.js` - PostgreSQL connection and server startup
- `ProjectSourceCode/src/app.js` - application setup, auth and social routes
- `ProjectSourceCode/src/recipes` - recipe browsing, saving and nutrition
- `ProjectSourceCode/src/profiles` - profile recipe/rating content
- `ProjectSourceCode/src/views` - the pages (handlebars)
- `ProjectSourceCode/src/init_data` - database tables
- `MilestoneSubmissions` - project docs
- `TeamMeetingLogs` - meeting notes

## Contributing
Make your own branch, don't push to main. Open a PR and get someone to review it before merging.

## Recipe comments (#17)

Logged-in users can comment on recipes they can view, including official recipes,
their own recipes, public recipes and recipes from private accounts they follow.
Pending follow requests do not grant access. Comments show the author and UTC time,
preserve line breaks, and display newest first with 50 comments per page.
Comments must contain 1–2,000 Unicode characters after trimming whitespace.

Fresh Docker databases automatically apply `zz_004_recipe_comments.sql`. For an
existing database, run from `ProjectSourceCode` without deleting the database volume:

```sh
docker compose exec db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/zz_004_recipe_comments.sql'
```

Earlier schema upgrades must already be applied. Run `npm test` from
`ProjectSourceCode` to verify comments, privacy, CSRF, rendering and existing features.
