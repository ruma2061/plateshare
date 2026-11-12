
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { createDatabase } = require('./helpers/database');
const { createSite } = require('./helpers/site');

let db, site;

before(async () => {
  db = await createDatabase();
  site = await createSite(db);
});

after(async () => {
  await site?.close();
  await db?.engine.close();
});

beforeEach(async () => {
  await db.engine.exec(`
    TRUNCATE users, recipes, ratings, saved_recipes, ingredients
    RESTART IDENTITY CASCADE;

    INSERT INTO users (username, password_hash)
    VALUES ('alice', 'hash'), ('bob', 'hash');

    INSERT INTO recipes (title, directions, recipe_type)
    VALUES ('Official rice', 'Boil rice.', 'official');
  `);
});

const recipe = {
  title: 'Basil Pasta',
  description: 'Quick homemade pasta',
  cuisine: 'Italian',
  ingredients: 'Pasta\nBasil\nOlive oil',
  directions: 'Boil pasta. Add basil and olive oil.',
  prep_time: '10',
  cook_time: '15',
  servings: '2'
};

const post = (client, changes = {}) =>
  client.request('/recipes/new', {
    _csrf: client.token,
    ...recipe,
    ...changes
  });

const getNewId = response => {
  assert.equal(response.status, 303);
  const location = response.headers.get('location');
  assert.match(location, /^\/recipes\/\d+#rating$/);
  return Number(location.match(/\/recipes\/(\d+)/)[1]);
};

test('logged-in user can open posting form', async () => {
  const alice = await site.client(1);
  const response = await alice.request('/recipes/new');

  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /Post a Recipe/);
  assert.match(html, /name="title"/);
  assert.match(html, /name="ingredients"/);
  assert.match(html, /name="directions"/);
  assert.match(html, /name="_csrf"/);
});

test('guests cannot create recipes', async () => {
  const guest = await site.client();

  const response = await guest.request('/recipes/new', recipe);

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/login');

  const result = await db.one(
    'SELECT COUNT(*)::int AS count FROM recipes'
  );
  assert.equal(result.count, 1);
});

test('recipe saves under the logged-in account', async () => {
  const alice = await site.client(1);

  const response = await post(alice, { user_id: '2' });
  const id = getNewId(response);

  const saved = await db.one(
    'SELECT * FROM recipes WHERE recipe_id = $1',
    [id]
  );

  assert.equal(saved.user_id, 1);
  assert.equal(saved.title, 'Basil Pasta');
  assert.equal(saved.cuisine, 'Italian');
  assert.equal(saved.recipe_type, 'user');

  const ingredients = await db.any(`
    SELECT i.name
    FROM recipe_ingredients ri
    JOIN ingredients i ON ri.ingredient_id = i.ingredient_id
    WHERE ri.recipe_id = $1
    ORDER BY i.name
  `, [id]);

  assert.deepEqual(
    ingredients.map(i => i.name),
    ['Basil', 'Olive oil', 'Pasta']
  );
});

test('missing required fields are rejected', async () => {
  const alice = await site.client(1);

  for (const field of ['title', 'ingredients', 'directions']) {
    const response = await post(alice, { [field]: '' });

    assert.equal(response.status, 400);
    assert.match(
      await response.text(),
      /Enter a recipe title|required/i
    );
  }

  const result = await db.one(
    'SELECT COUNT(*)::int AS count FROM recipes'
  );
  assert.equal(result.count, 1);
});

test('posting requires a valid CSRF token', async () => {
  const alice = await site.client(1);
  const bob = await site.client(2);

  for (const token of ['', bob.token]) {
    const response = await post(alice, { _csrf: token });
    assert.equal(response.status, 403);
  }

  const count = await db.one(
    'SELECT COUNT(*)::int AS count FROM recipes'
  );
  assert.equal(count.count, 1);
});

test('public recipe appears in Discover by username', async () => {
  const alice = await site.client(1);
  const bob = await site.client(2);

  const id = getNewId(await post(alice));

  const discover = await (
    await bob.request('/recipes?q=Basil')
  ).text();

  assert.match(discover, /Basil Pasta/);
  assert.match(discover, /By\s*<a[^>]*>alice<\/a>/);

  assert.equal((await bob.request(`/recipes/${id}`)).status, 200);

  const profile = await (
    await bob.request('/profile/alice')
  ).text();

  assert.match(profile, /Basil Pasta/);
});

test('private recipes stay hidden from Discover', async () => {
  await db.none(
    'UPDATE users SET is_private = TRUE WHERE user_id = 1'
  );

  const alice = await site.client(1);
  const bob = await site.client(2);

  const id = getNewId(await post(alice));

  const discover = await (
    await bob.request('/recipes')
  ).text();

  assert.doesNotMatch(discover, /Basil Pasta/);
  assert.equal((await bob.request(`/recipes/${id}`)).status, 404);
  assert.equal((await alice.request(`/recipes/${id}`)).status, 200);

  await db.none(
    'INSERT INTO follows (follower_id, following_id) VALUES (2, 1)'
  );

  assert.equal((await bob.request(`/recipes/${id}`)).status, 200);

  const discoverAfterFollow = await (
    await bob.request('/recipes')
  ).text();

  assert.doesNotMatch(discoverAfterFollow, /Basil Pasta/);
});

test('author can rate their own recipe', async () => {
  const alice = await site.client(1);
  const id = getNewId(await post(alice));

  const response = await alice.request(`/recipes/${id}/rate`, {
    _csrf: alice.token,
    sentiment: 'like'
  });

  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get('location'),
    `/recipes/${id}#rating`
  );

  const rating = await db.one(`
    SELECT user_id, sentiment, score::float AS score
    FROM ratings
    WHERE recipe_id = $1
  `, [id]);

  assert.equal(rating.user_id, 1);
  assert.equal(rating.sentiment, 'like');
  assert.equal(rating.score, 8.5);

  const profile = await (
    await alice.request('/profile/alice?view=rated')
  ).text();

  assert.match(profile, /Basil Pasta/);
});

test('rating uses existing comparison questions', async () => {
  const alice = await site.client(1);

  await alice.request('/recipes/1/rate', {
    _csrf: alice.token,
    sentiment: 'like'
  });

  const id = getNewId(await post(alice));

  const start = await alice.request(`/recipes/${id}/rate`, {
    _csrf: alice.token,
    sentiment: 'like'
  });

  assert.equal(start.status, 303);
  assert.equal(start.headers.get('location'), `/recipes/${id}/rate`);

  const page = await (
    await alice.request(`/recipes/${id}/rate`)
  ).text();

  assert.match(page, /Which was better/);
  assert.match(page, /Official rice/);
  assert.match(page, /Basil Pasta/);

  const done = await alice.request(`/recipes/${id}/rate/answer`, {
    _csrf: alice.token,
    answer: 'better'
  });

  assert.equal(done.status, 303);

  const saved = await db.one(`
    SELECT score::float AS score FROM ratings
    WHERE recipe_id = $1 AND user_id = 1
  `, [id]);

  assert.equal(saved.score, 9.3);
});
