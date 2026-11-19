# PlateShare onboarding patch

Adds profile setup, optional friend suggestions, optional 10-recipe taste ratings, and Discover entry.

* Existing accounts have `onboarding_completed = TRUE` by default.
* New registrations explicitly set `onboarding_completed = FALSE`.
* A user can skip or finish onboarding; an incomplete user starts again at the profile screen on next login.
* Existing recipe visibility (including approved followers of private accounts) is **not changed**.

After `git apply --check` and `git apply`, migrate the **development** DB from `ProjectSourceCode`:

```bash
docker compose up -d db
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < src/init_data/zz_005_onboarding.sql
```

If the Lab 10 test DB volume already exists, also migrate it:

```bash
docker compose -p plateshare-lab10 -f docker-compose.test.yaml up -d db-test
docker compose -p plateshare-lab10 -f docker-compose.test.yaml exec -T db-test sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < src/init_data/zz_005_onboarding.sql
```

Run tests:

```bash
docker compose -p plateshare-lab10 -f docker-compose.test.yaml run --rm tests npm test
```

The Discover privacy integration test assumes you already applied the local change `const visibleRecipes = recipeVisibility;` in `src/recipes/router.js`. This patch deliberately does not touch that file.
