# Complete Assigned Features Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task by task.

**Goal:** Finish nutrition, saved/rated recipe books and complete profile content on the user's branch.

**Architecture:** Preserve the merged Express app and social routes. Share recipe presentation and visibility between recipe and profile content. Export an app factory so HTTP tests run the same app used by the server.

**Tech Stack:** Express 4, Handlebars 7, PostgreSQL 17, node:test and PGlite.

**Spec:** docs/superpowers/specs/2026-11-03-complete-assigned-features-design.md

## Global Constraints

- Work on `jeramiah/recipe-nutrition-and-saved-library`; never update main.
- Keep 1–5 ratings and per-serving optional nutrition.
- Preserve teammate follow/privacy controls and all database data.
- Saved recipes remain private. Account privacy applies to recipe routes too.

## Review Focus

- Pending follow requests must not unlock private content or leak its counts.
- Ratings on another private author's recipe must obey the viewer's access.
- Removing saves after an author becomes private must remain possible.
- Legacy databases must gain privacy columns without losing old records.
- Long titles and 320px layouts must retain usable controls without overflow.

## Task 1: Merge compatibility and recipe visibility

Files: `src/init_data/zz_002_profile_privacy.sql`, `src/recipes/router.js`,
`src/recipes/presentation.js`, `src/recipes/visibility.js`, and schema/recipe tests
(all source paths below `ProjectSourceCode`).

Produces: shared `presentRecipe(recipe)` and SQL `recipeVisibility` using alias
`r`, joined author `u`, and viewer parameter `$1`.

- [x] Add tests for legacy upgrades, private recipes, accepted versus pending
  follows and unsaving a recipe after access is lost; run and observe failures.
- [x] Implement visibility in reads, mutations, statistics and safe unsaving.
- [x] Run `npm test`; expect the entire suite to pass. Commit.

## Task 2: Complete profile content

Files: `src/app.js`, `src/index.js`, `src/profiles/content.js`, profile template,
`test/helpers/site.js`, `test/helpers/database.js`, `test/profiles.test.js`.

Consumes: shared recipe presentation and visibility from Task 1.
Produces: `createApp(db, {sessionSecret})` and
`loadProfileContent(db, {profileUser, viewerId, query})`.

- [x] Add HTTP tests for public/own/private profiles, own recipes, ratings,
  safe public fields, search, stable bounded pagination, follow transitions and
  error states; observe failures before implementing.
- [x] Move existing route wiring into the app factory; retain startup in index.
  Extend the existing profile route with content and owner-only library links.
- [x] Run `npm test`; expect all tests to pass. Commit.

## Task 3: Wireframe layouts and delivery

Files: recipe/profile templates, shared navigation, recipes.css, README and
`docs/assigned-features.md`.

Consumes: Task 1/2 content and route interfaces; no new backend interfaces.

- [x] Match the wireframe's green/cream recipe book, summary strip, tabs,
  ranked rows, recipe imagery and mobile bottom navigation without fake data.
- [x] Run `npm test`; inspect desktop and mobile app renderings and keyboard
  controls. Document app architecture, assignments and migration instructions.
- [x] Review the whole change, resolve important findings, commit and push to
  the existing feature branch with a fast-forward update. Confirm remote head.
