// TheMealDB import routes (#9). Plugged into the recipe router by registerImportRoutes().
//
//   GET  /recipes/import?q=chicken   search TheMealDB, show results with photos
//   POST /recipes/import/:mealId     save that meal as an official PlateShare recipe
//
// Imported recipes are normal `official` recipes, so rating/saving/search all work on them.
const { MealDbError } = require('./mealdb');

function registerImportRoutes(router, { db, mealDb, asyncRoute, verifyCsrf }) {
  const renderImport = (res, data) => res.render('pages/recipe-import', { importActive: true, ...data });

  router.get('/recipes/import', asyncRoute(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
    if (!q) return renderImport(res, { q });
    let results;
    try {
      results = await mealDb.search(q);
    } catch (error) {
      if (!(error instanceof MealDbError)) throw error;
      return renderImport(res.status(502), { q, error: error.message });
    }
    // Mark meals we already have so the button says "View" instead of "Import".
    const existing = results.length ? await db.any('SELECT recipe_id, mealdb_id FROM recipes WHERE mealdb_id IN ($1:csv)',
      [results.map(r => r.mealdbId)]) : [];
    const imported = new Map(existing.map(row => [Number(row.mealdb_id), row.recipe_id]));
    renderImport(res, {
      q, searched: true,
      resultLabel: `${results.length} result${results.length === 1 ? '' : 's'}`,
      results: results.map(r => ({ ...r, ingredientCount: r.ingredients.length, recipeId: imported.get(r.mealdbId) || null })),
    });
  }));

  router.post('/recipes/import/:mealId', verifyCsrf, asyncRoute(async (req, res) => {
    const { mealId } = req.params;
    if (!/^[1-9]\d{0,9}$/.test(mealId) || Number(mealId) > 2147483647) {
      return res.status(404).render('pages/recipe-error', { message: 'Recipe not found on TheMealDB.' });
    }
    const already = await db.oneOrNone('SELECT recipe_id FROM recipes WHERE mealdb_id = $1', [Number(mealId)]);
    if (already) return res.redirect(303, `/recipes/${already.recipe_id}`);

    let recipe;
    try {
      recipe = await mealDb.lookup(mealId);
    } catch (error) {
      if (!(error instanceof MealDbError)) throw error;
      return renderImport(res.status(502), { q: '', error: error.message });
    }
    if (!recipe) return res.status(404).render('pages/recipe-error', { message: 'Recipe not found on TheMealDB.' });

    const recipeId = await db.tx(async t => {
      const inserted = await t.oneOrNone(`INSERT INTO recipes
          (user_id, title, description, directions, cuisine, image_url, recipe_type, mealdb_id, source_url)
        VALUES (NULL, $1, $2, $3, $4, $5, 'official', $6, $7)
        ON CONFLICT (mealdb_id) DO NOTHING RETURNING recipe_id`,
      [recipe.title, recipe.description, recipe.directions, recipe.cuisine, recipe.imageUrl, recipe.mealdbId, recipe.sourceUrl]);
      // Someone else imported it in the meantime: just use theirs.
      if (!inserted) return (await t.one('SELECT recipe_id FROM recipes WHERE mealdb_id = $1', [recipe.mealdbId])).recipe_id;
      for (const ingredient of recipe.ingredients) {
        // Reuse an existing ingredient row (e.g. "garlic" from the seed data) or create it.
        const { ingredient_id: ingredientId } = await t.one(`INSERT INTO ingredients (name) VALUES ($1)
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING ingredient_id`, [ingredient.name]);
        await t.none(`INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit, notes)
          VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [inserted.recipe_id, ingredientId, ingredient.quantity, ingredient.unit, ingredient.notes]);
      }
      return inserted.recipe_id;
    });
    res.redirect(303, `/recipes/${recipeId}`);
  }));
}

module.exports = { registerImportRoutes };
