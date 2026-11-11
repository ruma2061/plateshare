const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('./helpers/database');
const { createSite } = require('./helpers/site');
let db, site;

before(async () => { db = await createDatabase(); site = await createSite(db); });
after(async () => { await site?.close(); await db?.engine.close(); });
beforeEach(async () => {
  await db.engine.exec(`TRUNCATE users, recipes, ratings, saved_recipes, ingredients RESTART IDENTITY CASCADE;
    INSERT INTO users (username, password_hash, is_private) VALUES
      ('alice', 'secret-hash-alice', FALSE), ('bob', 'secret-hash-bob', TRUE), ('carol', 'hash', FALSE);
    INSERT INTO recipes (user_id, title, description, directions, cuisine) VALUES
      (1, 'Alice garden soup', 'Fresh greens', 'Simmer', 'French'),
      (2, 'Bob private pasta', 'Private recipe', 'Boil', 'Italian'),
      (3, 'Carol lemon rice', 'Bright rice', 'Steam', 'Italian');
    INSERT INTO ratings (user_id, recipe_id, rating) VALUES (1, 3, 5), (1, 2, 4), (2, 1, 3);
    INSERT INTO saved_recipes (user_id, recipe_id) VALUES (1, 3);`);
});

test('own profile shows authored recipes, rating history, real counts and private library shortcuts', async () => {
  const alice = await site.client(1);
  assert.equal((await alice.request('/profile')).headers.get('location'), '/profile/alice');
  const response = await alice.request('/profile/alice');
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const text of ['Alice garden soup', 'Recipes · 1', 'Ratings · 1', 'Member since', '/settings/profile', '/my-recipes', '/follow/requests']) {
    assert.ok(html.includes(text), text);
  }
  assert.doesNotMatch(html, /secret-hash|password_hash/);
  const rated = await (await alice.request('/profile/alice?view=rated')).text();
  assert.match(rated, /Carol lemon rice/);
  assert.match(rated, /5 \/ 5/);
  assert.doesNotMatch(rated, /Bob private pasta/);
});

test('public profiles show only visible recipes and their ratings, with no bookmark collection', async () => {
  const carol = await site.client(3);
  const html = await (await carol.request('/profile/alice')).text();
  assert.ok(html.includes('Alice garden soup'));
  assert.doesNotMatch(html, /Alice garden soup.*secret-hash|\/settings\/profile|Your saved recipes/);
  // Header navigation links to the viewer's own collection; profile tabs never expose another user's saves.
  assert.doesNotMatch(html, /view=saved|Saved ·/);
  const rated = await (await carol.request('/profile/alice?view=rated')).text();
  assert.ok(rated.includes('Carol lemon rice'));
  assert.ok(rated.includes('alice’s rating'));
  assert.doesNotMatch(rated, /Bob private pasta/);
});

test('private profile content and counts stay hidden until an established follow exists', async () => {
  const alice = await site.client(1);
  await db.none('INSERT INTO follow_requests (requester_id, recipient_id) VALUES (1, 2)');
  for (const view of ['recipes', 'rated']) {
    const html = await (await alice.request(`/profile/bob?view=${view}`)).text();
    assert.match(html, /This account is private/);
    assert.match(html, /Cancel Request/);
    assert.doesNotMatch(html, /Bob private pasta|Alice garden soup|Recipes ·|Ratings ·/);
  }
  await db.none('INSERT INTO follows (follower_id, following_id) VALUES (1, 2)');
  assert.match(await (await alice.request('/profile/bob')).text(), /Bob private pasta/);
  const bob = await site.client(2);
  assert.match(await (await bob.request('/profile/bob?view=rated')).text(), /Alice garden soup/);
});

test('profile search, sorting and pagination are bounded and preserve the selected tab', async () => {
  await db.none(`INSERT INTO recipes (user_id, title, directions)
    SELECT 1, 'Dish ' || lpad(n::text, 2, '0'), 'Cook' FROM generate_series(1, 13) n`);
  const alice = await site.client(1);
  const first = await (await alice.request('/profile/alice?q=Dish&sort=title')).text();
  assert.ok(first.includes('Dish 01'));
  assert.ok(!first.includes('Dish 13'));
  assert.match(first, /rel="next"/);
  const last = await (await alice.request('/profile/alice?q=Dish&sort=title&page=99999')).text();
  assert.ok(last.includes('Dish 13'));
  assert.ok(!last.includes('Dish 01'));
  for (const q of ['%', '_', "' OR 1=1 --"]) {
    const html = await (await alice.request(`/profile/alice?q=${encodeURIComponent(q)}`)).text();
    assert.ok(!html.includes('Alice garden soup'));
  }
  for (const query of ['q[x]=1&sort[x]=1', 'view=invalid&page=-2', 'page=99999999999999']) {
    assert.equal((await alice.request(`/profile/alice?${query}`)).status, 200);
  }
});

test('profile content escapes titles and renders useful missing, empty and database error states', async () => {
  const alice = await site.client(1);
  await db.none('UPDATE recipes SET title = $1, image_url = $2 WHERE recipe_id = 1', ['<script>profileAttack()</script>', 'javascript:alert(1)']);
  const html = await (await alice.request('/profile/alice')).text();
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>profileAttack|src="javascript:/);
  const guest = await site.client();
  assert.equal((await guest.request('/profile/alice')).headers.get('location'), '/login');
  assert.equal((await alice.request('/profile/missing')).status, 404);
  assert.match(await (await alice.request('/profile/carol?view=rated')).text(), /No ratings yet/);
  await db.none('ALTER TABLE ratings RENAME TO unavailable_ratings');
  try {
    const response = await alice.request('/profile/alice');
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /SELECT|password_hash|does not exist/);
  } finally {
    await db.none('ALTER TABLE unavailable_ratings RENAME TO ratings');
  }
});

test('real follow and privacy routes update access to profile recipes', async () => {
  const alice = await site.client(1);
  const bob = await site.client(2);
  assert.equal((await alice.request('/follow/2', { _csrf: alice.token })).status, 303);
  assert.match(await (await bob.request('/follow/requests')).text(), /alice/);
  assert.equal((await bob.request('/follow/accept/1', { _csrf: bob.token })).status, 303);
  assert.match(await (await alice.request('/profile/bob')).text(), /Bob private pasta/);
  assert.equal((await bob.request('/profile/privacy', { _csrf: bob.token, is_private: 'false' })).status, 303);
  assert.equal((await alice.request('/unfollow/2', { _csrf: alice.token })).status, 303);
  assert.match(await (await alice.request('/profile/bob')).text(), /Bob private pasta/);
});

test('privacy and social mutations require the current session token before changing access', async () => {
  const alice = await site.client(1);
  const bob = await site.client(2);
  await db.none('INSERT INTO follow_requests (requester_id, recipient_id) VALUES (1, 2)');
  for (const [url, body] of [
    ['/profile/privacy', { is_private: 'false' }], ['/follow/accept/1', {}],
    ['/follow/decline/1', {}], ['/follow/cancel/1', {}], ['/follow/1', {}],
    ['/unfollow/1', {}], ['/followers/remove/1', {}], ['/logout', {}],
  ]) {
    for (const token of ['', alice.token]) {
      const response = await bob.request(url, { ...body, _csrf: token });
      assert.equal(response.status, 403, `${url} must reject missing or foreign tokens`);
    }
  }
  assert.equal((await db.one('SELECT is_private FROM users WHERE user_id = 2')).is_private, true);
  assert.equal((await db.one('SELECT COUNT(*)::int AS count FROM follow_requests')).count, 1);
  assert.equal((await db.one('SELECT COUNT(*)::int AS count FROM follows')).count, 0);
  assert.equal((await alice.request('/recipes/2')).status, 404);
  const settings = await (await bob.request('/settings/profile')).text();
  assert.ok(settings.includes(`name="_csrf" value="${bob.token}"`));
  const requests = await (await bob.request('/follow/requests')).text();
  assert.ok(requests.includes(`name="_csrf" value="${bob.token}"`));
  assert.equal((await bob.request('/follow/accept/1', { _csrf: bob.token })).status, 303);
  assert.equal((await alice.request('/recipes/2')).status, 200);
  assert.equal((await bob.request('/logout', { _csrf: bob.token })).status, 303);
  assert.equal((await bob.request('/profile')).headers.get('location'), '/login');
});

test('registration and login reach a working profile and save returns to that profile', async () => {
  const guest = await site.client();
  assert.equal((await guest.request('/register', { username: 'newcook', password: 'test-password-123' })).status, 302);
  const login = await guest.request('/login', { username: 'newcook', password: 'test-password-123' });
  assert.equal(login.headers.get('location'), '/profile');
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const page = await fetch(`${site.base}/profile/alice`, { headers: { cookie } });
  const html = await page.text();
  assert.match(html, /Alice garden soup/);
  const token = html.match(/name="_csrf" value="([a-f0-9]+)"/)?.[1];
  assert.ok(token, 'Profile recipe controls need a session-bound form token');
  const saved = await fetch(`${site.base}/recipes/1/save`, {
    method: 'POST', redirect: 'manual', headers: { cookie },
    body: new URLSearchParams({ _csrf: token, returnTo: '/profile/alice?view=recipes' }),
  });
  assert.equal(saved.status, 303);
  assert.equal(saved.headers.get('location'), '/profile/alice?view=recipes');
  const library = await fetch(`${site.base}/my-recipes`, { headers: { cookie } });
  assert.match(await library.text(), /Alice garden soup/);
  assert.equal((await db.one("SELECT COUNT(*)::int AS count FROM saved_recipes s JOIN users u USING (user_id) WHERE u.username = 'newcook'")).count, 1);
});

test('edit is a viewable username and settings remain separate', async () => {
  await db.none("UPDATE users SET username = 'edit' WHERE user_id = 1");
  const viewer = await site.client(3);
  assert.match(await (await viewer.request('/profile/edit')).text(), /Alice garden soup/);
});

test('repeated search and registration fields return 400 and the app keeps serving', async () => {
  const viewer = await site.client(3);
  assert.equal((await viewer.request('/discover?q=a&q=b')).status, 400);
  const guest = await site.client();
  assert.equal((await guest.request('/register', [
    ['username', 'first'], ['username', 'second'], ['password', 'password123'],
  ])).status, 400);
  assert.equal((await guest.request('/login')).status, 200);
});

test('login rejects missing, repeated and structured credentials without a server error', async () => {
  const guest = await site.client();
  for (const body of [
    { username: 'alice' }, { password: 'password123' },
    { username: '', password: 'password123' }, { username: 'alice', password: '' },
    [['username', 'alice'], ['password', 'first'], ['password', 'second']],
    [['username', 'alice'], ['username', 'bob'], ['password', 'password123']],
    { username: 'alice', 'password[value]': 'password123' },
    { 'username[value]': 'alice', password: 'password123' },
  ]) {
    const response = await guest.request('/login', body);
    assert.equal(response.status, 400);
    assert.match(await response.text(), /username.*password/i);
  }
  assert.equal((await guest.request('/login')).status, 200);
  assert.equal((await guest.request('/profile')).headers.get('location'), '/login');
});
