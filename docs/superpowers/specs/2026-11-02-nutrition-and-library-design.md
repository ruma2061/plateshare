# Recipe nutrition and personal library

Implement issues #5 and #11 on `jeramiah/recipe-nutrition-and-saved-library`.
The connected account is UrielJMendoza; its comments claim these two issues.
Issue #12 is also assigned, but a separate profile feature has already merged.

PlateShare helps cooks discover, save and share recipes. The current Express /
Handlebars / PostgreSQL app has authentication, a basic profile, recipes and
1–5 ratings tables. Its Discover screen still calls a starter Ticketmaster API.
The saved-recipe wireframe calls for a personal collection and rating history.

## Approach

Extend the existing server-rendered app with a small recipe router. Add a recipe
catalog/detail screen so saving and nutrition are usable before teammates finish
the feed. Keep Discover and the existing rating model available for their work.
Replacing the feed or adding a separate frontend would overlap other assignments.
Nutrition is entered per serving by a recipe's owner, or supplied by an importer;
automatic nutrient calculation requires ingredient/API data the project lacks.

## Behavior

- Authenticated recipe catalog and detail pages expose existing database recipes.
- Four optional per-serving values: calories (kcal), protein/carbohydrates/fat (g).
  Missing values remain unknown, including partial nutrition; zero is valid.
- Only the recipe owner can edit nutrition. Validate finite nonnegative decimals
  with at most two decimal places and a NUMERIC(10,2) upper bound.
- Save and unsave recipes in a private account-owned collection. Repeated saves
  are idempotent; deleting recipes cleans up bookmarks.
- My Recipes has Saved and Rated tabs, search, sorting and bounded pagination.
  Rated shows existing 1–5 ratings, even when a recipe is not bookmarked.
- New mutations require a session-bound CSRF token. User IDs come from the
  authenticated session, never submitted data.
- Accessible, responsive Bootstrap pages use the wireframes' green/cream palette.
- An idempotent SQL migration upgrades existing databases without resetting data.

## Boundaries and implementation decisions

Rating creation/comparison (#10), recipe posting (#6), food API (#9), feed work
(#15/#16), and profile editing (#18) remain separate team assignments. No invented
nutrition estimates, production sample recipes, or public bookmark exposure.
The requested code/branch work authorizes implementation; these details are
implementation choices based on the repository rather than new user requirements.
