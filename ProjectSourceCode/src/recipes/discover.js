const auth = require('../middleware/auth');
const { prepareCsrf } = require('../middleware/csrf');
const { presentRecipe } = require('./presentation');
const { recipeVisibility } = require('./visibility');

const FEED_SIZE = 6;

function presentFeedRecipe(row) {
  const recipe = presentRecipe(row);
  // Never load an insecure or credential-bearing third-party image in the feed.
  if (recipe.image_url) {
    const url = new URL(recipe.image_url);
    if (url.protocol !== 'https:' || url.username || url.password) recipe.image_url = null;
  }
  return {
    ...recipe,
    prepLabel: row.prep_time == null ? 'Not provided' : `${row.prep_time} min`,
    cookLabel: row.cook_time == null ? 'Not provided' : `${row.cook_time} min`,
  };
}

function registerDiscoverRoutes(router, { db, selectRecipe, asyncRoute }) {
  router.get(['/discover', '/discover/feed'], (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    // Fetches get a status to handle, not a login document to append as recipes.
    if (req.path === '/discover/feed' && !req.session.user) {
      return res.status(401).send('Please sign in again.');
    }
    return auth(req, res, next);
  }, prepareCsrf, asyncRoute(async (req, res) => {
    const before = req.query.before;
    if (before !== undefined && (typeof before !== 'string' || !/^[1-9]\d{0,9}$/.test(before) || Number(before) > 2147483647)) {
      return res.status(400).send('Invalid feed position. Open Discover to start again.');
    }
    // ID keyset pagination stays stable when newer posts are added or deleted.
    // Fetch one extra row to determine whether another batch exists, without COUNT.
    const rows = await db.any(`${selectRecipe}
      WHERE ${recipeVisibility} ${before ? 'AND r.recipe_id < $2' : ''}
      ORDER BY r.recipe_id DESC LIMIT ${FEED_SIZE + 1}`,
    before ? [req.session.user.user_id, Number(before)] : [req.session.user.user_id]);
    const recipes = rows.slice(0, FEED_SIZE).map(presentFeedRecipe);
    const nextUrl = rows.length > FEED_SIZE ? `/discover?before=${recipes.at(-1).recipe_id}` : null;
    res.render(req.path === '/discover/feed' ? 'partials/discover-batch' : 'pages/discover', {
      ...(req.path === '/discover/feed' ? { layout: false } : {}),
      title: 'Discover', recipes, nextUrl,
      returnTo: before ? `/discover?before=${before}` : '/discover',
      isContinuation: Boolean(before),
    });
  }));
}

module.exports = { registerDiscoverRoutes, presentFeedRecipe };
