const express = require('express');
const { randomBytes } = require('node:crypto');
const auth = require('../middleware/auth');
const { parseNutrition, nutritionForDisplay } = require('./nutrition');

const PAGE_SIZE = 12;
const ORIGIN = 'http://plateshare.local';
const selectRecipe = `SELECT r.*, u.username AS author,
  my_rating.rating AS user_rating,
  (saved.recipe_id IS NOT NULL) AS is_saved
  FROM recipes r
  LEFT JOIN users u ON u.user_id = r.user_id
  LEFT JOIN ratings my_rating ON my_rating.recipe_id = r.recipe_id AND my_rating.user_id = $1
  LEFT JOIN saved_recipes saved ON saved.recipe_id = r.recipe_id AND saved.user_id = $1`;

function presentRecipe(recipe) {
  let imageUrl = null;
  try {
    const url = new URL(recipe.image_url);
    if (['http:', 'https:'].includes(url.protocol)) imageUrl = url.href;
  } catch { /* Recipes may have no photo. */ }
  return { ...recipe, image_url: imageUrl, author: recipe.author || 'PlateShare', ...nutritionForDisplay(recipe) };
}

function localReturnTo(value, fallback) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback;
  try {
    const url = new URL(value, ORIGIN);
    if (url.origin === ORIGIN && /^\/(my-recipes|recipes(?:\/[1-9]\d*)?)$/.test(url.pathname)) {
      return url.pathname + url.search;
    }
  } catch { /* Use the recipe detail page for invalid return targets. */ }
  return fallback;
}

function createRecipeRouter(db) {
  const router = express.Router();
  // Scope authentication/CSRF setup to these features; login routes remain public.
  router.use(['/recipes', '/my-recipes'], auth, (req, res, next) => {
    if (!req.session.recipeCsrfToken) req.session.recipeCsrfToken = randomBytes(32).toString('hex');
    res.locals.csrfToken = req.session.recipeCsrfToken;
    res.locals.recipeStyles = true;
    next();
  });

  const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
  const verifyCsrf = (req, res, next) => {
    if (typeof req.body._csrf !== 'string' || req.body._csrf !== req.session.recipeCsrfToken) {
      return res.status(403).render('pages/recipe-error', { message: 'This form expired. Reload the page and try again.' });
    }
    next();
  };

  router.param('recipeId', (req, res, next, value) => {
    if (!/^[1-9]\d*$/.test(value) || Number(value) > 2147483647) {
      return res.status(404).render('pages/recipe-error', { message: 'Recipe not found.' });
    }
    req.recipeId = Number(value);
    next();
  });

  const loadRecipe = asyncRoute(async (req, res, next) => {
    const row = await db.oneOrNone(`${selectRecipe} WHERE r.recipe_id = $2`, [req.session.user.user_id, req.recipeId]);
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
      isOwner: req.recipe.user_id === req.session.user.user_id,
      nutritionInputs: req.recipe.nutrients,
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
    const filter = `WHERE (r.title ILIKE $2 OR COALESCE(r.cuisine, '') ILIKE $2) ${collection}`;
    const count = await db.one(`SELECT COUNT(*)::int AS total FROM (${selectRecipe} ${filter}) matching`, [userId, search]);
    const pageCount = Math.max(1, Math.ceil(count.total / PAGE_SIZE));
    const page = Math.min(requestedPage, pageCount);
    const recentColumn = isLibrary ? (view === 'rated' ? 'my_rating.created_at' : 'saved.saved_at') : 'r.created_at';
    const ordering = sort === 'title' ? 'LOWER(r.title), r.recipe_id'
      : sort === 'rating' ? 'my_rating.rating DESC NULLS LAST, r.recipe_id DESC'
        : `${recentColumn} DESC, r.recipe_id DESC`;
    // Ordering fragments are allowlisted above; user text is always parameterized.
    const rows = await db.any(`${selectRecipe} ${filter} ORDER BY ${ordering} LIMIT $3 OFFSET $4`,
      [userId, search, PAGE_SIZE, (page - 1) * PAGE_SIZE]);
    const stats = isLibrary ? await db.one(`SELECT
      (SELECT COUNT(*)::int FROM saved_recipes WHERE user_id = $1) AS saved,
      (SELECT COUNT(*)::int FROM ratings WHERE user_id = $1) AS rated`, [userId]) : null;
    const base = isLibrary ? '/my-recipes' : '/recipes';
    const link = (newPage, newView = view) => {
      const params = new URLSearchParams({ ...(isLibrary ? { view: newView } : {}), q, sort, page: String(newPage) });
      return `${base}?${params}`;
    };
    res.render('pages/recipes', {
      isLibrary, isRated: isLibrary && view === 'rated', isSaved: isLibrary && view === 'saved',
      title: isLibrary ? 'My Recipes' : 'Recipes',
      recipes: rows.map(presentRecipe), stats, q, sort, view, base,
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
  router.get('/recipes/:recipeId', loadRecipe, asyncRoute((req, res) => renderDetail(req, res)));

  router.post('/recipes/:recipeId/save', verifyCsrf, loadRecipe, asyncRoute(async (req, res) => {
    await db.none(`INSERT INTO saved_recipes (user_id, recipe_id) VALUES ($1, $2)
      ON CONFLICT (user_id, recipe_id) DO NOTHING`, [req.session.user.user_id, req.recipeId]);
    res.redirect(303, localReturnTo(req.body.returnTo, `/recipes/${req.recipeId}`));
  }));

  router.post('/recipes/:recipeId/unsave', verifyCsrf, loadRecipe, asyncRoute(async (req, res) => {
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

  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    console.error('Recipe request failed:', error.code || error.message);
    res.status(500).render('pages/recipe-error', { message: 'Unable to load or update recipes right now. Please try again.' });
  });
  return router;
}

module.exports = { createRecipeRouter };
