const express = require('express');
const auth = require('../middleware/auth');
const { prepareCsrf, verifyCsrf } = require('../middleware/csrf');
const { parseNutrition } = require('./nutrition');
const { presentRecipe } = require('./presentation');
const { recipeVisibility } = require('./visibility');
const { registerRatingRoutes } = require('./ratingRoutes');
const { ratingForDisplay } = require('./rating');
const { loadComments, registerCommentRoutes } = require('./comments');

const PAGE_SIZE = 12;
const ORIGIN = 'http://plateshare.local';
const selectRecipe = `SELECT r.*, u.username AS author,
  my_rating.rating AS user_rating, my_rating.score AS user_score, my_rating.sentiment AS user_sentiment,
  (saved.recipe_id IS NOT NULL) AS is_saved
  FROM recipes r
  LEFT JOIN users u ON u.user_id = r.user_id
  LEFT JOIN ratings my_rating ON my_rating.recipe_id = r.recipe_id AND my_rating.user_id = $1
  LEFT JOIN saved_recipes saved ON saved.recipe_id = r.recipe_id AND saved.user_id = $1`;

function localReturnTo(value, fallback) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;
  try {
    const url = new URL(value, ORIGIN);
    if (url.origin === ORIGIN && /^\/(my-recipes|recipes(?:\/[1-9]\d*)?|profile\/[A-Za-z0-9_]{3,20})$/.test(url.pathname)) {
      return url.pathname + url.search;
    }
  } catch { /* Use the recipe detail page for invalid return targets. */ }
  return fallback;
}

function createRecipeRouter(db) {
  const router = express.Router();
  // Scope authentication/CSRF setup to these features; login routes remain public.
  router.use(['/recipes', '/my-recipes'], auth, prepareCsrf, (req, res, next) => {
    res.locals.recipeStyles = true;
    res.locals.libraryActive = req.originalUrl.split('?')[0].startsWith('/my-recipes');
    res.locals.recipesActive = !res.locals.libraryActive;
    next();
  });

  const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

  router.param('recipeId', (req, res, next, value) => {
    if (!/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) {
      return res.status(404).render('pages/recipe-error', { message: 'Recipe not found.' });
    }
    req.recipeId = Number(value);
    next();
  });

  const loadRecipe = asyncRoute(async (req, res, next) => {
    const row = await db.oneOrNone(`${selectRecipe} WHERE r.recipe_id = $2 AND ${recipeVisibility}`, [req.session.user.user_id, req.recipeId]);
    if (!row) return res.status(404).render('pages/recipe-error', { message: 'Recipe not found.' });
    req.recipe = presentRecipe(row);
    next();
  });

  async function renderDetail(req, res, extra = {}) {
    const ingredients = await db.any(`SELECT i.name, ri.quantity, ri.unit, ri.notes
      FROM recipe_ingredients ri JOIN ingredients i USING (ingredient_id)
      WHERE ri.recipe_id = $1 ORDER BY i.name`, [req.recipeId]);
    return res.render('pages/recipe', {
      recipe: req.recipe, ingredients,
      ...await loadComments(db, req.recipeId, req.query),
      isOwner: req.recipe.user_id === req.session.user.user_id,
      nutritionInputs: req.recipe.nutrients,
      rating: ratingForDisplay(req.recipe),
      returnTo: `/recipes/${req.recipeId}`, ...extra,
    });
  }

  const listRecipes = isLibrary => asyncRoute(async (req, res) => {
    const userId = req.session.user.user_id;
    const view = req.query.view === 'rated' ? 'rated' : 'saved';
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    const sort = ['recent', 'title', 'rating'].includes(req.query.sort) ? req.query.sort : 'recent';
    const requestedPage = typeof req.query.page === 'string' && /^\d{1,7}$/.test(req.query.page)
      ? Math.max(1, Number(req.query.page)) : 1;
    // Escape LIKE wildcards so a search for '%' or '_' means that literal text.
    const search = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const collection = isLibrary ? (view === 'rated' ? 'AND my_rating.rating_id IS NOT NULL' : 'AND saved.recipe_id IS NOT NULL') : '';
    const visibleRecipes = isLibrary
      ? recipeVisibility
      : '(r.user_id IS NULL OR u.is_private = FALSE)';

    const filter = `WHERE ${visibleRecipes} AND (r.title ILIKE $2 OR COALESCE(r.cuisine, '') ILIKE $2) ${collection}`;
    const count = await db.one(`SELECT COUNT(*)::int AS total FROM (${selectRecipe} ${filter}) matching`, [userId, search]);
    const pageCount = Math.max(1, Math.ceil(count.total / PAGE_SIZE));
    const page = Math.min(requestedPage, pageCount);
    const recentColumn = isLibrary ? (view === 'rated' ? 'my_rating.created_at' : 'saved.saved_at') : 'r.created_at';
    const ordering = sort === 'title' ? 'LOWER(r.title), r.recipe_id'
      : sort === 'rating' ? 'COALESCE(my_rating.score, my_rating.rating * 2) DESC NULLS LAST, r.recipe_id DESC'
        : `${recentColumn} DESC, r.recipe_id DESC`;
    // Ordering fragments are allowlisted above; user text is always parameterized.
    const rows = await db.any(`${selectRecipe} ${filter} ORDER BY ${ordering} LIMIT $3 OFFSET $4`,
      [userId, search, PAGE_SIZE, (page - 1) * PAGE_SIZE]);
    const stats = isLibrary ? await db.one(`SELECT
      COUNT(*) FILTER (WHERE is_saved)::int AS saved,
      COUNT(user_rating)::int AS rated,
      COUNT(DISTINCT NULLIF(BTRIM(cuisine), '')) FILTER (WHERE user_rating IS NOT NULL)::int AS cuisines
      FROM (${selectRecipe} WHERE ${recipeVisibility}) visible`, [userId]) : null;
    const base = isLibrary ? '/my-recipes' : '/recipes';
    const link = (newPage, newView = view) => {
      const params = new URLSearchParams({ ...(isLibrary ? { view: newView } : {}), q, sort, page: String(newPage) });
      return `${base}?${params}`;
    };
    res.render('pages/recipes', {
      isLibrary, isRated: isLibrary && view === 'rated', isSaved: isLibrary && view === 'saved',
      title: isLibrary ? 'My Recipes' : 'Recipes',
      recipes: rows.map((row, index) => ({ ...presentRecipe(row), position: (page - 1) * PAGE_SIZE + index + 1 })), stats, q, sort, view, base,
      userInitial: req.session.user.username.slice(0, 1).toUpperCase(),
      recentSort: sort === 'recent', titleSort: sort === 'title', ratingSort: sort === 'rating',
      hasSearch: Boolean(q), total: count.total, page, pageCount,
      previousUrl: page > 1 ? link(page - 1) : null,
      nextUrl: page < pageCount ? link(page + 1) : null,
      savedUrl: link(1, 'saved'), ratedUrl: link(1, 'rated'),
      returnTo: link(page),
    });
  });

  router.get('/recipes', listRecipes(false));
  router.get('/my-recipes', listRecipes(true));
  router.post('/my-recipes/clear-unavailable', verifyCsrf, asyncRoute(async (req, res) => {
    await db.none(`DELETE FROM saved_recipes saved USING recipes r LEFT JOIN users u ON u.user_id = r.user_id
      WHERE saved.recipe_id = r.recipe_id AND saved.user_id = $1 AND NOT ${recipeVisibility}`,
    [req.session.user.user_id]);
    res.redirect(303, '/my-recipes');
  }));
  
  // Display the recipe creation form
  router.get('/recipes/new', (req, res) => {
    res.render('pages/new-recipe', {
      title: 'Post a Recipe'
    });
  });

  // Create a recipe
  router.post('/recipes/new', verifyCsrf, asyncRoute(async (req, res) => {
    const read = value =>
      typeof value === 'string' ? value.trim() : '';

    const body = req.body || {};

    const form = {
      title: read(body.title),
      description: read(body.description),
      cuisine: read(body.cuisine),
      ingredients: read(body.ingredients),
      directions: read(body.directions),
      prep_time: read(body.prep_time),
      cook_time: read(body.cook_time),
      servings: read(body.servings),
      image_url: read(body.image_url)
    };

    const names = [...new Set(
      form.ingredients
        .split(/\r?\n/)
        .map(name => name.trim())
        .filter(Boolean)
    )];

    const validOptionalInt = (raw, min, max) =>
      raw === '' ||
      (/^\d+$/.test(raw) &&
       Number(raw) >= min &&
       Number(raw) <= max);

    let validImage = true;

    if (form.image_url) {
      try {
        const url = new URL(form.image_url);
        validImage =
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password;
      } catch {
        validImage = false;
      }
    }

    let error;

    if (!form.title || !form.directions || !names.length) {
      error = 'Enter a recipe title, at least one ingredient, and directions.';
    } else if (
      form.title.length > 150 ||
      form.cuisine.length > 100 ||
      form.description.length > 2000 ||
      form.directions.length > 10000 ||
      form.ingredients.length > 5000 ||
      names.length > 40 ||
      names.some(name => name.length > 100) ||
      form.image_url.length > 2048
    ) {
      error = 'One or more fields exceed the allowed length.';
    } else if (Object.values(form).some(value => value.includes('\0'))) {
      error = 'Fields cannot contain null characters.';
    } else if (
      !validOptionalInt(form.prep_time, 0, 10080) ||
      !validOptionalInt(form.cook_time, 0, 10080) ||
      !validOptionalInt(form.servings, 1, 1000)
    ) {
      error = 'Enter valid preparation time, cooking time, and serving counts.';
    } else if (!validImage) {
      error = 'Image URL must be a valid http or https URL.';
    }

    if (error) {
      return res.status(400).render('pages/new-recipe', {
        title: 'Post a Recipe',
        form,
        error
      });
    }

    try {
      const recipe = await db.tx(async t => {
        const created = await t.one(
          `INSERT INTO recipes
            (user_id, title, description, directions,
             cuisine, prep_time, cook_time, servings,
             image_url, recipe_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'user')
           RETURNING recipe_id`,
          [
            req.session.user.user_id,
            form.title,
            form.description || null,
            form.directions,
            form.cuisine || null,
            form.prep_time === '' ? null : Number(form.prep_time),
            form.cook_time === '' ? null : Number(form.cook_time),
            form.servings === '' ? null : Number(form.servings),
            form.image_url || null
          ]
        );

        for (const name of names) {
          await t.none(
            `INSERT INTO ingredients (name)
             VALUES ($1)
             ON CONFLICT (name) DO NOTHING`,
            [name]
          );

          const ingredient = await t.one(
            `SELECT ingredient_id
             FROM ingredients
             WHERE name = $1`,
            [name]
          );

          await t.none(
            `INSERT INTO recipe_ingredients
               (recipe_id, ingredient_id)
             VALUES ($1, $2)`,
            [created.recipe_id, ingredient.ingredient_id]
          );
        }

        return created;
      });

      // Open the new recipe at its rating section
      return res.redirect(
        303,
        `/recipes/${recipe.recipe_id}#rating`
      );

    } catch (dbError) {
      console.error('Unable to create recipe:', dbError);

      return res.status(500).render('pages/new-recipe', {
        title: 'Post a Recipe',
        form,
        error: 'Unable to post your recipe. Please try again.'
      });
    }
  }));

  router.get('/recipes/:recipeId', loadRecipe, asyncRoute((req, res) => renderDetail(req, res)));

  router.post('/recipes/:recipeId/save', verifyCsrf, loadRecipe, asyncRoute(async (req, res) => {
    await db.none(`INSERT INTO saved_recipes (user_id, recipe_id) VALUES ($1, $2)
      ON CONFLICT (user_id, recipe_id) DO NOTHING`, [req.session.user.user_id, req.recipeId]);
    res.redirect(303, localReturnTo(req.body.returnTo, `/recipes/${req.recipeId}`));
  }));

  router.post('/recipes/:recipeId/unsave', verifyCsrf, asyncRoute(async (req, res) => {
    // A user can remove their own bookmark even after losing access to a recipe.
    // No hidden recipe data is loaded or rendered by this operation.
    const exists = await db.oneOrNone('SELECT recipe_id FROM recipes WHERE recipe_id = $1', [req.recipeId]);
    if (!exists) return res.status(404).render('pages/recipe-error', { message: 'Recipe not found.' });
    await db.none('DELETE FROM saved_recipes WHERE user_id = $1 AND recipe_id = $2', [req.session.user.user_id, req.recipeId]);
    res.redirect(303, localReturnTo(req.body.returnTo, `/recipes/${req.recipeId}`));
  }));

  router.post('/recipes/:recipeId/nutrition', verifyCsrf, loadRecipe, asyncRoute(async (req, res) => {
    if (req.recipe.user_id !== req.session.user.user_id) {
      return res.status(403).render('pages/recipe-error', { message: 'Only the recipe author can edit its nutrition.' });
    }
    let nutrition;
    try {
      nutrition = parseNutrition(req.body);
    } catch (error) {
      res.status(400);
      return renderDetail(req, res, {
        nutritionError: error.message,
        nutritionInputs: req.recipe.nutrients.map(field => ({
          ...field, value: typeof req.body[field.name] === 'string' ? req.body[field.name] : '',
        })),
      });
    }
    const updated = await db.oneOrNone(`UPDATE recipes SET calories = $1, protein_g = $2, carbs_g = $3, fat_g = $4
      WHERE recipe_id = $5 AND user_id = $6 RETURNING recipe_id`,
    [nutrition.calories, nutrition.protein_g, nutrition.carbs_g, nutrition.fat_g, req.recipeId, req.session.user.user_id]);
    if (!updated) return res.status(404).render('pages/recipe-error', { message: 'Recipe not found.' });
    res.redirect(303, `/recipes/${req.recipeId}#nutrition`);
  }));

  registerCommentRoutes(router, { db, verifyCsrf, loadRecipe, asyncRoute, renderDetail });

  // Rating + comparisons (#10)
  registerRatingRoutes(router, { db, loadRecipe, asyncRoute, verifyCsrf });

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error('Recipe request failed:', error.code || error.message);
    res.status(500).render('pages/recipe-error', { message: 'Unable to load or update recipes right now. Please try again.' });
  });
  return router;
}

module.exports = { createRecipeRouter };
