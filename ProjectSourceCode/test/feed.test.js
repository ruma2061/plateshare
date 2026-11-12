const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('./helpers/database');
const { loadFeedPage, decodeCursor, encodeCursor } = require('../src/feed/activity');

let db;

before(async () => {
  db = await createDatabase();
});

after(async () => {
  await db?.engine.close();
});

// alice (1) follows bob (2) and private carol (3); dave (4) is a stranger.
beforeEach(async () => {
  await db.engine.exec(`
    TRUNCATE users, recipes, ratings, follows, follow_requests RESTART IDENTITY CASCADE;
    INSERT INTO users (username, password_hash, is_private) VALUES
      ('alice', 'hash', FALSE), ('bob', 'hash', FALSE), ('carol', 'hash', TRUE), ('dave', 'hash', TRUE);
    INSERT INTO follows (follower_id, following_id) VALUES (1, 2), (1, 3);
    INSERT INTO recipes (user_id, title, directions, recipe_type, created_at) VALUES
      (2, 'Bob soup', 'Simmer.', 'user', '2026-11-01 10:00'),
      (3, 'Carol curry', 'Stir.', 'user', '2026-11-02 10:00'),
      (4, 'Dave dumplings', 'Fold.', 'user', '2026-11-03 10:00'),
      (NULL, 'Official rice', 'Boil.', 'official', '2026-10-01 10:00');
    INSERT INTO ratings (recipe_id, user_id, rating, sentiment, score, created_at) VALUES
      (3, 2, 4, 'like', 8.5, '2026-11-04 10:00'),
      (3, 3, 2, 'dislike', 3.0, '2026-11-05 10:00'),
      (1, 3, 5, 'like', 9.0, '2026-11-06 10:00'),
      (3, 1, 3, 'ok', 5.5, '2026-11-07 10:00');
  `);
});

const summary = items => items.map(item => `${item.actor}:${item.kind_order ? 'post' : 'rating'}:${item.title}`);

test('feed shows posts and ratings from followed cooks, newest first', async () => {
  const { items, nextCursor } = await loadFeedPage(db, { viewerId: 1 });
  assert.deepEqual(summary(items), [
    'carol:rating:Bob soup',
    'carol:post:Carol curry',
    'bob:post:Bob soup',
  ]);
  assert.equal(nextCursor, null);
});

test('ratings keep their thumb, score and legacy stars', async () => {
  const { items } = await loadFeedPage(db, { viewerId: 1 });
  const rating = items[0];
  assert.equal(rating.sentiment, 'like');
  assert.equal(Number(rating.score), 9);
  assert.equal(rating.stars, 5);
});

test('ratings on recipes the viewer cannot see are left out', async () => {
  // dave is private and alice does not follow him, so his recipe stays hidden
  // even though bob and carol rated it.
  const { items } = await loadFeedPage(db, { viewerId: 1 });
  assert.ok(items.every(item => item.title !== 'Dave dumplings'));

  await db.none('INSERT INTO follows (follower_id, following_id) VALUES (1, 4)');
  const after = await loadFeedPage(db, { viewerId: 1 });
  assert.ok(after.items.some(item => item.actor === 'bob' && item.title === 'Dave dumplings'));
});

test('ratings on official recipes appear in the feed', async () => {
  await db.none(`INSERT INTO ratings (recipe_id, user_id, rating, created_at) VALUES (4, 2, 3, '2026-11-08 10:00')`);
  const { items } = await loadFeedPage(db, { viewerId: 1 });
  assert.equal(summary(items)[0], 'bob:rating:Official rice');
});

test('an account that follows nobody gets an empty feed', async () => {
  const { items, nextCursor } = await loadFeedPage(db, { viewerId: 4 });
  assert.deepEqual(items, []);
  assert.equal(nextCursor, null);
});

test('cursor pages walk the whole feed without repeats, even with tied times', async () => {
  // 25 posts by bob sharing one timestamp force the id tiebreaker to matter.
  await db.engine.exec(`
    INSERT INTO recipes (user_id, title, directions, recipe_type, created_at)
    SELECT 2, 'Batch ' || n, 'Cook.', 'user', '2026-11-10 12:00' FROM generate_series(1, 25) n;
  `);
  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const page = await loadFeedPage(db, { viewerId: 1, cursor, pageSize: 4 });
    seen.push(...page.items.map(item => `${item.kind_order}:${item.item_id}`));
    cursor = page.nextCursor && decodeCursor(page.nextCursor);
    pages += 1;
  } while (cursor && pages < 50);

  assert.equal(seen.length, 28);
  assert.equal(new Set(seen).size, 28);
  assert.equal(pages, 7);
});

test('new activity does not shift later pages', async () => {
  const first = await loadFeedPage(db, { viewerId: 1, pageSize: 2 });
  await db.none(`INSERT INTO recipes (user_id, title, directions, recipe_type) VALUES (2, 'Brand new', 'Fresh.', 'user')`);
  const second = await loadFeedPage(db, { viewerId: 1, cursor: decodeCursor(first.nextCursor), pageSize: 2 });
  assert.deepEqual(summary(second.items), ['bob:post:Bob soup']);
});

test('cursors round-trip and reject tampered values', () => {
  const token = encodeCursor({ cursor_at: '2026-11-06 10:00:00.123456', kind_order: 0, item_id: 7 });
  assert.deepEqual(decodeCursor(token), { at: '2026-11-06 10:00:00.123456', kind: 0, id: 7 });

  const forge = parts => Buffer.from(JSON.stringify(parts)).toString('base64url');
  for (const bad of [
    undefined, '', 'not-a-cursor', 'x'.repeat(300),
    forge(["2026-11-06'; DROP TABLE users;--", 0, 7]),
    forge(['2026-11-06 10:00:00', 2, 7]),
    forge(['2026-11-06 10:00:00', 0, 0]),
    forge(['2026-11-06 10:00:00', 0, 1.5]),
    forge({ at: '2026-11-06 10:00:00' }),
  ]) {
    assert.equal(decodeCursor(bad), null, `should reject ${bad}`);
  }
});
