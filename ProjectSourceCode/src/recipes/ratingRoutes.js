// Rating routes (#10). Plugged into the recipe router by registerRatingRoutes().
//
//   POST /recipes/:id/rate         pick a thumb -> start comparisons (or save if none)
//   GET  /recipes/:id/rate         "Which was better?" page
//   POST /recipes/:id/rate/answer  better | worse | skip -> next question or save
//
// The in-progress search lives in req.session.ratingSearch until it is saved.
const {
  SENTIMENTS, parseSentiment, scoreFor, starsFromScore,
  startSearch, nextComparison, applyAnswer, skipSearch,
} = require('./rating');
const { presentRecipe } = require('./presentation');
const { recipeVisibility } = require('./visibility');

function registerRatingRoutes(router, { db, loadRecipe, asyncRoute, verifyCsrf }) {
  const fail = (res, status, message) => res.status(status).render('pages/recipe-error', { message });

  // Renumber one thumb group 1..n (closes gaps) and recompute every score in it.
  async function rescoreGroup(t, userId, sentiment) {
    const rows = await t.any(`SELECT rating_id FROM ratings WHERE user_id = $1 AND sentiment = $2
      ORDER BY rank_position, created_at, rating_id`, [userId, sentiment]);
    for (const [index, row] of rows.entries()) {
      const score = scoreFor(sentiment, index + 1, rows.length);
      await t.none('UPDATE ratings SET rank_position = $1, score = $2, rating = $3 WHERE rating_id = $4',
        [index + 1, score, starsFromScore(score), row.rating_id]);
    }
  }

  // Insert the rating directly above `beforeRecipeId` in its group, or at the bottom if null.
  async function saveRating(userId, recipeId, sentiment, beforeRecipeId) {
    await db.tx(async t => {
      // Re-rating replaces the old rating (and fixes the group it left).
      const old = await t.oneOrNone('SELECT sentiment FROM ratings WHERE user_id = $1 AND recipe_id = $2', [userId, recipeId]);
      await t.none('DELETE FROM ratings WHERE user_id = $1 AND recipe_id = $2', [userId, recipeId]);
      if (old?.sentiment && old.sentiment !== sentiment) await rescoreGroup(t, userId, old.sentiment);

      const anchor = beforeRecipeId === null ? null : await t.oneOrNone(`SELECT rank_position FROM ratings
        WHERE user_id = $1 AND recipe_id = $2 AND sentiment = $3`, [userId, beforeRecipeId, sentiment]);
      let rank;
      if (anchor) {
        rank = anchor.rank_position;
        await t.none(`UPDATE ratings SET rank_position = rank_position + 1
          WHERE user_id = $1 AND sentiment = $2 AND rank_position >= $3`, [userId, sentiment, rank]);
      } else {
        rank = (await t.one(`SELECT COALESCE(MAX(rank_position), 0) + 1 AS next FROM ratings
          WHERE user_id = $1 AND sentiment = $2`, [userId, sentiment])).next;
      }
      // rating/score are placeholders; rescoreGroup sets the real values right after.
      await t.none(`INSERT INTO ratings (recipe_id, user_id, rating, sentiment, rank_position, score)
        VALUES ($1, $2, 3, $3, $4, 5)`, [recipeId, userId, sentiment, rank]);
      await rescoreGroup(t, userId, sentiment);
    });
  }

  // Either save (no questions left) or send the user to the next question.
  async function continueSearch(req, res) {
    const search = req.session.ratingSearch;
    if (nextComparison(search) !== null) return res.redirect(303, `/recipes/${search.recipeId}/rate`);
    delete req.session.ratingSearch;
    await saveRating(req.session.user.user_id, search.recipeId, search.sentiment, search.list[search.low] ?? null);
    return res.redirect(303, `/recipes/${search.recipeId}#rating`);
  }

  const activeSearch = req => {
    const search = req.session.ratingSearch;
    return search && search.recipeId === req.recipeId ? search : null;
  };

  router.post('/recipes/:recipeId/rate', verifyCsrf, loadRecipe, asyncRoute(async (req, res) => {
    const userId = req.session.user.user_id;
    if (req.recipe.user_id === userId) return fail(res, 403, "You can't rate your own recipe.");
    let sentiment;
    try {
      sentiment = parseSentiment(req.body.sentiment);
    } catch (error) {
      return fail(res, 400, error.message);
    }
    // Only compare against recipes the user can still see; best -> worst.
    const list = (await db.any(`SELECT ra.recipe_id FROM ratings ra
      JOIN recipes r ON r.recipe_id = ra.recipe_id
      LEFT JOIN users u ON u.user_id = r.user_id
      WHERE ra.user_id = $1 AND ra.sentiment = $2 AND ra.recipe_id <> $3 AND ${recipeVisibility}
      ORDER BY ra.rank_position`, [userId, sentiment, req.recipeId])).map(row => row.recipe_id);
    req.session.ratingSearch = { recipeId: req.recipeId, sentiment, list, ...startSearch(list.length) };
    return continueSearch(req, res);
  }));

  router.get('/recipes/:recipeId/rate', loadRecipe, asyncRoute(async (req, res) => {
    const search = activeSearch(req);
    if (!search || nextComparison(search) === null) return res.redirect(303, `/recipes/${req.recipeId}`);
    const otherRow = await db.oneOrNone(`SELECT r.*, u.username AS author FROM recipes r
      LEFT JOIN users u ON u.user_id = r.user_id
      WHERE r.recipe_id = $2 AND ${recipeVisibility}`, [req.session.user.user_id, search.list[nextComparison(search)]]);
    if (!otherRow) {
      // That recipe was deleted or hidden mid-search: drop it and start over.
      search.list = search.list.filter(id => id !== search.list[nextComparison(search)]);
      Object.assign(search, startSearch(search.list.length));
      return continueSearch(req, res);
    }
    const questionsLeft = Math.ceil(Math.log2(search.high - search.low + 1));
    res.render('pages/rate', {
      recipe: req.recipe,
      choices: [
        { answer: 'better', tag: 'Just tried', item: req.recipe },
        { answer: 'worse', tag: 'Rated before', item: presentRecipe(otherRow) },
      ],
      sentimentEmoji: SENTIMENTS[search.sentiment].emoji,
      sentimentLabel: SENTIMENTS[search.sentiment].label,
      questionsLeft, oneLeft: questionsLeft === 1,
    });
  }));

  router.post('/recipes/:recipeId/rate/answer', verifyCsrf, loadRecipe, asyncRoute(async (req, res) => {
    const search = activeSearch(req);
    if (!search) return res.redirect(303, `/recipes/${req.recipeId}`);
    const { answer } = req.body;
    if (answer === 'better') Object.assign(search, applyAnswer(search, true));
    else if (answer === 'worse') Object.assign(search, applyAnswer(search, false));
    else if (answer === 'skip') Object.assign(search, skipSearch(search));
    else return fail(res, 400, 'Pick which recipe was better, or skip.');
    return continueSearch(req, res);
  }));
}

module.exports = { registerRatingRoutes };
