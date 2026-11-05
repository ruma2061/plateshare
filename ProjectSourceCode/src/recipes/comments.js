const COMMENT_PAGE_SIZE = 50;
const MAX_COMMENT_LENGTH = 2000;

function parseComment(value) {
  if (typeof value !== 'string') return null;
  const body = value.trim();
  // PostgreSQL text cannot contain NUL. Count Unicode code points like char_length.
  if (!body || body.includes('\0') || [...body].length > MAX_COMMENT_LENGTH) return null;
  return body;
}

async function loadComments(db, recipeId, query = {}) {
  const requested = typeof query.commentsPage === 'string' && /^\d{1,7}$/.test(query.commentsPage)
    ? Math.max(1, Number(query.commentsPage)) : 1;
  const { total } = await db.one('SELECT COUNT(*)::int AS total FROM recipe_comments WHERE recipe_id = $1', [recipeId]);
  const pageCount = Math.max(1, Math.ceil(total / COMMENT_PAGE_SIZE));
  const page = Math.min(requested, pageCount);
  const rows = await db.any(`SELECT c.comment_id, c.body, c.created_at, u.username
    FROM recipe_comments c JOIN users u ON u.user_id = c.user_id
    WHERE c.recipe_id = $1 ORDER BY c.created_at DESC, c.comment_id DESC
    LIMIT $2 OFFSET $3`, [recipeId, COMMENT_PAGE_SIZE, (page - 1) * COMMENT_PAGE_SIZE]);
  const link = number => `/recipes/${recipeId}?commentsPage=${number}#comments`;
  return {
    comments: rows.map(row => ({
      ...row,
      authorUrl: `/profile/${encodeURIComponent(row.username)}`,
      createdIso: new Date(row.created_at).toISOString(),
      createdLabel: new Date(row.created_at).toUTCString(),
    })),
    commentCount: total,
    commentsPage: page,
    commentsPageCount: pageCount,
    newerCommentsUrl: page > 1 ? link(page - 1) : null,
    olderCommentsUrl: page < pageCount ? link(page + 1) : null,
  };
}

function registerCommentRoutes(router, { db, verifyCsrf, loadRecipe, asyncRoute, renderDetail }) {
  // The parent recipe router requires login. loadRecipe enforces the same privacy
  // rules for comments as for the recipe itself, including approved follows.
  router.post('/recipes/:recipeId/comments', verifyCsrf, loadRecipe, asyncRoute(async (req, res) => {
    const body = parseComment(req.body.body);
    if (body === null) {
      res.status(400);
      return renderDetail(req, res, {
        commentError: 'Enter a comment between 1 and 2,000 characters, without null characters.',
        commentBody: typeof req.body.body === 'string' ? req.body.body.slice(0, 8000).replace(/\0/g, '') : '',
      });
    }
    await db.none('INSERT INTO recipe_comments (recipe_id, user_id, body) VALUES ($1, $2, $3)',
      [req.recipeId, req.session.user.user_id, body]);
    res.redirect(303, `/recipes/${req.recipeId}#comments`);
  }));
}

module.exports = { parseComment, loadComments, registerCommentRoutes };
