// Friend feed (#15): recipes posted and ratings given by people the viewer follows.
// Pages use a keyset cursor (time, kind, id) so items never repeat or get
// skipped when new activity arrives while someone is scrolling.

const { recipeVisibility } = require('../recipes/visibility');

const PAGE_SIZE = 10;
const POST = 1;
const RATING = 0;

const activityQuery = `SELECT activity.*, activity.at::text AS cursor_at FROM (
    SELECT ${POST} AS kind_order, r.recipe_id AS item_id, COALESCE(r.created_at, TIMESTAMP 'epoch') AS at,
      actor.username AS actor, r.recipe_id, r.title, r.cuisine, r.description, r.image_url,
      NULL::numeric AS score, NULL::varchar AS sentiment, NULL::int AS stars
    FROM follows f
    JOIN recipes r ON r.user_id = f.following_id
    JOIN users actor ON actor.user_id = r.user_id
    JOIN users u ON u.user_id = r.user_id
    WHERE f.follower_id = $1 AND ${recipeVisibility}
  UNION ALL
    SELECT ${RATING}, rt.rating_id, COALESCE(rt.created_at, TIMESTAMP 'epoch'),
      actor.username, r.recipe_id, r.title, r.cuisine, r.description, r.image_url,
      rt.score, rt.sentiment, rt.rating
    FROM follows f
    JOIN ratings rt ON rt.user_id = f.following_id
    JOIN users actor ON actor.user_id = rt.user_id
    JOIN recipes r ON r.recipe_id = rt.recipe_id
    LEFT JOIN users u ON u.user_id = r.user_id
    WHERE f.follower_id = $1 AND ${recipeVisibility}
) activity`;

const TIMESTAMP_TEXT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/;

function encodeCursor(row) {
  return Buffer.from(JSON.stringify([row.cursor_at, row.kind_order, row.item_id])).toString('base64url');
}

// Returns null for anything that is not a cursor this module produced.
function decodeCursor(value) {
  if (typeof value !== 'string' || value.length > 200) return null;
  try {
    const parts = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(parts) || parts.length !== 3) return null;
    const [at, kind, id] = parts;
    if (typeof at !== 'string' || !TIMESTAMP_TEXT.test(at)) return null;
    if (kind !== POST && kind !== RATING) return null;
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) return null;
    return { at, kind, id };
  } catch {
    return null;
  }
}

async function loadFeedPage(db, { viewerId, cursor = null, pageSize = PAGE_SIZE }) {
  const after = cursor ? 'WHERE (at, kind_order, item_id) < ($2::timestamp, $3, $4)' : '';
  const rows = await db.any(
    `${activityQuery} ${after} ORDER BY at DESC, kind_order DESC, item_id DESC LIMIT $5`,
    [viewerId, cursor?.at ?? null, cursor?.kind ?? null, cursor?.id ?? null, pageSize + 1]
  );
  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize);
  return {
    items: page,
    nextCursor: hasMore ? encodeCursor(page[page.length - 1]) : null,
  };
}

module.exports = { loadFeedPage, encodeCursor, decodeCursor, PAGE_SIZE };
