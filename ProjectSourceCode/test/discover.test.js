const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('./helpers/database');
const { createSite } = require('./helpers/site');
let db, site;

before(async () => { db = await createDatabase(); site = await createSite(db); });
after(async () => { await site?.close(); await db?.engine.close(); });
beforeEach(async () => {
  await db.engine.exec(`
    TRUNCATE users, recipes RESTART IDENTITY CASCADE;
    INSERT INTO users (username, password_hash) VALUES ('alice', 'hash'), ('bob', 'hash');
    INSERT INTO recipes (user_id, title, directions, prep_time, cook_time, servings, image_url)
    VALUES (1, 'Garden soup', 'Simmer.', 0, 20, 2, 'https://example.com/soup.jpg'),
           (2, 'Private pasta', 'Boil.', NULL, NULL, NULL, NULL);
    INSERT INTO recipes (title, directions, recipe_type)
    SELECT 'Official ' || n, 'Cook.', 'official' FROM generate_series(1, 12) n;
  `);
});
const ids = html => Array.from(html.matchAll(/data-recipe-id="(\d+)"/g), m => Number(m[1]));

test('public recipe posts are discoverable without following their authors', async () => {
  const alice = await site.client(1);
  assert.deepEqual(await db.any('SELECT * FROM follows'), []);
  // Both a public account's recipe and an official recipe are eligible.
  const html = await (await alice.request('/discover?before=4')).text();
  assert.deepEqual(ids(html), [3, 2, 1]);
  assert.match(html, /Private pasta/); // The fixture's author is public by default.
  assert.match(html, /Official 1/);
});

test('a database containing only inaccessible private posts shows an empty message', async () => {
  await db.none('DELETE FROM recipes WHERE user_id IS NULL OR user_id = 1');
  await db.none('UPDATE users SET is_private = TRUE WHERE user_id = 2');
  const alice = await site.client(1);
  for (const path of ['/discover', '/discover/feed']) {
    const response = await alice.request(path);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.deepEqual(ids(html), []);
    assert.match(html, /No recipes to show yet/);
    assert.doesNotMatch(html, /Private pasta|data-feed-next/);
  }
});

test('page and fragment require login; invalid and repeated cursors return 400', async () => {
  const guest = await site.client();
  assert.equal((await guest.request('/discover')).headers.get('location'), '/login');
  assert.equal((await guest.request('/discover/feed')).status, 401);
  const alice = await site.client(1);
  for (const path of ['/discover', '/discover/feed']) {
    for (const query of ['before=0', 'before=-1', 'before=2147483648', 'before=abc', 'before=1&before=2', 'before[x]=1']) {
      assert.equal((await alice.request(`${path}?${query}`)).status, 400, query);
    }
  }
});

test('cursor batches remain stable across inserts and deletion of the cursor recipe', async () => {
  const alice = await site.client(1);
  const firstResponse = await alice.request('/discover');
  assert.equal(firstResponse.headers.get('cache-control'), 'no-store');
  const first = await firstResponse.text();
  assert.deepEqual(ids(first), [14, 13, 12, 11, 10, 9]);
  assert.match(first, /href="\/discover\?before&#x3D;9"/);
  await db.none("INSERT INTO recipes (title, directions, recipe_type) VALUES ('New arrival', 'Cook', 'official')");
  await db.none('DELETE FROM recipes WHERE recipe_id = 9');
  const response = await alice.request('/discover/feed?before=9');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /text\/html/);
  const second = await response.text();
  assert.deepEqual(ids(second), [8, 7, 6, 5, 4, 3]);
  assert.doesNotMatch(second, /<!DOCTYPE|New arrival|site-header/);
  const third = await (await alice.request('/discover/feed?before=3')).text();
  assert.deepEqual(ids(third), [2, 1]);
  assert.doesNotMatch(third, /data-feed-next/);
  assert.match(third, /caught up/);
  assert.deepEqual(ids(await (await alice.request('/discover?before=9')).text()), [8, 7, 6, 5, 4, 3]);
});

test('every batch enforces privacy, including revocation and pending requests', async () => {
  const alice = await site.client(1);
  await db.none('UPDATE users SET is_private = TRUE WHERE user_id = 2');
  await db.none('INSERT INTO follow_requests (requester_id, recipient_id) VALUES (1, 2)');
  assert.deepEqual(ids(await (await alice.request('/discover/feed?before=3')).text()), [1]);
  await db.none('INSERT INTO follows (follower_id, following_id) VALUES (1, 2)');
  assert.deepEqual(ids(await (await alice.request('/discover/feed?before=3')).text()), [2, 1]);
  await db.none('DELETE FROM follows');
  assert.deepEqual(ids(await (await alice.request('/discover?before=3')).text()), [1]);
  const bob = await site.client(2);
  assert.deepEqual(ids(await (await bob.request('/discover/feed?before=3')).text()), [2, 1]);
});

test('posts render times, HTTPS photos, authors, servings, saved state and escaped content', async () => {
  const alice = await site.client(1);
  await db.none('INSERT INTO saved_recipes (user_id, recipe_id) VALUES (1, 1)');
  let html = await (await alice.request('/discover?before=3')).text();
  for (const value of ['0 min', '20 min', 'Not provided', 'https://example.com/soup.jpg', '/profile/alice', 'Saved · Remove', '<dd>2</dd>', 'name="_csrf"']) assert.ok(html.includes(value), value);
  await db.none('UPDATE recipes SET title = $1, image_url = $2 WHERE recipe_id = 1', ['<script>alert(1)</script>', 'javascript:alert(1)']);
  html = await (await alice.request('/discover/feed?before=2')).text();
  assert.doesNotMatch(html, /<script>alert|src="javascript:/);
  assert.match(html, /&lt;script&gt;/);
  await db.none("UPDATE recipes SET image_url = 'http://example.com/insecure.jpg' WHERE recipe_id = 1");
  assert.doesNotMatch(await (await alice.request('/discover/feed?before=2')).text(), /insecure.jpg/);
  const saved = await alice.request('/recipes/1/save', { _csrf: alice.token, returnTo: '/discover?before=3' });
  assert.equal(saved.headers.get('location'), '/discover?before=3');
});

test('navigation reaches the feed while cook search and recipe catalog retain their views', async () => {
  const alice = await site.client(1);
  const feed = await (await alice.request('/discover')).text();
  assert.match(feed, /href="\/discover" aria-current="page"/);
  assert.match(feed, /href="\/discover\/cooks"/);
  const cooks = await (await alice.request('/discover/cooks?q=bob')).text();
  assert.match(cooks, /Find Users/);
  assert.match(cooks, /bob/);
  assert.match(cooks, /action="\/discover\/cooks"/);
  const catalog = await (await alice.request('/recipes')).text();
  assert.match(catalog, /Your next great bite/);
  assert.doesNotMatch(catalog, /data-discover-feed/);
  assert.doesNotMatch(await (await alice.request('/my-recipes')).text(), /data-discover-feed/);
});

test('empty and failed feed reads give helpful responses without exposing SQL', async () => {
  const alice = await site.client(1);
  await db.none('DELETE FROM recipes');
  assert.match(await (await alice.request('/discover')).text(), /No recipes to show yet/);
  await db.none('ALTER TABLE recipes RENAME TO unavailable_recipes');
  try {
    for (const path of ['/discover', '/discover/feed']) {
      const result = await alice.request(path);
      assert.equal(result.status, 500);
      const html = await result.text();
      assert.match(html, /try again/i);
      assert.doesNotMatch(html, /SELECT|password_hash|does not exist/);
    }
  } finally { await db.none('ALTER TABLE unavailable_recipes RENAME TO recipes'); }
});

test('JSON saves retain session ownership, CSRF, privacy, idempotency and HTML-form fallbacks', async () => {
  const login = await fetch(`${site.base}/test-login/1`, { method: 'POST' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const page = await (await fetch(`${site.base}/discover`, { headers: { cookie } })).text();
  const token = page.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
  const save = (id, action, csrf = token, sessionCookie = cookie) => fetch(`${site.base}/recipes/${id}/${action}`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: sessionCookie, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, user_id: 2 }),
  });
  assert.equal((await save(1, 'save', token, '')).status, 401);
  assert.equal((await save(1, 'save', '')).status, 403);
  for (let i = 0; i < 2; i++) {
    const response = await save(1, 'save');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { isSaved: true });
  }
  assert.deepEqual(await db.any('SELECT user_id, recipe_id FROM saved_recipes'), [{ user_id: 1, recipe_id: 1 }]);
  assert.deepEqual(await (await save(1, 'unsave')).json(), { isSaved: false });
  assert.deepEqual(await db.any('SELECT * FROM saved_recipes'), []);
  await db.none('UPDATE users SET is_private = TRUE WHERE user_id = 2');
  assert.equal((await save(2, 'save')).status, 404);
  const alice = await site.client(1);
  const form = await alice.request('/recipes/1/save', { _csrf: alice.token, returnTo: 'https://evil.example' });
  assert.equal(form.status, 303);
  assert.equal(form.headers.get('location'), '/recipes/1');
});
