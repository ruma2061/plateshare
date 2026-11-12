const express = require('express');
const auth = require('../middleware/auth');
const { SENTIMENTS } = require('../recipes/rating');
const { loadFeedPage, decodeCursor } = require('./activity');

function safeImageUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function timeAgo(date, now = new Date()) {
  const seconds = Math.max(0, Math.round((now - date) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

function presentFeedItem(row, now) {
  const isPost = row.kind_order === 1;
  const at = new Date(row.at);
  const score = row.score == null ? null : Number(row.score).toFixed(1);
  return {
    isPost,
    isRating: !isPost,
    actor: row.actor,
    actorInitial: row.actor.charAt(0).toUpperCase(),
    actorUrl: `/profile/${encodeURIComponent(row.actor)}`,
    recipeUrl: `/recipes/${row.recipe_id}`,
    title: row.title,
    cuisine: row.cuisine,
    description: isPost ? row.description : null,
    imageUrl: safeImageUrl(row.image_url),
    isoTime: Number.isNaN(at.getTime()) ? '' : at.toISOString(),
    timeLabel: Number.isNaN(at.getTime()) ? '' : timeAgo(at, now),
    sentiment: Object.hasOwn(SENTIMENTS, row.sentiment || '') ? SENTIMENTS[row.sentiment] : null,
    score,
    stars: score === null ? row.stars : null,
  };
}

function createFeedRouter(db) {
  const router = express.Router();

  router.get('/feed', auth, async (req, res, next) => {
    try {
      const viewerId = req.session.user.user_id;
      let cursor = null;
      if (req.query.before !== undefined) {
        cursor = decodeCursor(req.query.before);
        if (!cursor) {
          return req.query.partial === '1' ? res.status(400).send('Invalid feed position.') : res.redirect('/feed');
        }
      }

      const partial = req.query.partial === '1';
      if (partial && !cursor) return res.status(400).send('Missing feed position.');

      const { items, nextCursor } = await loadFeedPage(db, { viewerId, cursor });
      const now = new Date();
      const nextUrl = nextCursor ? `/feed?before=${encodeURIComponent(nextCursor)}` : null;

      // Infinite scroll asks for just the next batch of cards.
      if (partial) {
        res.set('Cache-Control', 'no-store');
        if (nextUrl) res.set('X-Feed-Next', nextUrl);
        return res.render('partials/feed-items', {
          layout: false,
          items: items.map(row => presentFeedItem(row, now)),
        });
      }

      const following = cursor ? null : await db.one(
        'SELECT COUNT(*)::int AS count FROM follows WHERE follower_id = $1', [viewerId]);

      return res.render('pages/feed', {
        title: 'Friends feed',
        feedActive: true,
        items: items.map(row => presentFeedItem(row, now)),
        isFirstPage: !cursor,
        followsSomeone: !following || following.count > 0,
        nextUrl,
      });
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

module.exports = { createFeedRouter, presentFeedItem, timeAgo };
