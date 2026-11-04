const { presentRecipe } = require('../recipes/presentation');
const { recipeVisibility } = require('../recipes/visibility');

const PAGE_SIZE = 12;

// Called only after the profile route has authorized the viewer.
async function loadProfileContent(db, { profileUser, viewerId, query }) {
  const view = query.view === 'rated' ? 'rated' : 'recipes';
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '';
  const sort = ['recent', 'title', 'rating'].includes(query.sort) ? query.sort : 'recent';
  const requestedPage = typeof query.page === 'string' && /^\d{1,7}$/.test(query.page)
    ? Math.max(1, Number(query.page)) : 1;
  const select = `SELECT r.*, u.username AS author, my_rating.rating AS user_rating,
    profile_rating.rating AS profile_rating, profile_rating.created_at AS rated_at,
    (saved.recipe_id IS NOT NULL) AS is_saved
    FROM recipes r
    LEFT JOIN users u ON u.user_id = r.user_id
    LEFT JOIN ratings my_rating ON my_rating.recipe_id = r.recipe_id AND my_rating.user_id = $1
    LEFT JOIN ratings profile_rating ON profile_rating.recipe_id = r.recipe_id AND profile_rating.user_id = $2
    LEFT JOIN saved_recipes saved ON saved.recipe_id = r.recipe_id AND saved.user_id = $1`;
  const stats = await db.one(`SELECT
    COUNT(*) FILTER (WHERE user_id = $2)::int AS recipes,
    COUNT(profile_rating)::int AS rated,
    COUNT(DISTINCT NULLIF(BTRIM(cuisine), '')) FILTER (WHERE profile_rating IS NOT NULL)::int AS cuisines
    FROM (${select} WHERE ${recipeVisibility}) visible`, [viewerId, profileUser.user_id]);
  const collection = view === 'rated' ? 'profile_rating.rating_id IS NOT NULL' : 'r.user_id = $2';
  const search = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
  const filter = `WHERE ${recipeVisibility} AND ${collection}
    AND (r.title ILIKE $3 OR COALESCE(r.cuisine, '') ILIKE $3)`;
  const count = await db.one(`SELECT COUNT(*)::int AS total FROM (${select} ${filter}) matching`,
    [viewerId, profileUser.user_id, search]);
  const pageCount = Math.max(1, Math.ceil(count.total / PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const ordering = sort === 'title' ? 'LOWER(r.title), r.recipe_id'
    : sort === 'rating' ? 'profile_rating.rating DESC NULLS LAST, r.recipe_id DESC'
      : `${view === 'rated' ? 'profile_rating.created_at' : 'r.created_at'} DESC, r.recipe_id DESC`;
  const rows = await db.any(`${select} ${filter} ORDER BY ${ordering} LIMIT $4 OFFSET $5`,
    [viewerId, profileUser.user_id, search, PAGE_SIZE, (page - 1) * PAGE_SIZE]);
  const base = `/profile/${encodeURIComponent(profileUser.username)}`;
  const link = (newPage, newView = view) => `${base}?${new URLSearchParams({ view: newView, q, sort, page: String(newPage) })}`;
  return {
    stats, view, q, sort, base, total: count.total, page, pageCount,
    isRated: view === 'rated', isPosted: view === 'recipes', hasSearch: Boolean(q),
    recentSort: sort === 'recent', titleSort: sort === 'title', ratingSort: sort === 'rating',
    recipes: rows.map((row, index) => ({ ...presentRecipe(row), position: (page - 1) * PAGE_SIZE + index + 1 })),
    postedUrl: link(1, 'recipes'), ratedUrl: link(1, 'rated'), returnTo: link(page),
    previousUrl: page > 1 ? link(page - 1) : null,
    nextUrl: page < pageCount ? link(page + 1) : null,
  };
}

module.exports = { loadProfileContent };
