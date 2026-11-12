const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('./helpers/database');
const { createSite } = require('./helpers/site');
const { timeAgo } = require('../src/feed/router');

let db, site;

before(async () => {
  db = await createDatabase();
  site = await createSite(db);
});

after(async () => {
  await site?.close();
  await db?.engine.close();
});

// alice (1) follows bob (2). carol (3) follows nobody.
beforeEach(async () => {
  await db.engine.exec(`
    TRUNCATE users, recipes, ratings, follows, follow_requests RESTART IDENTITY CASCADE;
    INSERT INTO users (username, password_hash) VALUES ('alice', 'hash'), ('bob', 'hash'), ('carol', 'hash');
    INSERT INTO follows (follower_id, following_id) VALUES (1, 2);
    INSERT INTO recipes (user_id, title, directions, recipe_type, cuisine, image_url, created_at) VALUES
      (2, 'Bob soup', 'Simmer.', 'user', 'Ethiopian', 'javascript:alert(1)', '2026-11-01 10:00'),
      (3, '<b>Carol</b> curry', 'Stir.', 'user', NULL, NULL, '2026-11-02 10:00');
    INSERT INTO ratings (recipe_id, user_id, rating, sentiment, score, created_at) VALUES
      (2, 2, 4, 'like', 8.5, '2026-11-03 10:00');
  `);
});

test('guests are sent to login', async () => {
  const guest = await site.client();
  const response = await guest.request('/feed');
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/login');
});

test('feed page lists friend posts and ratings with safe output', async () => {
  const alice = await site.client(1);
  const response = await alice.request('/feed');
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /<title>Friends feed · PlateShare<\/title>/);
  assert.match(html, /href="\/feed" aria-current="page"/);
  assert.match(html, /bob<\/a>\s*rated a recipe/);
  assert.match(html, /bob<\/a>\s*posted a recipe/);
  assert.match(html, /Liked it/);
  assert.match(html, /8\.5 \/ 10/);
  // Recipe titles are escaped and unsafe image URLs are dropped.
  assert.match(html, /&lt;b&gt;Carol&lt;\/b&gt; curry/);
  assert.doesNotMatch(html, /javascript:alert/);
  // Rating appears above the older post.
  assert.ok(html.indexOf('rated a recipe') < html.indexOf('posted a recipe'));
  assert.match(html, /You're all caught up/);
});

test('someone who follows nobody is pointed to Find cooks', async () => {
  const carol = await site.client(3);
  const html = await (await carol.request('/feed')).text();
  assert.match(html, /You're not following anyone yet/);
  assert.match(html, /href="\/discover"/);
});

test('following someone quiet shows a different empty state', async () => {
  await db.none('INSERT INTO follows (follower_id, following_id) VALUES (3, 1)');
  const carol = await site.client(3);
  const html = await (await carol.request('/feed')).text();
  assert.match(html, /Nothing here yet/);
});

test('long feeds link to the next page and the pages join up', async () => {
  await db.engine.exec(`
    INSERT INTO recipes (user_id, title, directions, recipe_type, created_at)
    SELECT 2, 'Batch ' || LPAD(n::text, 2, '0'), 'Cook.', 'user', TIMESTAMP '2026-11-10 12:00' + n * INTERVAL '1 minute'
    FROM generate_series(1, 12) n;
  `);
  const alice = await site.client(1);
  const first = await (await alice.request('/feed')).text();
  const next = first.match(/href="(\/feed\?before[^"]+)" data-feed-more/)?.[1];
  assert.ok(next, 'expected a Load more link');
  assert.equal((first.match(/class="feed-item"/g) || []).length, 10);

  const second = await (await alice.request(next.replace(/&#x3D;/g, '=').replace(/&amp;/g, '&'))).text();
  assert.equal((second.match(/class="feed-item"/g) || []).length, 4);
  assert.doesNotMatch(second, /Batch 03/);
  assert.match(second, /Batch 02/);
  assert.match(second, /Bob soup/);
});

test('a tampered cursor restarts the feed instead of erroring', async () => {
  const alice = await site.client(1);
  const response = await alice.request('/feed?before=bogus');
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/feed');
});

test('time labels read naturally', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  assert.equal(timeAgo(new Date('2026-11-12T11:59:30Z'), now), 'just now');
  assert.equal(timeAgo(new Date('2026-11-12T11:15:00Z'), now), '45m ago');
  assert.equal(timeAgo(new Date('2026-11-12T07:00:00Z'), now), '5h ago');
  assert.equal(timeAgo(new Date('2026-11-09T12:00:00Z'), now), '3d ago');
  assert.equal(timeAgo(new Date('2026-10-01T12:00:00Z'), now), 'Oct 1');
  assert.equal(timeAgo(new Date('2025-10-01T12:00:00Z'), now), 'Oct 1, 2025');
});
