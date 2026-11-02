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
    INSERT INTO users (username, password_hash) VALUES ('alice', 'hash'), ('bob', 'hash');
    INSERT INTO recipes (user_id, title, description, directions, cuisine, calories, protein_g, carbs_g, fat_g)
    VALUES (1, 'Garden soup', 'A quick lunch', 'Chop vegetables.\nSimmer gently.', 'French', 180, 6, 24, 4),
           (2, 'Lemon pasta', 'Bright and simple', 'Boil pasta.', 'Italian', 0, NULL, NULL, NULL);
    INSERT INTO recipes (title, directions, recipe_type) VALUES ('Official rice', 'Boil rice.', 'official');
    INSERT INTO ingredients (name) VALUES ('Carrot');
    INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity, unit) VALUES (1, 1, 2, 'cups');
  `);
});

test('all recipe and library endpoints require a logged-in session', async () => {
  const guest = await site.client();
  for (const [url, body] of [
    ['/recipes'], ['/recipes/1'], ['/my-recipes'],
    ['/recipes/1/save', {}], ['/recipes/1/unsave', {}], ['/recipes/1/nutrition', {}],
  ]) {
    const response = await guest.request(url, body);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');
  }
});

test('catalog and recipe detail render real ingredients, nutrition and zero without inventing missing measurements', async () => {
  const alice = await site.client(1);
  assert.ok(alice.token);
  const html = await (await alice.request('/recipes/1')).text();
  for (const expected of ['Garden soup', 'Carrot', 'Chop vegetables.', '180 kcal', '6 g', '24 g', '4 g', 'Per serving']) {
    assert.ok(html.includes(expected), expected);
  }
  const partial = await (await alice.request('/recipes/2')).text();
  assert.match(partial, /0 kcal/);
  assert.match(partial, /Not provided/);
  const unknown = await (await alice.request('/recipes/3')).text();
  assert.match(unknown, /Nutrition has not been provided/);
  assert.doesNotMatch(unknown, /0 kcal/);
  assert.match(await (await alice.request('/recipes')).text(), /Official rice/);
});

test('saving is idempotent, persists across sessions and ignores submitted user IDs', async () => {
  const alice = await site.client(1);
  for (let i = 0; i < 2; i++) {
    assert.equal((await alice.request('/recipes/1/save', { _csrf: alice.token, user_id: 2 })).status, 303);
  }
  assert.deepEqual(await db.any('SELECT user_id, recipe_id FROM saved_recipes'), [{ user_id: 1, recipe_id: 1 }]);
  const freshSession = await site.client(1);
  assert.match(await (await freshSession.request('/my-recipes')).text(), /Garden soup/);
  const bob = await site.client(2);
  assert.doesNotMatch(await (await bob.request('/my-recipes?user_id=1')).text(), /Garden soup/);
});

test('unsaving affects only the current account and preserves rating history', async () => {
  await db.none('INSERT INTO saved_recipes (user_id, recipe_id) VALUES (1, 1), (2, 1)');
  await db.none('INSERT INTO ratings (user_id, recipe_id, rating) VALUES (1, 1, 5)');
  const alice = await site.client(1);
  for (let i = 0; i < 2; i++) {
    assert.equal((await alice.request('/recipes/1/unsave', { _csrf: alice.token, user_id: 2 })).status, 303);
  }
  assert.deepEqual(await db.any('SELECT user_id FROM saved_recipes'), [{ user_id: 2 }]);
  const html = await (await alice.request('/my-recipes?view=rated')).text();
  assert.match(html, /Garden soup/);
  assert.match(html, /5 \/ 5/);
});

test('mutations reject missing or another session’s CSRF token without changing data', async () => {
  const alice = await site.client(1);
  const bob = await site.client(2);
  for (const endpoint of ['save', 'unsave', 'nutrition']) {
    for (const token of ['', bob.token]) {
      assert.equal((await alice.request(`/recipes/1/${endpoint}`, { _csrf: token, calories: '50' })).status, 403);
    }
  }
  assert.equal((await db.one('SELECT COUNT(*)::int AS count FROM saved_recipes')).count, 0);
  assert.equal(Number((await db.one('SELECT calories FROM recipes WHERE recipe_id = 1')).calories), 180);
});

test('only an author can edit nutrition and invalid values do not overwrite existing nutrition', async () => {
  const alice = await site.client(1);
  const bob = await site.client(2);
  assert.equal((await bob.request('/recipes/1/nutrition', { _csrf: bob.token, calories: '900', user_id: 1 })).status, 403);
  assert.equal((await alice.request('/recipes/3/nutrition', { _csrf: alice.token, calories: '900' })).status, 403);
  const bad = await alice.request('/recipes/1/nutrition', { _csrf: alice.token, calories: '-1', protein_g: '12' });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /nonnegative/);
  assert.equal(Number((await db.one('SELECT calories FROM recipes WHERE recipe_id = 1')).calories), 180);
  const response = await alice.request('/recipes/1/nutrition', {
    _csrf: alice.token, calories: '230.5', protein_g: '0', carbs_g: '', fat_g: '4.75',
  });
  assert.equal(response.status, 303);
  const saved = await db.one('SELECT calories, protein_g, carbs_g, fat_g FROM recipes WHERE recipe_id = 1');
  assert.equal(Number(saved.calories), 230.5);
  assert.equal(Number(saved.protein_g), 0);
  assert.equal(saved.carbs_g, null);
  assert.equal(Number(saved.fat_g), 4.75);
});

test('saved and rated tabs use only this user’s records and support literal search and rating sort', async () => {
  await db.none('INSERT INTO saved_recipes (user_id, recipe_id) VALUES (1, 1), (1, 2), (2, 3)');
  await db.none('INSERT INTO ratings (user_id, recipe_id, rating) VALUES (1, 1, 2), (1, 2, 5), (2, 3, 4)');
  const alice = await site.client(1);
  const rated = await (await alice.request('/my-recipes?view=rated&sort=rating')).text();
  assert.ok(rated.indexOf('Lemon pasta') < rated.indexOf('Garden soup'));
  assert.doesNotMatch(rated, /Official rice/);
  const filtered = await (await alice.request('/my-recipes?q=italian')).text();
  assert.match(filtered, /Lemon pasta/);
  assert.doesNotMatch(filtered, /Garden soup/);
  for (const search of ["' OR 1=1 --", '%', '_']) {
    const html = await (await alice.request(`/my-recipes?q=${encodeURIComponent(search)}`)).text();
    assert.doesNotMatch(html, /Garden soup|Lemon pasta/);
  }
});

test('pagination is bounded, stable and retains search and sorting', async () => {
  await db.none(`INSERT INTO recipes (title, directions, recipe_type)
    SELECT 'Extra ' || lpad(n::text, 2, '0'), 'Cook', 'official' FROM generate_series(1, 13) n`);
  const alice = await site.client(1);
  const first = await (await alice.request('/recipes?q=Extra&sort=title')).text();
  assert.match(first, /Extra 01/);
  assert.doesNotMatch(first, /Extra 13/);
  const nextHref = first.match(/href="([^"]+)" rel="next"/)?.[1];
  assert.ok(nextHref, 'The first page must offer a next-page link');
  const nextUrl = nextHref.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/&amp;/g, '&');
  const parameters = new URL(nextUrl, site.base).searchParams;
  assert.equal(parameters.get('page'), '2');
  assert.equal(parameters.get('q'), 'Extra');
  assert.equal(parameters.get('sort'), 'title');
  const second = await (await alice.request(nextUrl)).text();
  assert.match(second, /Extra 13/);
  assert.doesNotMatch(second, /Extra 01/);
  const last = await (await alice.request('/recipes?q=Extra&sort=title&page=99999')).text();
  assert.match(last, /Extra 13/);
  for (const query of ['page=-1', 'page=abc', 'sort=DROP TABLE recipes', 'q[x]=1&view[x]=1']) {
    assert.equal((await alice.request(`/my-recipes?${query}`)).status, 200);
  }
});

test('invalid and nonexistent recipe IDs give 404 for reads and writes', async () => {
  const alice = await site.client(1);
  for (const id of ['0', '-1', '1oops', '9999999999999', '999']) {
    assert.equal((await alice.request(`/recipes/${id}`)).status, 404);
    for (const action of ['save', 'unsave', 'nutrition']) {
      assert.equal((await alice.request(`/recipes/${id}/${action}`, { _csrf: alice.token })).status, 404);
    }
  }
});

test('save redirects stay local and HTML content is escaped', async () => {
  const alice = await site.client(1);
  const response = await alice.request('/recipes/1/save', { _csrf: alice.token, returnTo: '//evil.example' });
  assert.equal(response.headers.get('location'), '/recipes/1');
  const returned = await alice.request('/recipes/1/unsave', { _csrf: alice.token, returnTo: '/my-recipes?view=saved' });
  assert.equal(returned.headers.get('location'), '/my-recipes?view=saved');
  await db.none('UPDATE recipes SET title = $1, image_url = $2 WHERE recipe_id = 1', ['<script>alert(1)</script>', 'javascript:alert(1)']);
  const html = await (await alice.request('/recipes/1')).text();
  assert.doesNotMatch(html, /<script>alert|src="javascript:/);
  assert.match(html, /&lt;script&gt;/);
});

test('empty and failed database reads produce helpful pages without leaking SQL', async () => {
  const alice = await site.client(1);
  assert.match(await (await alice.request('/my-recipes')).text(), /No saved recipes yet/);
  assert.match(await (await alice.request('/my-recipes?view=rated')).text(), /No rated recipes yet/);
  await db.none('ALTER TABLE saved_recipes RENAME TO unavailable_saves');
  try {
    const response = await alice.request('/my-recipes');
    assert.equal(response.status, 500);
    const html = await response.text();
    assert.match(html, /try again/i);
    assert.doesNotMatch(html, /SELECT|relation .* does not exist|password_hash/);
  } finally {
    await db.none('ALTER TABLE unavailable_saves RENAME TO saved_recipes');
  }
});
