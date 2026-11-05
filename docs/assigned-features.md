# PlateShare implementation map

PlateShare is a social recipe book: people discover dishes, keep recipes they
want to cook, rate meals they have tried and follow other cooks. The product
brief is `MilestoneSubmissions/GROUP DOC-3.pdf`. The current app uses Express
and Handlebars on the server, Bootstrap plus local CSS in the browser, sessions
for authentication and PostgreSQL for persistent accounts and recipe data.

## Assigned work

| Issue | Implemented behavior | Main implementation |
| --- | --- | --- |
| #5 Calories and macros | Per-serving calories, protein, carbs and fat; unknown differs from zero; validated owner-only edits | `src/recipes/nutrition.js`, `src/recipes/router.js`, `partials/nutrition.hbs` |
| #11 Saved recipes and ratings | Private saved book, independent rating history, search/sort/pagination, cuisine counts and ranked rows | `src/recipes/router.js`, `pages/recipes.hbs`, `partials/recipe-row.hbs` |
| #12 Profile page | Account identity, membership date, posted recipes, all ratings across paginated tabs, social counts and owner shortcuts | `src/app.js`, `src/profiles/content.js`, `pages/profile.hbs` |

Paths above are relative to `ProjectSourceCode`; template paths are below
`src/views`. The existing branch also incorporates main's profile/following
work, preserving follow requests, privacy settings and follower management.

## Data and access

`users` owns account identity and privacy. `recipes` owns directions, timing,
servings, images, cuisine and optional nutrition. `ingredients` and
`recipe_ingredients` describe ingredients. `ratings` stores one integer from
1–5 per account and recipe. `saved_recipes` stores bookmarks independently.
`follows` grants access to private accounts; `follow_requests` does not.

`src/recipes/visibility.js` defines the shared recipe access policy. Catalogs,
details, nutrition, saving, profile activity and collection counts apply it.
Private profiles show no recipe/rating content to unauthorized viewers.
Bookmarks never appear as someone else's public profile collection.

`src/recipes/presentation.js` supplies consistent optional nutrition and safe
HTTP(S) image URLs. It does not invent nutrition, ratings or profile details.
All searches use parameterized SQL, literal wildcard escaping and allowlisted
sorts. Results use stable 12-item pages. New recipe mutations require the
session-bound `_csrf` field; owner checks use the authenticated session.
Privacy and social access changes use that token too. Saved includes a generic
cleanup control for unavailable bookmarks, with no private recipe details or
counts. It leaves visible saves and ratings intact.

## Wireframe mapping

| Reference | Corresponding app behavior |
| --- | --- |
| `SavedRecipeFrame.png` | Recipe-book identity, three summary counts, Saved/ Rated tabs, ranked rating rows and image cards |
| `RatingWireFrame.png` | Photo-led detail, saved state, existing personal rating, ingredient/step/nutrition links |
| `DiscoverWireFrame.png` | Green/cream visual language, rounded cards and mobile navigation shared by the assigned pages |

The mockups show 10-point scores and friend recommendations. The schema
currently stores 1–5 ratings and does not provide recommendation scores, so
the implementation displays real data on its existing scale. Account avatars
use initials because profile photos/bios are not part of the current schema.

## Team integration

Posting (#6), rating entry/comparison (#10), food import/API (#8/#9), feeds
(#15/#16), comments (#17) and preferences (#18/#19) remain other assignments.
The assigned pages read the database tables these features populate. No sample
recipes are inserted into production, so a new database starts with useful
empty states. The `/discover` username search remains intact; `/recipes`
provides recipe discovery until the team integrates its feed.

Run every `zz_*.sql` migration in filename order on existing databases (see
README). Do not delete Docker volumes to upgrade. `zz_002_profile_privacy.sql`
also handles the older `users` table without `is_private`.

## Checks

From `ProjectSourceCode`, run `npm ci` and `npm test`. Tests start the same
`createApp` factory as production with a disposable PGlite database, real
templates, sessions and SQL. They do not require or alter the Docker database.

For a manual walkthrough:

1. Register and log in. Open Profile; switch between Recipes and Ratings.
2. With existing recipe rows, save a recipe and find it under My Recipes.
   Remove it; confirm any independent rating stays in Rated.
3. On a recipe you own, edit nutrition. Check zero, blank and partial values.
   Another account must not be able to edit it.
4. Search and sort both collections and profile tabs. Move between pages.
5. Make another account private. A pending request must not expose its recipe
   titles or rating counts. Accepting the request should restore access.
6. Test the navigation and forms at phone and desktop widths.

The automated browser walkthrough checks 320px, 390px and 1365px layouts plus
login, search, saves and nutrition edits. Docker/PostgreSQL 17 startup still
requires a machine with Docker installed; Docker is unavailable in this work
environment.
