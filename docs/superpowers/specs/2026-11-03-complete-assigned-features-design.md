# Complete PlateShare assignments #5, #11 and #12

Finish the user's three current assignments on the existing
`jeramiah/recipe-nutrition-and-saved-library` branch. The earlier #5/#11 work
is the starting point. Merge current main into this branch so the new profile
works with the team's following, follow requests and account privacy.

## Product and approach

PlateShare is a social recipe book for discovering dishes, saving recipes,
recording ratings and following cooks. The repository's product brief and
DiscoverWireFrame.png, SavedRecipeFrame.png and RatingWireFrame.png establish
cream surfaces, forest green type, rounded pale green statistics, recipe photos,
segmented tabs, ranked recipe rows and mobile bottom navigation.

Extend the existing Express/Handlebars/PostgreSQL application. A separate
frontend would duplicate authentication and split the team's app. A cosmetic
profile would leave #12 incomplete, so show real database content as well.
These are implementation choices within the requested scope.

## Required behavior

- #5: preserve validated per-serving calories, protein, carbohydrates and fat;
  retain unknown versus zero, owner-only editing and CSRF protection.
- #11: keep each account's saved collection private and separate from ratings.
  Use the wireframe's recipe-book identity, three real summary counts, rounded
  tabs, ranked rated rows and saved recipe cards. Search/sort/pagination remain.
- #12: show the account name, membership month, privacy state, follower counts,
  posted recipes and all existing ratings through paginated tabs. Owners get
  shortcuts to their saved collection, settings and pending requests. Preserve
  the team's follow, unfollow and cancel-request controls.
- Private profiles expose content only to their owner and established
  followers. Apply the same policy to recipe browsing, direct detail, saves,
  nutrition and profile rating entries; a pending request gives no access.
  Bookmarks never become public profile content. Hidden content must not leak
  through counts. Unsaving a hidden recipe must remain possible.
- Use the database's current 1–5 rating scale, with explicit labels; do not
  invent the wireframes' 10-point ratings, recommendation scores or social data.
- Add an idempotent migration for legacy databases missing account privacy and
  follow tables. Preserve all existing records and never reset volumes.
- Keep existing login, registration, profile settings and social actions usable.
  Do not take over rating entry, posting, food import, personalized feeds or
  preference editing assigned to other teammates.

## Validation

Run existing and new HTTP/SQL tests for content, privacy, pagination, escaping,
authentication, save/rating separation and migrations. Exercise the production
app with a disposable PostgreSQL-compatible database and inspect mobile and
desktop screenshots. Docker is unavailable here; document that runtime limit.
