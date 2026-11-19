const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('./helpers/database');
const { createSite } = require('./helpers/site');

let db, site;
before(async () => { db = await createDatabase(); site = await createSite(db); });
after(async () => { await site?.close(); await db?.engine.close(); });
beforeEach(async () => {
  await db.engine.exec(`
    TRUNCATE users, recipes, ratings, saved_recipes, ingredients RESTART IDENTITY CASCADE;
    INSERT INTO users (username, password_hash, onboarding_completed)
      VALUES ('new_cook', 'hash', FALSE), ('private_cook', 'hash', TRUE), ('existing_cook', 'hash', TRUE);
    UPDATE users SET is_private = TRUE WHERE user_id = 2;
    INSERT INTO recipes (title, directions, recipe_type)
      VALUES ('Onboarding rice', 'Cook it.', 'official');
    INSERT INTO recipes (title, directions, recipe_type, user_id)
      VALUES ('Private curry', 'Cook curry.', 'user', 2);
  `);
});
const saveProfile = (client, changes = {}) => client.request('/onboarding/profile', {
  _csrf: client.token, display_name: 'New Cook', bio: 'I love cooking',
  avatar_url: '', is_private: 'false', ...changes,
});

test('unfinished users enter onboarding, existing users bypass it', async () => {
  const newcomer = await site.client(1);
  const existing = await site.client(3);
  assert.equal((await newcomer.request('/profile')).headers.get('location'), '/onboarding');
  assert.equal((await newcomer.request('/onboarding')).headers.get('location'), '/onboarding/profile');
  assert.equal((await existing.request('/profile')).headers.get('location'), '/profile/existing_cook');
  assert.equal((await existing.request('/onboarding')).headers.get('location'), '/recipes');
  assert.match(await (await newcomer.request('/onboarding/profile')).text(), /Step 1 of 3/);
});

test('profile setup validates inputs and saves details and privacy', async () => {
  const newcomer = await site.client(1);
  assert.equal((await saveProfile(newcomer, { avatar_url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await saveProfile(newcomer, { _csrf: '' })).status, 403);
  const result = await saveProfile(newcomer, { is_private: 'true' });
  assert.equal(result.status, 303);
  assert.equal(result.headers.get('location'), '/onboarding/friends');
  const saved = await db.one('SELECT display_name, bio, is_private, onboarding_completed FROM users WHERE user_id = 1');
  assert.equal(saved.display_name, 'New Cook');
  assert.equal(saved.bio, 'I love cooking');
  assert.equal(saved.is_private, true);
  assert.equal(saved.onboarding_completed, false);
});

test('private follow requests remain private until approved, including Discover', async () => {
  const newcomer = await site.client(1);
  const initialDiscover = await (await newcomer.request('/recipes')).text();
  assert.doesNotMatch(initialDiscover, /Private curry/);
  const follow = await newcomer.request('/follow/2', {
    _csrf: newcomer.token, returnTo: '/onboarding/friends',
  });
  assert.equal(follow.status, 303);
  assert.equal(follow.headers.get('location'), '/onboarding/friends');
  assert.equal((await db.one(`SELECT COUNT(*)::int AS total FROM follow_requests
    WHERE requester_id = 1 AND recipient_id = 2`)).total, 1);
  assert.doesNotMatch(await (await newcomer.request('/recipes')).text(), /Private curry/);
  await db.none('INSERT INTO follows (follower_id, following_id) VALUES (1, 2)');
  assert.match(await (await newcomer.request('/recipes')).text(), /Private curry/);
  assert.match(await (await newcomer.request('/onboarding/taste')).text(), /Private curry/);
  await db.none('DELETE FROM follows WHERE follower_id = 1 AND following_id = 2');
  assert.doesNotMatch(await (await newcomer.request('/recipes')).text(), /Private curry/);
});

test('thumb rating during onboarding uses current scoring and returns to taste page', async () => {
  const newcomer = await site.client(1);
  const rating = await newcomer.request('/recipes/1/rate', {
    _csrf: newcomer.token, sentiment: 'like', returnTo: '/onboarding/taste',
  });
  assert.equal(rating.status, 303);
  assert.equal(rating.headers.get('location'), '/onboarding/taste');
  assert.equal((await db.one(`SELECT score::float AS score FROM ratings WHERE user_id = 1 AND recipe_id = 1`)).score, 8.5);
});

test('registration marks new accounts unfinished without changing existing accounts', async () => {
  const guest = await site.client();
  const response = await guest.request('/register', {
    username: 'brand_new_cook', password: 'password12345',
  });
  assert.equal(response.status, 302);
  const registered = await db.one(
    'SELECT onboarding_completed FROM users WHERE username = $1', ['brand_new_cook']);
  assert.equal(registered.onboarding_completed, false);
  const existing = await db.one('SELECT onboarding_completed FROM users WHERE user_id = 3');
  assert.equal(existing.onboarding_completed, true);
});

test('finish and skip set a single completion flag, never requiring onboarding again', async () => {
  const newcomer = await site.client(1);
  assert.equal((await newcomer.request('/onboarding/complete', { _csrf: '' })).status, 403);
  const done = await newcomer.request('/onboarding/complete', { _csrf: newcomer.token });
  assert.equal(done.status, 303);
  assert.equal(done.headers.get('location'), '/recipes');
  assert.equal((await db.one('SELECT onboarding_completed FROM users WHERE user_id = 1')).onboarding_completed, true);
  assert.equal((await newcomer.request('/profile')).headers.get('location'), '/profile/new_cook');
});
