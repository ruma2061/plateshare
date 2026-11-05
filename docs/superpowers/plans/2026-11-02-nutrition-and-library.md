# Nutrition and Recipe Library Implementation Plan

> Execute with superpowers:executing-plans and test-driven-development.

**Goal:** Deliver issues #5 and #11 in the existing app on a separate branch.
**Architecture:** Recipe router with pg-promise queries, Handlebars views and a
non-destructive SQL migration. Existing login and rating semantics stay intact.
**Tech Stack:** Express 4, Handlebars 7, PostgreSQL, Bootstrap, Node test runner.
**Spec:** `docs/superpowers/specs/2026-11-02-nutrition-and-library-design.md`

## Global constraints

- Nullable per-serving nutrition; zero is known, missing is unknown.
- Current user owns bookmarks; only recipe authors may update nutrition.
- Ratings remain 1–5 and are read from the existing ratings table.
- No main-branch changes, external API dependencies or destructive DB resets.

## Review focus

- Cross-account saves, unsaves, and nutrition edits must not modify other users.
- Null versus zero nutrition, malformed numbers, missing recipes and invalid IDs.
- Repeated saves and upgrades must preserve existing records without duplication.
- Ratings without saves, empty collections, search and pagination boundaries.
- CSRF, HTML escaping, database errors and safe redirect targets.

## Task 1: Database and nutrition validation

- [x] Add failing tests for schema upgrades preserving users/ratings, bookmark
  uniqueness/cascades, unknown/zero/invalid nutrition and PostgreSQL constraints.
- [x] Run `node --test test/nutrition.test.js test/schema.test.js`; confirm RED.
- [x] Add `src/init_data/zz_001_nutrition_and_saved_recipes.sql` which Docker runs after create.sql on fresh initialization. Add `src/recipes/nutrition.js` exposing
  `parseNutrition(body)` and `nutritionForDisplay(recipe)`.
- [x] Run the same tests; expect all passing. Commit the working database layer.

## Task 2: Routes, views and integration

- [x] Write HTTP tests against the real router, sessions, templates and PostgreSQL
  engine for save/unsave, account isolation, nutrition ownership, validation,
  rating history, searches, pagination, empty states and CSRF; confirm RED.
- [x] Implement `src/recipes/router.js` exporting `createRecipeRouter(db)`.
  Share the existing authentication middleware via `src/middleware/auth.js`.
- [x] Add recipe catalog/detail/library pages, nutrition/card/pagination partials
  and scoped CSS. Wire navigation and router into `src/index.js`.
- [x] Run `npm test`; expect the entire suite to pass. Commit the feature.

## Task 3: Verification and handoff

- [x] Document startup, migration, per-serving fields, routes and integration
  boundaries in README. Record any unavailable runtime checks accurately.
- [x] Review the branch, run full tests and `git diff --check`, fix important
  findings, and commit.

Handoff: publish the named feature branch without merging main.

## Verification record

- `npm test`: 17 tests passed, including upgrading a populated original schema.
- `node --check` passed for the server and recipe router.
- `git -c core.whitespace=cr-at-eol diff --check` passed (existing source uses CRLF).
- Native Docker/PostgreSQL 17 and interactive browser checks were not available in this workspace.
- Independent code review found no Critical, Important or Minor defects; additional form and pagination smoke checks passed.
